import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export const uid = (prefix='') => `${prefix}${crypto.randomUUID()}`;

export function createStore(dataDir) {
  dataDir=path.resolve(dataDir);
  mkdirSync(dataDir,{recursive:true});
  if(existsSync(path.join(dataDir,'.restore-incomplete')))throw Object.assign(new Error('The data directory contains an incomplete restore. Complete or restart the verified restore before starting.'),{code:'RESTORE_INCOMPLETE'});
  for(const name of ['uploads','backups'])mkdirSync(path.join(dataDir,name),{recursive:true});
  const lockPath=path.join(dataDir,'.writer.lock'),reclaimPath=path.join(dataDir,'.writer-recovery.lock');
  const lockValue=JSON.stringify({pid:process.pid,token:crypto.randomUUID(),createdAt:now()});
  let db,ownsLock=false,dbClosed=false,transactionDepth=0;
  const releaseLock=()=>{if(ownsLock&&existsSync(lockPath)&&readFileSync(lockPath,'utf8')===lockValue){unlinkSync(lockPath);ownsLock=false;}};
  const writeLock=()=>{const fd=openSync(lockPath,'wx',0o600);try{writeFileSync(fd,lockValue);ownsLock=true;}finally{closeSync(fd);}};
  try{
    if(existsSync(reclaimPath))throw Object.assign(new Error('Writer recovery is already in progress or was interrupted. Inspect the recovery lock before retrying.'),{code:'WRITER_RECOVERY_LOCKED'});
    if(existsSync(lockPath)){
      const recoveryFd=openSync(reclaimPath,'wx',0o600);try{writeFileSync(recoveryFd,lockValue);}finally{closeSync(recoveryFd);}
      try{
        if(existsSync(lockPath)){
          const raw=readFileSync(lockPath,'utf8').trim();let oldPid;
          try{oldPid=/^[1-9]\d*$/.test(raw)?Number(raw):JSON.parse(raw).pid;}catch{}
          if(!Number.isSafeInteger(oldPid)||oldPid<=0||oldPid>2147483647)throw Object.assign(new Error('The writer lock has an invalid PID. Inspect the lock; automatic deletion is refused.'),{code:'WRITER_LOCK_INVALID'});
          let alive=false;
          try{process.kill(oldPid,0);alive=true;}catch(e){if(e.code==='ESRCH')alive=false;else if(e.code==='EPERM')alive=true;else throw Object.assign(new Error('The previous writer state cannot be verified. Startup is refused.'),{code:'WRITER_STATE_UNKNOWN'});}
          if(alive)throw Object.assign(new Error('The data directory already has an active writer.'),{code:'WRITER_ALREADY_ACTIVE'});
          unlinkSync(lockPath);
        }
        writeLock();
      }finally{if(existsSync(reclaimPath)&&readFileSync(reclaimPath,'utf8')===lockValue)unlinkSync(reclaimPath);}
    }else writeLock();
    db=new DatabaseSync(path.join(dataDir,'knowledge.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY,document_id TEXT NOT NULL,ordinal INTEGER NOT NULL,data TEXT NOT NULL,embedding TEXT,embedding_model TEXT);
    CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY,created_at TEXT NOT NULL,actor_id TEXT,action TEXT NOT NULL,document_id TEXT,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  const statements={
    get:db.prepare('SELECT data FROM entities WHERE kind=? AND id=?'),
    list:db.prepare('SELECT data FROM entities WHERE kind=?'),
    put:db.prepare('INSERT INTO entities(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data'),
    del:db.prepare('DELETE FROM entities WHERE kind=? AND id=?'),
  };
  let key;
  const keyPath=path.join(dataDir,'.encryption-key');
  const encryptedValues=db.prepare('SELECT data FROM entities').all().flatMap(row=>{const v=JSON.parse(row.data);return [v.sealedApiKey,v.sealedEmbeddingApiKey,v.sealedSecret].filter(Boolean);});
  if(!process.env.APP_ENCRYPTION_KEY&&!existsSync(keyPath)&&encryptedValues.length)throw Object.assign(new Error('Encrypted credentials exist but the encryption key is missing. Restore the matching key before starting.'),{code:'ENCRYPTION_KEY_MISSING'});
  if(process.env.APP_ENCRYPTION_KEY) key=crypto.createHash('sha256').update(process.env.APP_ENCRYPTION_KEY).digest();
  else if(existsSync(keyPath)) key=Buffer.from(readFileSync(keyPath,'utf8').trim(),'hex');
  else { key=crypto.randomBytes(32); writeFileSync(keyPath,key.toString('hex'),{mode:0o600,flag:'wx'}); }
  if(key.length!==32)throw Object.assign(new Error('The encryption key file is invalid.'),{code:'ENCRYPTION_KEY_INVALID'});
  const store={
    db,dataDir,
    get:(kind,id)=>{const row=statements.get.get(kind,id);return row?JSON.parse(row.data):null;},
    list:kind=>statements.list.all(kind).map(row=>JSON.parse(row.data)),
    put:(kind,item)=>{statements.put.run(kind,item.id,JSON.stringify(item));return item;},
    del:(kind,id)=>statements.del.run(kind,id),
    transaction(fn){
      const nested=transactionDepth>0,savepoint=`xrag_transaction_${transactionDepth}`;
      db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');transactionDepth++;
      try{const result=fn();if(result&&typeof result.then==='function')throw new TypeError('Transactions must finish synchronously.');db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');return result;}
      catch(e){db.exec(nested?`ROLLBACK TO SAVEPOINT ${savepoint}`:'ROLLBACK');if(nested)db.exec(`RELEASE SAVEPOINT ${savepoint}`);throw e;}
      finally{transactionDepth--;}
    },
    chunks(documentId){return db.prepare('SELECT data FROM chunks WHERE document_id=? ORDER BY ordinal').all(documentId).map(r=>JSON.parse(r.data));},
    replaceChunks(documentId,chunks){store.transaction(()=>{db.prepare('DELETE FROM chunks WHERE document_id=?').run(documentId); const q=db.prepare('INSERT INTO chunks(id,document_id,ordinal,data) VALUES(?,?,?,?)'); for(const c of chunks)q.run(c.id,documentId,c.ordinal,JSON.stringify(c));});},
    vectorCount(documentId,model){return Number(db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE document_id=? AND embedding_model=? AND embedding IS NOT NULL').get(documentId,model).count);},
    embedding(chunkId,vector,model){db.prepare('UPDATE chunks SET embedding=?,embedding_model=? WHERE id=?').run(JSON.stringify(vector),model,chunkId);},
    vectors(documentIds,model){const allowed=new Set(documentIds);return db.prepare('SELECT id,document_id,embedding FROM chunks WHERE embedding IS NOT NULL AND embedding_model=?').all(model).filter(r=>allowed.has(r.document_id)).map(r=>({id:r.id,vector:JSON.parse(r.embedding)}));},
    audit(actor,action,detail={}){const event={id:uid('audit_'),createdAt:now(),actorId:actor?.id??null,actorName:actor?.name??'系统',action,...detail};db.prepare('INSERT INTO audit(id,created_at,actor_id,action,document_id,data) VALUES(?,?,?,?,?,?)').run(event.id,event.createdAt,event.actorId,action,detail.documentId??null,JSON.stringify(event));return event;},
    events(limit=200,documentId){return (documentId?db.prepare('SELECT data FROM audit WHERE document_id=? ORDER BY created_at DESC LIMIT ?').all(documentId,limit):db.prepare('SELECT data FROM audit ORDER BY created_at DESC LIMIT ?').all(limit)).map(r=>JSON.parse(r.data));},
    seal(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const enc=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),enc.toString('hex')].join(':');},
    unseal(value){if(!value)return '';const [iv,tag,data]=value.split(':');const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'hex'));decipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([decipher.update(Buffer.from(data,'hex')),decipher.final()]).toString('utf8');},
    close(){if(dbClosed)return;db.close();dbClosed=true;releaseLock();},
  };
  for(const sealed of encryptedValues){try{store.unseal(sealed);}catch{throw Object.assign(new Error('The encryption key does not match stored credentials.'),{code:'ENCRYPTION_KEY_MISMATCH'});}}
  return store;
  }catch(error){try{if(db&&!dbClosed)db.close();}catch{}releaseLock();throw error;}
}

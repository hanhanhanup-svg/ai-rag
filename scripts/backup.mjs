import { createStore } from '../server/database.mjs';
import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir=path.resolve(process.env.DATA_DIR||'data');let store;
try {
  store=createStore(dir);const id='backup-'+new Date().toISOString().replace(/[:.]/g,'-'),dest=path.join(dir,'backups',id);mkdirSync(path.join(dest,'uploads'),{recursive:true});
  await backup(store.db,path.join(dest,'knowledge.sqlite'));const snapshot=new DatabaseSync(path.join(dest,'knowledge.sqlite'),{readOnly:true});const docs=snapshot.prepare("SELECT data FROM entities WHERE kind='document'").all().map(r=>JSON.parse(r.data));snapshot.close();const files=[];
  for(const doc of docs){copyFileSync(path.join(dir,'uploads',doc.storageName),path.join(dest,'uploads',doc.storageName));const digest=crypto.createHash('sha256').update(readFileSync(path.join(dest,'uploads',doc.storageName))).digest('hex');if(digest!==doc.sha256)throw new Error('备份原件校验失败。');files.push({storageName:doc.storageName,sha256:digest,size:doc.size});}
  if(existsSync(path.join(dir,'.encryption-key')))copyFileSync(path.join(dir,'.encryption-key'),path.join(dest,'.encryption-key'));
  writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({id,createdAt:new Date().toISOString(),documentCount:docs.length,files,externalEncryptionKey:!!process.env.APP_ENCRYPTION_KEY},null,2));console.log(JSON.stringify({backup:dest,files:files.length,verified:true}));
}catch(e){console.error('备份失败：'+e.message+' 如服务正在运行，请在运行保障页面创建在线备份。');process.exitCode=1;}finally{store?.close();}

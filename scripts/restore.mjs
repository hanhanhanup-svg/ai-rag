import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const sha=file=>crypto.createHash('sha256').update(readFileSync(file)).digest('hex');
export function restoreBackup(sourcePath,targetPath){
  const source=realpathSync(sourcePath),target=path.resolve(targetPath);
  if(source===target||target.startsWith(source+path.sep))throw new Error('恢复目标不能是备份目录或其子目录。');
  if(existsSync(path.join(source,'FAILED.txt')))throw new Error('该备份未完成，禁止恢复。');
  if(existsSync(target)&&(lstatSync(target).isSymbolicLink()||readdirSync(target).length))throw new Error('恢复目标必须是新的空目录，不能覆盖现有数据。');
  const manifest=JSON.parse(readFileSync(path.join(source,'manifest.json'),'utf8'));
  if(!Array.isArray(manifest.files))throw new Error('备份清单无效。');
  for(const file of manifest.files){if(typeof file.storageName!=='string'||path.basename(file.storageName)!==file.storageName||/[\\/\x00]/.test(file.storageName))throw new Error('备份包含非法文件路径。');const src=path.join(source,'uploads',file.storageName);if(!existsSync(src)||lstatSync(src).isSymbolicLink()||sha(src)!==file.sha256)throw new Error('原件校验失败：'+file.storageName);}
  const sourceDb=path.join(source,'knowledge.sqlite');const db=new DatabaseSync(sourceDb,{readOnly:true});try{if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('备份数据库完整性检查失败。');const docs=db.prepare("SELECT data FROM entities WHERE kind='document'").all().map(r=>JSON.parse(r.data));if(docs.length!==manifest.files.length||docs.some(d=>!manifest.files.some(f=>f.storageName===d.storageName&&f.sha256===d.sha256)))throw new Error('数据库与原件清单不一致。');}finally{db.close();}
  mkdirSync(path.join(target,'uploads'),{recursive:true});writeFileSync(path.join(target,'.restore-incomplete'),'恢复进行中');
  copyFileSync(sourceDb,path.join(target,'knowledge.sqlite'));for(const file of manifest.files)copyFileSync(path.join(source,'uploads',file.storageName),path.join(target,'uploads',file.storageName));
  if(existsSync(path.join(source,'.encryption-key')))copyFileSync(path.join(source,'.encryption-key'),path.join(target,'.encryption-key'));
  const restored=new DatabaseSync(path.join(target,'knowledge.sqlite'));try{restored.exec('DELETE FROM sessions');restored.prepare("DELETE FROM entities WHERE kind='oidcState'").run();restored.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{restored.close();}
  writeFileSync(path.join(target,'restore-receipt.json'),JSON.stringify({sourceBackup:manifest.id,restoredAt:new Date().toISOString(),files:manifest.files.length,verified:true,requiresExternalEncryptionKey:!!manifest.externalEncryptionKey},null,2));
  unlinkSync(path.join(target,'.restore-incomplete'));return {target,files:manifest.files.length,verified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const source=process.argv[2],i=process.argv.indexOf('--target'),target=i>=0?process.argv[i+1]:null;if(!source||!target)throw new Error('用法：npm run restore -- <备份目录> --target <新的空目录>');console.log(JSON.stringify(restoreBackup(source,target),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Write progress in the same directory, so an interrupted write keeps the prior receipt. */
export function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
  let fd;
  try{
    fd=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    fs.renameSync(temporary,file);
  }finally{
    if(fd!==undefined)fs.closeSync(fd);
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
}

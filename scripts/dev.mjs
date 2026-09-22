import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ports=[Number(process.env.API_PORT)||8787,5173];
for(const port of ports) await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error('端口 '+port+' 已被占用，请先停止该项目旧服务。')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
const children=[];let closing=false;
function launch(args){const c=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});children.push(c);c.once('error',e=>{console.error(e.message);stop(1);});c.once('exit',code=>{if(!closing)stop(code||1);});return c;}
function stop(code=0){if(closing)return;closing=true;for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');setTimeout(()=>process.exit(code),1500).unref();}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop());
launch(['server/api.mjs']);
launch(['node_modules/vite/bin/vite.js','--config','vite.config.ts']);
console.log('X-RAG：前端 http://localhost:5173，后台 http://127.0.0.1:'+ports[0]);

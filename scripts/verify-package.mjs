import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const files=[];function walk(dir){if(!existsSync(dir))return;for(const ent of readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p);else files.push(p);}}
walk('dist');let bad=[];for(const file of files){if(!/\.(js|html|css|json|map)$/.test(file))continue;const s=readFileSync(file,'utf8');if(/sk-[a-zA-Z0-9_-]{24,}/.test(s))bad.push(file);}
if(!existsSync('dist/index.html'))throw new Error('尚未生成可部署前端。');
if(bad.length)throw new Error('构建产物发现疑似密钥，文件：'+bad.join(', '));
if(!existsSync('server/api.mjs')||!existsSync('server/parser.mjs'))throw new Error('后端文件缺失。');
console.log(JSON.stringify({deployableAssets:files.length,secretScan:'passed',backend:'present',nodeRequired:'24+',status:'passed'}));

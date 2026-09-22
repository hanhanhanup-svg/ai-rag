import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { now, uid } from './database.mjs';
import { isAdmin, canBase, requireValue, cleanString, failure } from './security.mjs';
import { digest, currentActor, revision } from './knowledge-evidence.mjs';

const jobs=new WeakMap();
function publicAddress(address){
  if(isIP(address)===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address);
  if(isIP(address)!==4)return false;const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||(a===192&&b===0)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
}
function loopback(host){return host==='localhost'||host==='127.0.0.1'||host==='::1'||host==='[::1]';}
export async function connectorTarget(value,type,{resolve=lookup}={}){
  let url;try{url=new URL(value);}catch{throw failure(400,'INVALID_SOURCE_URL','来源地址无效。');}
  requireValue(!url.username&&!url.password&&!url.hash&&url.href.length<=2000&&![...url.searchParams.keys()].some(key=>/^(?:api[_-]?key|token|secret|password|authorization)$/i.test(key)),400,'INVALID_SOURCE_URL','来源地址不能包含用户名、密码或片段。');
  requireValue(!/%(?:2e|2f|5c|25)/i.test(url.pathname),400,'SOURCE_PATH_DENIED','来源路径不能包含编码后的路径穿越或分隔符。');
  const hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(type==='web'){const hosts=(process.env.KNOWLEDGE_WEB_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);requireValue(hosts.includes(hostname),400,'WEB_HOST_NOT_ALLOWED','请由运维在 KNOWLEDGE_WEB_ALLOWED_HOSTS 登记该公开站点后再接入。');requireValue(url.protocol==='https:',400,'HTTPS_REQUIRED','公开网页来源仅支持HTTPS。');}
  else {const endpoints=(process.env.KNOWLEDGE_API_ALLOWED_ENDPOINTS||'').split(',').map(x=>x.trim()).filter(Boolean);const allowed=endpoints.some(entry=>{try{const target=new URL(entry),prefix=target.pathname.replace(/\/$/,'');return target.origin===url.origin&&(url.pathname===prefix||url.pathname.startsWith(prefix+'/'));}catch{return false;}});requireValue(allowed,400,'API_ENDPOINT_NOT_ALLOWED','请由运维在 KNOWLEDGE_API_ALLOWED_ENDPOINTS 登记企业API的完整来源与路径前缀。');requireValue(url.protocol==='https:'||(url.protocol==='http:'&&loopback(hostname)&&process.env.KNOWLEDGE_CONNECTOR_ALLOW_HTTP_LOOPBACK==='true'),400,'HTTPS_REQUIRED','企业API须使用HTTPS；仅显式测试配置允许本机HTTP。');}
  let addresses;try{addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolve(hostname,{all:true});}catch{throw failure(400,'SOURCE_HOST_UNRESOLVED','来源主机解析失败。');}
  requireValue(addresses.length>0&&addresses.every(a=>isIP(a.address)),400,'SOURCE_HOST_UNRESOLVED','来源地址没有有效网络地址。');
  if(type==='web')requireValue(addresses.every(a=>publicAddress(a.address)),400,'SOURCE_ADDRESS_DENIED','公开网页入口不能访问内网、环回或保留地址。');
  return {url,addresses};
}
export async function fetchSource(value,type,{token='',maxBytes=5*1024*1024,timeoutMs=15000,resolve}={}){
  const {url,addresses}=await connectorTarget(value,type,{resolve});
  return new Promise((resolveResult,reject)=>{
    const address=addresses[0],transport=url.protocol==='https:'?https:http;
    const req=transport.request(url,{method:'GET',agent:false,headers:{Accept:type==='api'?'application/json':'text/html,text/plain',...(token?{Authorization:'Bearer '+token}:{})},lookup:(_host,options,callback)=>{if(options?.all)callback(null,[address]);else callback(null,address.address,address.family);}},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();reject(failure(502,'SOURCE_REDIRECT_DENIED','来源发生重定向，请登记并使用最终地址；不会自动跟随重定向。'));return;}
      if(res.statusCode!==200){res.resume();reject(failure(502,'SOURCE_HTTP_ERROR','来源请求失败（HTTP '+res.statusCode+'），本次不撤回未见记录。'));return;}
      const parts=[];let bytes=0;res.on('data',part=>{bytes+=part.length;if(bytes>maxBytes){req.destroy();reject(failure(413,'SOURCE_TOO_LARGE','来源响应超过配置大小，请分页或拆分来源。'));}else parts.push(part);});res.on('error',()=>reject(failure(502,'SOURCE_INTERRUPTED','来源传输中断，请重试。')));res.on('end',()=>resolveResult({bytes:Buffer.concat(parts),contentType:String(res.headers['content-type']||''),etag:String(res.headers.etag||''),lastModified:String(res.headers['last-modified']||'')}));
    });
    req.setTimeout(timeoutMs,()=>req.destroy(failure(504,'SOURCE_TIMEOUT','来源响应超时，请检查服务或缩小范围。')));req.on('error',e=>reject(e.status?e:failure(502,'SOURCE_UNAVAILABLE','来源网络连接失败，请检查允许名单和服务状态。')));req.end();
  });
}
export function safeConnector(connector){const {sealedSecret,...value}=connector;return {...value,hasToken:!!sealedSecret,type:connector.type||'folder'};}
function mapping(input){const raw=input.fieldMapping||{},result={id:'id',text:'text',title:'title',revision:'revision',updatedAt:'updatedAt',deleted:'deleted',allowed:'allowed'};for(const key of Object.keys(result))if(raw[key]!==undefined){requireValue(typeof raw[key]==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(raw[key]),400,'INVALID_FIELD_MAPPING','字段映射只支持单层字段名。');result[key]=raw[key];}return result;}
export async function createRemoteConnector(store,user,input,revalidate){
  requireValue(isAdmin(user),403,'ADMIN_REQUIRED','连接器需要管理员权限。');requireValue(['web','api'].includes(input.type),400,'INVALID_CONNECTOR_TYPE','来源类型无效。');const url=cleanString(input.url,2000);await connectorTarget(url,input.type);
  if(input.type==='api')requireValue(input.permissionMapping?.mode==='target_base'&&input.permissionMapping.approved===true,400,'PERMISSION_MAPPING_REQUIRED','业务来源必须明确确认源系统授权映射到目标知识库；未确认的数据不能自动全员可见。');
  const actor=revalidate?revalidate():currentActor(store,user);requireValue(isAdmin(actor)&&canBase(actor,store.get('base',input.baseId)),403,'BASE_ACCESS_DENIED','无权管理目标知识库。');
  const intervalMinutes=Number(input.intervalMinutes)||0;requireValue([0,15,60,1440].includes(intervalMinutes),400,'INVALID_SYNC_INTERVAL','同步周期支持手动、15分钟、每小时或每天。');
  const connector={id:uid('connector_'),type:input.type,name:cleanString(input.name,120)||new URL(url).hostname,url,baseId:input.baseId,ownerId:actor.id,revision:1,status:'ready',createdAt:now(),updatedAt:now(),lastSyncAt:null,lastError:null,cursor:null,intervalMinutes,nextSyncAt:intervalMinutes?new Date(Date.now()+intervalMinutes*60000).toISOString():null,maxPages:Math.max(1,Math.min(20,Number(input.maxPages)||5)),maxBytes:Math.max(1024,Math.min(5*1024*1024,Number(input.maxBytes)||2*1024*1024)),freshnessMinutes:Math.max(15,Math.min(43200,Number(input.freshnessMinutes)||1440)),fieldMapping:mapping(input),permissionMapping:input.type==='api'?{mode:'target_base',approved:true,approvedBy:actor.id,approvedAt:now()}:{mode:'public-web'},...(typeof input.token==='string'&&input.token.trim()?{sealedSecret:store.seal(input.token.trim().slice(0,2000))}:{})};
  store.transaction(()=>{store.put('remoteConnector',connector);store.audit(actor,'connector.created',{target:connector.id,type:connector.type,baseId:connector.baseId});});return safeConnector(connector);
}
export function updateRemoteConnector(store,user,id,input){
  return store.transaction(()=>{const actor=currentActor(store,user);requireValue(isAdmin(actor),403,'ADMIN_REQUIRED','连接器需要管理员权限。');const connector=store.get('remoteConnector',id);requireValue(connector,404,'CONNECTOR_NOT_FOUND','连接器不存在。');revision(input.revision,connector.revision);requireValue(connector.status!=='syncing',409,'CONNECTOR_BUSY','同步过程中不能修改连接器。');const next={...connector,revision:connector.revision+1,updatedAt:now()};if(input.name!==undefined)next.name=cleanString(input.name,120);if(input.intervalMinutes!==undefined){requireValue([0,15,60,1440].includes(Number(input.intervalMinutes)),400,'INVALID_SYNC_INTERVAL','同步周期无效。');next.intervalMinutes=Number(input.intervalMinutes);next.nextSyncAt=next.intervalMinutes?new Date(Date.now()+next.intervalMinutes*60000).toISOString():null;}if(input.active!==undefined)next.active=!!input.active;if(input.token!==undefined){requireValue(typeof input.token==='string'&&input.token.length<=2000,400,'INVALID_TOKEN','来源凭证格式无效。');next.sealedSecret=input.token?store.seal(input.token):null;}store.put('remoteConnector',next);store.audit(actor,'connector.updated',{target:id,changedFields:Object.keys(input).filter(k=>k!=='token')});return safeConnector(next);});
}
function sourceFamily(store,connector,externalId){return store.list('document').filter(d=>d.source?.connectorId===connector.id&&d.source.externalId===externalId);}
function markSource(store,connector,externalId,accessState,freshUntil){
  for(const document of sourceFamily(store,connector,externalId).filter(document=>!document.deletedAt))store.put('document',{...document,source:{...document.source,accessState,freshUntil:accessState==='withdrawn'?document.source.freshUntil:freshUntil,lastVerifiedAt:now()},revision:(document.revision||0)+1,updatedAt:now()});
}
function remoteId(value){requireValue(['string','number'].includes(typeof value)&&String(value).length>0&&String(value).length<=300,422,'SOURCE_RECORD_INVALID','业务记录缺少有效主键。');return String(value);}
function textField(record,key,max=500000){const value=record[key];requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=max,422,'SOURCE_RECORD_INVALID','业务记录正文缺失或超过限制。');return value;}
export async function syncRemoteConnector(context,id){
  const {store,ingest}=context;let actor=context.currentActor?context.currentActor():currentActor(store,context.user);requireValue(isAdmin(actor),403,'ADMIN_REQUIRED','同步需要管理员权限。');
  let connector=store.transaction(()=>{const current=store.get('remoteConnector',id);requireValue(current,404,'CONNECTOR_NOT_FOUND','连接器不存在。');requireValue(current.status!=='syncing',409,'CONNECTOR_BUSY','来源正在同步。');requireValue(current.active!==false,409,'CONNECTOR_DISABLED','来源已停用。');requireValue(canBase(actor,store.get('base',current.baseId)),403,'BASE_ACCESS_DENIED','目标库权限已变更。');const value={...current,status:'syncing',lastError:null,revision:current.revision+1,updatedAt:now()};store.put('remoteConnector',value);return value;});
  const stats={imported:0,updated:0,skipped:0,withdrawn:0,failed:0,partial:false,errors:[]};let cursor=connector.cursor,pages=0,complete=false;
  const freshUntil=new Date(Date.now()+connector.freshnessMinutes*60000).toISOString();
  try{
    const token=connector.sealedSecret?store.unseal(connector.sealedSecret):'';
    const processRecord=async(record,html=false)=>{
      actor=context.currentActor?context.currentActor():currentActor(store,actor);requireValue(isAdmin(actor)&&canBase(actor,store.get('base',connector.baseId)),403,'SOURCE_PERMISSION_CHANGED','同步期间账号或知识库权限已变更。');
      const externalId=remoteId(record.id),receiptId='source_'+digest({connectorId:id,externalId}).slice(0,32),old=store.get('sourceRecord',receiptId);
      // The latest local version is a durable tombstone; sync cannot recreate it.
      const family=sourceFamily(store,connector,externalId).sort((a,b)=>(b.version||1)-(a.version||1));
      if(family[0]?.deletedAt){stats.skipped++;return;}
      if(record.deleted===true||record.allowed===false){store.transaction(()=>{markSource(store,connector,externalId,'withdrawn',freshUntil);store.put('sourceRecord',{...(old||{}),id:receiptId,connectorId:id,externalId,accessState:'withdrawn',updatedAt:now()});store.audit(actor,'source.withdrawn',{target:receiptId,connectorId:id,reason:record.allowed===false?'source_permission_revoked':'source_deleted'});});stats.withdrawn++;return;}
      const content=String(record.text||'');requireValue(content.trim()&&content.length<=500000,422,'SOURCE_RECORD_INVALID','来源正文为空或超过50万字符。');const contentHash=digest(content),sourceRevision=String(record.revision||contentHash);
      if(record.updatedAt&&old?.sourceUpdatedAt&&Date.parse(record.updatedAt)<Date.parse(old.sourceUpdatedAt)){stats.skipped++;return;}
      if(old?.contentHash===contentHash&&old.accessState!=='withdrawn'){store.transaction(()=>{markSource(store,connector,externalId,'active',freshUntil);store.put('sourceRecord',{...old,lastVerifiedAt:now(),sourceUpdatedAt:record.updatedAt||old.sourceUpdatedAt});});stats.skipped++;return;}
      const existing=sourceFamily(store,connector,externalId).find(d=>!d.deletedAt&&d.source.contentHash===contentHash&&d.source.sourceRevision===sourceRevision);
      let document=existing;
      if(document?.source?.accessState==='withdrawn')document=null;
      if(!document){const previous=sourceFamily(store,connector,externalId).sort((a,b)=>(b.version||1)-(a.version||1))[0];const source={type:connector.type,connectorId:id,externalId,sourceRevision,contentHash,capturedAt:now(),sourcePublishedAt:record.updatedAt||null,sourceUrl:connector.url,permissionMappingVersion:connector.permissionMapping.approvedAt||'public',accessState:'active',freshUntil};const result=await ingest(actor,{baseId:connector.baseId,fileName:'source-'+digest(externalId).slice(0,16)+(html?'.html':'.md'),title:String(record.title||connector.name).slice(0,240),duplicateAction:'copy',...(previous?{previousVersionId:previous.id,duplicateAction:'version'}:{}),sourceKind:connector.type==='web'?'reference':'unspecified',businessOwner:'来源连接器维护（待业务认领）',sensitivity:previous?.sensitivity||'internal'}, {bytes:Buffer.from(content),source});document=result.document;if(previous)stats.updated++;else stats.imported++;}else stats.skipped++;
      store.transaction(()=>{store.put('sourceRecord',{id:receiptId,connectorId:id,externalId,sourceRevision,contentHash,documentId:document.id,sourceUpdatedAt:record.updatedAt||null,accessState:'active',lastVerifiedAt:now(),updatedAt:now()});if(old?.accessState!=='withdrawn')markSource(store,connector,externalId,'active',freshUntil);});
    };
    if(connector.type==='web'){const response=await fetchSource(connector.url,'web',{maxBytes:connector.maxBytes});requireValue(/text\/html|text\/plain|application\/xhtml\+xml/i.test(response.contentType),422,'SOURCE_CONTENT_TYPE','网页来源未返回文本HTML内容。');await processRecord({id:connector.url,text:new TextDecoder('utf8',{fatal:true}).decode(response.bytes),title:connector.name,revision:response.etag||digest(response.bytes),updatedAt:Number.isFinite(Date.parse(response.lastModified))?new Date(response.lastModified).toISOString():null},/html/i.test(response.contentType));complete=true;pages=1;}
    else {for(;pages<connector.maxPages;pages++){const url=new URL(connector.url);if(cursor)url.searchParams.set('cursor',cursor);const response=await fetchSource(url.href,'api',{token,maxBytes:connector.maxBytes});let value;try{value=JSON.parse(response.bytes.toString('utf8'));}catch{throw failure(422,'SOURCE_JSON_INVALID','业务API没有返回合法JSON。');}requireValue(value&&Array.isArray(value.records)&&value.records.length<=1000,422,'SOURCE_SCHEMA_INVALID','业务API须返回最多1000条records数组和可选nextCursor。');
        for(const raw of value.records){requireValue(raw&&typeof raw==='object'&&!Array.isArray(raw),422,'SOURCE_RECORD_INVALID','业务记录格式无效。');const m=connector.fieldMapping;await processRecord({id:raw[m.id],title:raw[m.title],text:raw[m.deleted]===true||raw[m.allowed]===false?'':textField(raw,m.text),revision:raw[m.revision],updatedAt:raw[m.updatedAt],deleted:raw[m.deleted],allowed:raw[m.allowed]});}
        const next=value.nextCursor;requireValue(!next||(typeof next==='string'&&next.length<=2000&&next!==cursor),422,'SOURCE_CURSOR_INVALID','业务来源返回无效或重复游标。');if(!next){complete=value.complete!==false;break;}cursor=next;
      }}
    stats.partial=!complete;connector={...store.get('remoteConnector',id),status:complete?'ready':'partial',lastSyncAt:now(),lastError:complete?null:'本次达到分页边界或来源未标完整；未见记录不会撤回。',stats:{...stats,pages:pages+1},cursor:complete?null:connector.cursor,nextSyncAt:connector.intervalMinutes?new Date(Date.now()+connector.intervalMinutes*60000).toISOString():null};
    // Each receipt is durable before moving the cursor. A failed batch leaves its original cursor.
    store.transaction(()=>{store.put('remoteConnector',connector);store.audit(actor,'connector.synced',{target:id,...stats});});
  }catch(error){stats.failed++;stats.partial=true;stats.errors.push({code:error.code||'SOURCE_SYNC_FAILED',message:error.status?error.message:'来源同步失败，请检查连接器配置。'});connector={...store.get('remoteConnector',id),status:'failed',lastError:stats.errors[0].message,stats,cursor:connector.cursor,updatedAt:now(),nextSyncAt:connector.intervalMinutes?new Date(Date.now()+connector.intervalMinutes*60000).toISOString():null};store.put('remoteConnector',connector);}
  return {connector:safeConnector(connector),...stats};
}
export function createRemoteConnectorWorker(context){
  let stopped=false,busy=false,timer;
  for(const connector of context.store.list('remoteConnector').filter(c=>c.status==='syncing'))context.store.put('remoteConnector',{...connector,status:'failed',lastError:'服务重启中断同步，游标未前移；请重试。',updatedAt:now()});
  const tick=async()=>{if(stopped||busy)return;busy=true;try{for(const connector of context.store.list('remoteConnector').filter(c=>c.active!==false&&c.intervalMinutes&&c.nextSyncAt&&Date.parse(c.nextSyncAt)<=Date.now()&&c.status!=='syncing')){if(stopped)break;const user=context.store.get('user',connector.ownerId);if(!user?.active||!isAdmin(user))continue;await syncRemoteConnector({...context,user,currentActor:()=>currentActor(context.store,user)},connector.id);}}finally{busy=false;}};
  if(context.startWorker!==false){timer=setInterval(()=>{tick().catch(()=>{});},60000);timer.unref();}
  return {close:async()=>{stopped=true;if(timer)clearInterval(timer);while(busy)await new Promise(resolve=>setTimeout(resolve,20));}};
}

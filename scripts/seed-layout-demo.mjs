import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Default is read-only against the API. Import is explicit: --apply --backup-id <actual backup id>.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const apply=process.argv.includes('--apply');
const withCases=!process.argv.includes('--documents-only');
const backupId=process.argv[process.argv.indexOf('--backup-id')+1];
const origin='http://localhost:8787';
const output=path.join(root,'output','layout-demo');
const sourceRoot=path.join(root,'fixtures','layout-demo');
const receiptPath=path.join(output,'receipt.json');
const warning='合成示例，非正式运营规程；不代表真实运营记录，不用于现场作业。';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const csv=(headers,rows)=>[headers,...rows].map(row=>row.map(cell=>'"'+String(cell??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
const md=(title,body)=>`# ${title}\n\n> ${warning}\n\n本文为虚构“澄川示例城轨”的平台演示资料。DEMO26 为示例编号空间，与既有 SYN 示例及真实业务资料区分。本文不引用或假扮国家、行业及运营单位正式标准。文中岗位仅表示模拟流程角色，不对应真实人员。\n\n${body.trim()}\n`;
const specs=[];
function add(key,baseName,title,format,body,options={}){specs.push({key:'DEMO26-'+key,baseName,title:'【合成示例】'+title,fileName:'DEMO26-'+key+'.'+format,content:format==='md'?md(title,body):body,targetStatus:'published',summary:title+'。'+warning,sourceKind:'synthetic',...options});}
const equipment=[['001','DEMO26-ST-01','澄川站','自动检票机','AFC','DEMO26-L-01','示例蓝线'],['002','DEMO26-ST-01','澄川站','站厅扶梯','电扶梯','DEMO26-L-01','示例蓝线'],['003','DEMO26-ST-02','星桥站','站台门控制柜','站台门','DEMO26-L-01','示例蓝线'],['004','DEMO26-ST-03','云湾站','环控信息终端','环控','DEMO26-L-02','示例青线']];
add('ASSET-REGISTER','设施设备与维修保障','澄川示例城轨设备与车站台账','csv',csv(['设备编号','设备名称','车站编号','车站','线路编号','线路','专业','所属单位','资料责任岗位','台账核验状态','来源性质'],equipment.map(([id,stationId,station,name,major,lineId,line])=>['DEMO26-EQ-'+id,name,stationId,station,lineId,line,major,'澄川示例城轨','示例设备资料维护岗',id==='004'?'接口说明待补充':'资料字段已登记',warning])),{tags:['设备','台账','车站','DEMO26'],scenario:'maintenance',task:'设备台账核对',graph:true});
add('WORK-ORDERS','设施设备与维修保障','设备维修工单与资料交接清单','csv',csv(['工单编号','设备编号','工单类型','资料核验任务','资料包状态','待补充项','关联资料名称','来源性质'],equipment.map(([id])=>['DEMO26-WO-'+id,'DEMO26-EQ-'+id,'模拟资料核验','核对编号、工单附件和规程索引',id==='003'?'待资料补正':'已整理供核验',id==='003'?'检验附件缺少关联页码':'无；仍须以真实资料复核','DEMO26 设备资料核验包',warning])),{tags:['设备','维修','工单','归档','DEMO26'],scenario:'maintenance',task:'维修工单资料核对',graph:true});
add('ISSUE-REGISTER','设施设备与维修保障','工单资料问题与规程关联表','csv',csv(['工单编号','问题编号','问题摘要','规程编号','规程名称','核验要点','来源性质'],equipment.map(([id])=>['DEMO26-WO-'+id,'DEMO26-ISSUE-'+id,['设备编号须与台账一致','附件版本说明不完整','记录页码待补充','接口资料适用范围需明确'][Number(id)-1],'DEMO26-PROC-'+id,['设备台账标识核验说明','工单附件版本核验说明','归档证据定位说明','资料适用范围登记说明'][Number(id)-1],'核对原文与来源行，不推断设备真实健康状态',warning])),{tags:['设备','工单','问题','规程','DEMO26'],scenario:'maintenance',task:'工单归档材料核对',graph:true});
add('PROCEDURE-INDEX','设施设备与维修保障','设备资料核验规则与证据索引','csv',csv(['规程编号','规程名称','资料编号','资料名称','版本标识','业务用途','核验规则','来源性质'],equipment.map(([id])=>['DEMO26-PROC-'+id,['设备台账标识核验说明','工单附件版本核验说明','归档证据定位说明','资料适用范围登记说明'][Number(id)-1],'DEMO26-DOC-'+id,['台账编号字段说明','附件目录编写示例','资料引用定位示例','适用范围登记示例'][Number(id)-1],'示例版 1','仅核验资料完整性，不指导现场检修',['设备编号必须与台账逐项一致；缺号列为待补充','附件应记录名称和版本；不同版本不自动视为同一依据','引用应保留文档版本和来源行号；缺页码不等于工作未完成','区分已确认范围与待核验范围；未知字段不能自动补全'][Number(id)-1],warning])),{tags:['设备','规程','证据','版本','DEMO26'],scenario:'maintenance',task:'工单归档材料核对',graph:true});
add('STANDARD-INVENTORY','地铁法规与标准','制度来源与版本核验登记示例','csv',csv(['登记编号','资料主题','来源类别','示例版本','应核验项目','当前资料状态','责任岗位','来源性质'],[['DEMO26-REG-001','受控资料目录','内部流程示例','示例版 1','来源地址、受控版本、适用范围','来源登记齐全，待正式资料替换','示例合规资料岗',warning],['DEMO26-REG-002','修订记录模板','内部流程示例','示例版 2','变更条款、废止关系、复审安排','版本差异说明待审核','示例合规资料岗',warning],['DEMO26-REG-003','外部标准引用登记','空白登记模板','示例版 1','正式标准名称、官方出处、有效状态','未填写任何真实标准条款','示例合规资料岗',warning]]),{tags:['制度','版本','来源','规程','DEMO26'],scenario:'operations',task:'运营资料核对'});
add('VERSION-REVIEW','地铁法规与标准','制度版本差异与适用范围审核练习','md',`## 本次审核任务\n\n对两份合成目录“示例版 1”和“示例版 2”进行对照。版本 2 增加“来源定位”字段，并把“资料归档完成”拆为“附件已接收”和“依据已核验”。这是示例文档的字段改动，不是法规更新。\n\n## 审核材料\n\n- 输入：制度来源登记示例、版本差异说明、适用范围登记表。\n- 对照：编号、名称、版本、生效说明、替代关系、原文证据定位。\n- 输出：可发布项、待补充项、需业务确认项分别列示。\n\n## 待审核事项\n\n1. 演示范围仅包括资料管理流程，不包含现场作业授权。\n2. 旧版目录是否留在历史版本中，需要维护岗在发布时确认。\n3. 来源定位字段应填写文件版本与页码或来源行号；尚缺字段应保留“待补充”。\n\n## 核验结论模板\n\n结论应写明“依据哪一版、核验了什么、还有什么未知”。未取得正式原文时，不得写成“已满足运营合规要求”。本文件保留待审核状态，用于演示发布前办理。`,{targetStatus:'review',tags:['制度','版本','审核','DEMO26']});
add('PASSENGER-FLOW','客运组织与乘客服务','车站客流观察与资料口径样表','csv',csv(['记录编号','模拟时段','车站','进站计数示例','出站计数示例','统计口径','资料备注','来源性质'],[['DEMO26-FLOW-001','演示日 07:00–07:30','澄川站',480,365,'30 分钟进出站计数；不代表实时客流','完整示例记录，禁止推断容量阈值',warning],['DEMO26-FLOW-002','演示日 07:30–08:00','澄川站',620,408,'同上；仅演示完整记录汇总','可用于检验两行求和与来源行引用',warning],['DEMO26-FLOW-003','演示日 07:00–07:30','星桥站',315,420,'同上；车站间不可直接推断拥挤程度','缺少站厅空间及流向资料',warning],['DEMO26-FLOW-004','演示日 07:30–08:00','星桥站',405,530,'同上；仅为虚构数值','需区分进站与出站指标',warning],['DEMO26-FLOW-005','演示日 07:00–07:30','云湾站',260,190,'同上；不作为组织决策依据','未附正式客运组织方案',warning],['DEMO26-FLOW-006','演示日 07:30–08:00','云湾站',330,225,'同上；无真实监测来源','用于平台表格查询演示',warning]]),{tags:['客流','客运','统计口径','DEMO26'],scenario:'operations',task:'客流资料查阅'});
add('SERVICE-CASE','客运组织与乘客服务','无障碍服务资料核对案例草稿','md',`## 场景\n\n虚构乘客咨询某车站的无障碍设施信息。示例受理岗需要核对车站名称、设施资料版本、服务范围和信息更新时间。本文不登记乘客身份、联系方式或真实行程。\n\n## 已有材料\n\n- 车站服务资料目录：包含设施位置说明与服务联系渠道字段。\n- 服务案例编写模板：包含问题、资料来源、核验过程、待补充材料。\n- 合成设备台账：仅供演示对象关联，不能确认现场设施是否正常。\n\n## 核对步骤\n\n先确认咨询的是哪个车站，再核对来源文件是否包含相关服务信息。遇到资料没有说明的服务时间或设施状态，应标记未知，并转交具有当日权威信息的服务渠道。不可凭设备台账推断实时可用性。\n\n## 草稿遗留问题\n\n本例缺少正式服务信息来源和更新时间，保留待审核。审核者应补充来源或明确仅作为培训案例；不得把案例练习发布成乘客出行承诺。\n\n## 推荐反馈方式\n\n问题类型选“缺少知识”，关联当前草稿版本，说明缺少哪一字段和需要何种原文资料。解决记录须能回到补充后的文档版本。`,{targetStatus:'review',tags:['客运','服务','无障碍','案例','DEMO26']});
add('SAFETY-MATERIALS','安全管理与应急体系','安全学习资料适用范围核验清单','md',`## 使用目的\n\n帮助资料维护人员区分“安全学习材料”“演练记录”“正式应急预案”和“现场指令”。本文件仅提供资料核验字段，不规定风险阈值、技术动作或应急处置步骤。\n\n## 核验字段\n\n1. 资料名称、唯一编号、版本、来源性质与维护责任岗位。\n2. 适用组织、对象、时间范围及明确不适用的场景。\n3. 资料来源的位置、原文附件、引用页码或表格来源行号。\n4. 审核记录和复审日期；复审到期不等于文档自动失效。\n5. 替代版本和停用说明；存在冲突时保留双方证据。\n\n## 示例发现\n\nDEMO26-SAFE-001 的学习目录已登记来源性质，但“正式预案关联”仍为空。应记录为资料缺口，不应判定演练未开展或人员能力不足。维护岗可发起澄清事项，核验完成后登记结论与依据。\n\n## 待复审安排\n\n本资料的复审计划刻意设置为到期，用于演示工作台的时效待办。状态仍为已发布合成示例；未提供任何真实运营安全结论。正式上线前应由业务负责人替换为受控资料并重新确定适用范围。`,{overdue:true,tags:['安全','复审','资料核验','DEMO26'],scenario:'training',task:'学习资料核对'});
add('DRILL-REVIEW','安全管理与应急体系','桌面演练资料归集与复盘样例','md',`## 演练性质\n\nDEMO26-DRILL-001 是桌面资料演示，未真实组织演练，也未记录人员表现、完成时长或处置成效。所有角色为“示例组织岗”“示例记录岗”“示例资料核验岗”。\n\n## 模拟材料包\n\n| 材料 | 示例状态 | 需核对内容 |\n| --- | --- | --- |\n| 演练方案目录 | 待补充 | 受控文件及批准信息 |\n| 场景脚本 | 合成草稿 | 仅训练资料办理流程 |\n| 记录模板 | 已提供示例 | 来源、时间口径、附件索引 |\n| 复盘问题单 | 草稿 | 问题与事实依据分别登记 |\n\n## 复盘问题单\n\n问题 DEMO26-DRILL-ISSUE-001：资料包缺少正式方案的版本依据。需要补齐或明确不适用，不能写成“实际演练未按方案执行”。\n\n问题 DEMO26-DRILL-ISSUE-002：附件目录没有来源页码。应补充证据定位；暂不对事件经过作额外推断。\n\n## 本轮办理边界\n\n本文件保持待审核，演示资料归集、审核反馈和补充材料的入口。不能作为应急处置指令，也不能用于评价真实岗位人员。`,{targetStatus:'review',tags:['安全','演练','复盘','待审核','DEMO26']});
add('SHIFT-RECORDS','运营管理与知识治理','交接班知识事项与待跟进清单','csv',csv(['事项编号','班次标识','主题','已有资料','待跟进事项','示例责任岗位','知识办理状态','来源性质'],[['DEMO26-SHIFT-001','演示早班','设备资料版本核对','DEMO26 设备资料包','核实附件版本说明','示例资料维护岗','处理中',warning],['DEMO26-SHIFT-002','演示早班','客流统计口径澄清','DEMO26 客流观察样表','区分进出站数量与站内密度','示例运营资料岗','待核验',warning],['DEMO26-SHIFT-003','演示晚班','服务案例知识补充','DEMO26 无障碍服务案例草稿','补充正式来源与适用范围','示例客运资料岗','待补充',warning],['DEMO26-SHIFT-004','演示晚班','培训材料复审提醒','DEMO26 备课资料包','核对引用版本','示例培训资料岗','已登记',warning]]),{overdue:true,tags:['运营','交接','知识治理','DEMO26'],scenario:'operations',task:'交接班记录整理'});
add('KNOWLEDGE-WORKFLOW','运营管理与知识治理','知识反馈修订与核验闭环说明','md',`## 闭环对象\n\n本说明的对象是知识问题，包括资料缺失、适用范围不明、引用版本不符和来源定位不完整。知识问题与设备故障、服务事件应分别管理，不能根据知识缺口推断真实业务异常。\n\n## 办理过程\n\n发现问题后，关联原始文档与版本；若来自问答，同时保留问题和引用来源。受理时明确责任岗位、需补充材料和办理理由。修订型事项要产生新版本，经审核后核验；澄清型事项可以通过原文解释解决，但仍需写明核验依据。\n\n## 结案证据\n\n结案记录至少说明：原问题是什么、查阅了哪份资料的哪一版、怎样核验、结论适用在哪里。资料内容未变化的澄清，不需要伪造新版本；发生正文变化的修订，应保留旧版与新版关系。\n\n## 示例澄清\n\n用户把“复审日期”理解为“文档失效日期”。核验本说明后，明确两者分别管理：复审是维护计划，失效是知识可用性条件。可以记录一条澄清核验事项，引用本说明的当前已发布示例版本。该办理记录仅表示本次平台演示核验真实执行。\n\n## 运行记录\n\n平台应只显示实际发生的上传、解析、发布和办理操作。不得填充虚假的历史问答量、模型评测通过率、用户阅读量或运营绩效。`,{tags:['运营','治理','反馈','知识闭环','DEMO26'],scenario:'operations',task:'运营资料核对'});
add('TRAINING-PLAN','岗位培训与经验案例','资料核验岗位学习与备课包','md',`## 学习目标\n\n学员能够区分原文事实、资料缺口和待核验判断；能够准确引用文档版本与来源行；能够把未解决问题送入反馈办理。本文不记录真实人员学时、成绩或能力评价。\n\n## 备课模块\n\n| 模块 | 资料输入 | 课堂练习 | 可核对产物 |\n| --- | --- | --- | --- |\n| 对象标识 | DEMO26 设备台账 | 找到设备与车站 | 编号及来源行 |\n| 关联依据 | 工单、问题、规程索引 | 追溯三跳证据 | 每条关系的原文 |\n| 统计口径 | DEMO26 客流观察样表 | 区分进站与出站统计 | 使用记录范围与计算依据 |\n| 反馈办理 | 知识闭环说明 | 填写资料缺失反馈 | 问题、版本及待补充项 |\n\n## 备课检查\n\n先检查所引用示例资料是否已发布且版本仍有效。草稿可以用于审核练习，但不能作为知识问答的已确认依据。若图谱关系尚未核验，应在练习中标明候选关系，不把候选关系写进事实结论。\n\n## 练习评议\n\n只对练习产物是否具备明确来源、完整条件和可追溯记录进行讨论。没有证据的内容标记待补充，不自动判为学员能力不足。正式培训制度和考核标准需另行接入受控文件。`,{tags:['培训','学习','岗位','备课','DEMO26'],scenario:'training',task:'培训资料查阅'});
add('TRAINING-QUESTIONS','岗位培训与经验案例','设备资料核验练习题与参考依据草稿','md',`## 练习材料\n\n使用 DEMO26 台账、工单、问题与规程索引，以及知识反馈闭环说明。当前题单保持待审核，不代表已经运行模型评测，也不记录任何真实学员作答。\n\n## 题目一：定位资料\n\nDEMO26-EQ-001 属于哪个车站，其关联工单是什么？参考核验方法：分别查台账和工单的设备编号，记录文档版本与来源行号，不能凭名称相似建立关联。\n\n## 题目二：追溯依据\n\n工单 DEMO26-WO-003 的资料问题与哪份规程索引关联？参考核验方法：保留工单、问题、规程三者的明确编号，并逐条核查来源行；不把资料问题描述成真实设备故障。\n\n## 题目三：识别未知\n\n能否根据设备台账确认设备此刻运行正常？预期应说明台账不提供实时状态，不能作此结论；需要实际、有效、经过授权的运行来源。\n\n## 题目四：办理澄清\n\n一份资料到复审日期但未到失效日期，是否必然下架？参考知识闭环说明，区分维护计划和有效性条件，并登记本次核验依据。\n\n## 待审核清单\n\n核对题目引用的文件、编号和版本，补充必要原文定位。正式启用前需要按实际业务验证题目适用性；本文件不声称评测已经通过。`,{targetStatus:'review',tags:['培训','练习','审核','DEMO26']});

assert.equal(specs.length,14);
assert.equal(new Set(specs.map(s=>s.fileName)).size,14);
assert.equal(new Set(specs.map(s=>s.baseName)).size,6);
assert.ok(specs.every(s=>s.content.includes(warning)&&s.fileName.startsWith('DEMO26-')));
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(sourceRoot,{recursive:true});
for(const spec of specs){fs.writeFileSync(path.join(sourceRoot,spec.fileName),spec.content,'utf8');spec.sha256=sha(spec.content);}
const manifest={schemaVersion:1,namespace:'DEMO26',generatedAt:new Date().toISOString(),warning,documentCount:specs.length,bases:[...new Set(specs.map(s=>s.baseName))],documents:specs.map(({content,...spec})=>({...spec,bytes:Buffer.byteLength(content)})),noModelCalls:true};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
async function api(route,method='GET',body){for(let attempt=0;attempt<5;attempt++){const res=await fetch(origin+'/api'+route,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});const data=await res.json();if(res.status===429){await sleep(15000);continue;}if(!res.ok)throw new Error(`${method} ${route}: ${res.status} ${data.error?.message||'请求失败'}`);return data;}throw new Error('请求持续限流，请稍后重试。');}
async function documents(){const list=[];let offset=0;for(;;){const r=await api('/documents?limit=500&offset='+offset);list.push(...r.documents);if(!r.pagination?.hasMore)return list;offset=r.pagination.nextOffset;}}
const user=(await api('/auth/me')).user;
assert.ok(user.authMode==='local'&&user.role==='admin','仅本机免登录管理员工作空间可导入此示例包。');
const current=await documents();
const bases=(await api('/bases')).bases;
for(const spec of specs){const base=bases.find(b=>b.name===spec.baseName);assert.ok(base,'找不到现有业务知识库：'+spec.baseName);spec.baseId=base.id;const old=current.filter(d=>d.baseId===base.id&&d.fileName===spec.fileName);assert.ok(old.every(d=>d.sha256===spec.sha256),'示例原件发生变化，需人工确认后另建版本：'+spec.fileName);}
const preexisting=current.filter(d=>!d.fileName.startsWith('DEMO26-')).map(d=>({id:d.id,title:d.title,sha256:d.sha256,version:d.version,status:d.status,revision:d.revision}));
const beforePath=path.join(output,apply?'before-apply.json':'before-dry-run.json');
if(!fs.existsSync(beforePath))fs.writeFileSync(beforePath,JSON.stringify({capturedAt:new Date().toISOString(),documents:preexisting},null,2));
const plan={mode:apply?'apply':'dry-run',total:specs.length,alreadyPresent:specs.filter(s=>current.some(d=>d.baseId===s.baseId&&d.fileName===s.fileName)).length,published:specs.filter(s=>s.targetStatus==='published').length,pendingReview:specs.filter(s=>s.targetStatus==='review').length,reviewOverdue:specs.filter(s=>s.overdue).length,preexistingDocuments:preexisting.length,modelCalls:0,manifest:path.relative(root,path.join(output,'manifest.json'))};
console.log(JSON.stringify(plan,null,2));
if(!apply){console.log('预演完成，未写入平台。实际导入：node scripts/seed-layout-demo.mjs --apply --backup-id <实际备份ID>');}
if(apply){
assert.ok(process.argv.includes('--backup-id')&&backupId?.startsWith('backup-'),'实际导入前须由主任务创建备份并传入 --backup-id。');
const operationState=await api('/operations');
const backups=operationState.backups||[];
assert.ok(backups.some(b=>b.id===backupId),'提供的备份不在平台备份记录中。');
const receipt=fs.existsSync(receiptPath)?JSON.parse(fs.readFileSync(receiptPath,'utf8')):{schemaVersion:1,startedAt:new Date().toISOString(),backupId,documents:{},links:{},cases:{}};
const save=()=>fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));
receipt.lastStartedAt=new Date().toISOString();receipt.status='running';save();
try{
  for(const spec of specs){
    let doc=current.find(d=>d.baseId===spec.baseId&&d.fileName===spec.fileName&&d.sha256===spec.sha256);
    if(receipt.documents[spec.key]?.complete&&doc){console.log('[复用] '+doc.title);continue;}
    if(!doc){doc=(await api('/documents','POST',{fileName:spec.fileName,title:spec.title,contentBase64:Buffer.from(spec.content).toString('base64'),baseId:spec.baseId,duplicateAction:'skip',sensitivity:'internal',sourceKind:'synthetic',businessOwner:'示例资料维护岗（待实际业务认领）',applicability:warning+'仅用于资料检索、核验与知识治理流程演示。',reviewDueAt:new Date(Date.now()+(spec.overdue?-1:90)*86400000).toISOString()})).document;current.push(doc);}
    const deadline=Date.now()+180000;
    while(['queued','processing'].includes(doc.status)&&Date.now()<deadline){await sleep(2000);doc=(await api('/documents/'+doc.id)).document;}
    assert.ok(['review','published'].includes(doc.status),'资料未完成解析：'+spec.fileName+' '+doc.status);
    assert.equal(doc.sha256,spec.sha256);
    if(doc.status==='review'){
      doc=(await api('/documents/'+doc.id,'PATCH',{revision:doc.revision,title:spec.title,summary:spec.summary,tags:['合成示例','功能布局示例包',...spec.tags]})).document;
      if(spec.targetStatus==='published')doc=(await api('/documents/'+doc.id+'/actions','POST',{action:'publish',revision:doc.revision,reason:'核对 DEMO26 示例标识、原件哈希、正文和字段，发布用于平台演示；非运营单位正式审核。'})).document;
    }
    const chunks=(await api('/documents/'+doc.id)).chunks;
    assert.ok(chunks.length,'资料解析后没有片段：'+spec.fileName);
    if(spec.graph&&doc.status==='published'){
      const result=await api('/documents/'+doc.id+'/relations/extract','POST',{revision:doc.revision});
      const candidates=result.relations.filter(r=>r.status==='candidate');
      for(let offset=0;offset<candidates.length;offset+=50){const batch=candidates.slice(offset,offset+50);await api('/graph/relations/review','POST',{ids:batch.map(r=>({id:r.id,revision:r.revision})),action:'confirm',reason:'已逐行核对 DEMO26 合成台账中明确编号及关联字段；仅确认示例原文关系，不代表真实运营状态。'});}
    }
    receipt.documents[spec.key]={id:doc.id,title:doc.title,baseId:doc.baseId,version:doc.version,status:doc.status,sha256:doc.sha256,reviewDueAt:doc.reviewDueAt,complete:true};save();console.log('[入库] '+doc.status+' '+doc.title);
  }
  const links=(await api('/recommendation-links')).links;
  for(const spec of specs.filter(s=>s.scenario)){
    const doc=receipt.documents[spec.key];if(!doc||doc.status!=='published')continue;
    let link=links.find(l=>l.documentId===doc.id&&l.scenario===spec.scenario&&l.task===spec.task);
    if(!link){link=(await api('/recommendation-links','POST',{documentId:doc.id,scenario:spec.scenario,task:spec.task,status:'approved',reason:'DEMO26 合成示例：'+spec.title+'包含本任务所需的资料字段或核验说明；不代表正式业务授权。'})).link;links.push(link);}
    receipt.links[spec.key]={id:link.id,documentId:doc.id};save();
  }
  if(withCases){
    const cases=[
      {key:'CASE-SOURCE',doc:'DEMO26-SERVICE-CASE',title:'【合成示例】补齐无障碍服务案例正式来源',description:'DEMO26 服务案例草稿缺少正式来源和更新时间。演示资料补充待办，不表示真实乘客服务异常。',kind:'revision',status:'open',assigneeLabel:'示例客运资料维护岗'},
      {key:'CASE-VERSION',doc:'DEMO26-VERSION-REVIEW',title:'【合成示例】核对制度目录变更与适用范围',description:'DEMO26 制度版本差异草稿需要核对版本替代说明与适用范围，当前演示受理后处理中。',kind:'revision',status:'in_progress',assigneeLabel:'示例合规资料维护岗'},
      {key:'CASE-REVIEW-DATE',doc:'DEMO26-KNOWLEDGE-WORKFLOW',title:'【合成示例】澄清复审日期与失效日期的区别',description:'DEMO26 演示用户将资料复审到期理解为自动下架。按当前发布的知识闭环说明进行资料澄清核验；未调用模型或伪造评测。',kind:'clarification',status:'verified',assigneeLabel:'示例知识运营岗'},
      {key:'CASE-EVIDENCE',doc:'DEMO26-DRILL-REVIEW',title:'【合成示例】补全演练资料附件来源定位',description:'DEMO26 桌面演练资料缺少正式方案版本和附件页码，保留资料缺口供后续补齐；并未开展真实演练。',kind:'revision',status:'open',assigneeLabel:'示例安全资料维护岗'},
    ];
    for(const spec of cases){
      if(receipt.cases[spec.key]?.complete)continue;
      const doc=receipt.documents[spec.doc];assert.ok(doc);
      let item=(await api('/workspace/cases','POST',{seedKey:'DEMO26-'+spec.key,title:spec.title,description:spec.description,kind:spec.kind,sourceKind:'synthetic',documentId:doc.id,documentVersion:doc.version,baseId:doc.baseId,assigneeLabel:spec.assigneeLabel,dueAt:new Date(Date.now()+7*86400000).toISOString()})).case;
      assert.ok(item,'治理事项创建接口未返回 case。');
      if(spec.status!=='open'&&item.status==='open')item=(await api('/workspace/cases/'+item.id,'PATCH',{revision:item.revision,status:'in_progress',reason:'本次平台演示实际受理，按已关联的合成原文核验。'})).case;
      if(spec.status==='verified'){const evidence=await api('/documents/'+doc.id);assert.ok(evidence.chunks.some(c=>c.text.includes('复审是维护计划，失效是知识可用性条件')),'澄清事项的原文依据未找到');}
      if(spec.status==='verified'&&item.status==='in_progress')item=(await api('/workspace/cases/'+item.id,'PATCH',{revision:item.revision,status:'verified',reason:'已核对当前合成说明，复审计划与失效条件分别管理，澄清结果与原文一致。',verification:{documentId:doc.id,documentVersion:doc.version,note:'核对《知识反馈修订与核验闭环说明》示例澄清段：复审是维护计划，失效是知识可用性条件。资料正文未变更，因此使用当前发布版本完成澄清核验。本次未执行模型评测。'}})).case;
      receipt.cases[spec.key]={id:item.id,status:item.status,complete:true};save();console.log('[办理示例] '+item.status+' '+spec.title);
    }
  }
  if(operationState.model?.embeddingEnabled){
    const indexDeadline=Date.now()+180000;let pending=[];
    do{const indexed=await documents();pending=specs.filter(s=>s.targetStatus==='published').map(s=>indexed.find(d=>d.id===receipt.documents[s.key].id)).filter(d=>d?.embeddingStatus!=='ready');assert.ok(pending.every(d=>d&&d.embeddingStatus!=='failed'),'合成资料语义索引失败，请在处理任务中核验。');if(!pending.length)break;console.log('[索引] 待完成 '+pending.length+' 份示例资料');await sleep(4000);}while(Date.now()<indexDeadline);
    assert.equal(pending.length,0,'示例资料索引仍未完成，可稍后幂等重跑验收。');
  }
  const after=await documents();
  for(const before of JSON.parse(fs.readFileSync(beforePath,'utf8')).documents){const next=after.find(d=>d.id===before.id);assert.ok(next,'既有资料丢失：'+before.id);assert.equal(next.sha256,before.sha256,'既有原件哈希发生变化');assert.equal(next.version,before.version,'既有资料版本发生变化');assert.equal(next.status,before.status,'既有资料状态发生变化');}
  for(const spec of specs){assert.equal(after.filter(d=>d.baseId===spec.baseId&&d.fileName===spec.fileName).length,1,'示例文档出现重复版本：'+spec.fileName);}
  const graph=await api('/graph?query=DEMO26-EQ-001&hops=3&status=confirmed');
  assert.ok(graph.paths.some(p=>p.nodes.map(n=>n.externalId).join(' ').includes('DEMO26-PROC-001')),'DEMO26 三跳关系未形成');
  receipt.status='completed';receipt.completedAt=new Date().toISOString();receipt.validation={preexistingUnchanged:preexisting.length,documents:specs.length,confirmedGraphPathCount:graph.paths.length,noModelCalls:true};save();
  fs.writeFileSync(path.join(output,'验收清单.md'),'# 功能布局示例数据导入清单\n\n本次通过真实上传、解析、发布、关系核验和事项办理接口完成。所有业务内容均为合成示例，非正式运营规程；系统时间来自实际执行。未创建虚假的历史访问量、问答量、模型评测或员工评价。\n\n| 资料 | 知识库 | 状态 | 来源哈希 |\n| --- | --- | --- | --- |\n'+specs.map(s=>'| '+s.title+' | '+s.baseName+' | '+receipt.documents[s.key].status+' | '+s.sha256.slice(0,12)+' |').join('\n')+'\n\n既有资料 '+preexisting.length+' 份原件登记哈希、版本及状态保持不变。新资料 '+specs.length+' 份，默认发布 '+plan.published+' 份、待审核 '+plan.pendingReview+' 份，其中 '+plan.reviewOverdue+' 份示例复审计划到期。治理事项 '+Object.keys(receipt.cases).length+' 条；办理状态来自实际接口执行。备份：'+receipt.backupId+'。\n');
  console.log(JSON.stringify(receipt.validation,null,2));
}catch(error){receipt.status='failed';receipt.error=error.message;save();throw error;}

}

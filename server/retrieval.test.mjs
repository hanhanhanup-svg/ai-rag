import test from 'node:test';
import assert from 'node:assert/strict';
import { search } from './retrieval.mjs';

test('heading markup cannot crowd out evidence; title and section discovery remain available', async()=>{
  const user={id:'reader',role:'viewer',active:true};
  const base={id:'base',visibility:'company'};
  const document={id:'handover',baseId:base.id,title:'SUP-12 项目移交与未结事项管理',fileName:'handover.md',status:'published',version:1};
  const unrelated={id:'finance',baseId:base.id,title:'FIN-8 财务凭证整理',fileName:'finance.md',status:'published',version:1};
  const passages=[
    {id:'intro',heading:document.title,text:'本文件用于项目移交业务讨论，帮助相关人员理解未结事项的背景和管理范围。正式工作应核对经批准的版本。'},
    {id:'responsibility',heading:'一、责任分工',text:'移交人员整理本阶段的工作事项，接收人员逐项确认相关内容。责任不清的问题交由负责人协调。未结任务应保持可追溯。'},
    {id:'steps',heading:'二、移交步骤',text:'项目移交前检查记录及附件，说明未结事项及接收范围。接收人员核对材料，信息不足时补充说明，后续进展接续记录。'},
    {id:'evidence',heading:'三、登记字段',text:'未结事项记录应登记当前进展、下一步动作、接续责任岗位和复核条件，并关联事项编号。材料不完整时注明资料缺口及后续核对安排。'},
  ];
  function fixture(withMarkup){
    const docs=[document,unrelated],chunks=passages.map((p,index)=>({...p,documentId:document.id,page:1,ordinal:index,text:withMarkup?(index===0?'# ':'## ')+p.heading+'\n\n'+p.text:p.text}));
    const other={id:'other',documentId:unrelated.id,page:1,ordinal:0,heading:'凭证保存',text:'财务凭证按年度和凭证编号保存，申请查阅时登记用途。'};
    return {
      list:kind=>kind==='document'?docs:[],
      get:(kind,id)=>kind==='user'&&id===user.id?user:kind==='base'&&id===base.id?base:kind==='document'?docs.find(d=>d.id===id):kind==='setting'?{id:'model',provider:'disabled'}:null,
      chunks:id=>id===document.id?chunks:[other],
      vectors:()=>[],
    };
  }
  const question='项目移交时，未结事项应登记哪些内容？';
  const plain=await search(fixture(false),user,question,{semantic:false,limit:8});
  const markdown=await search(fixture(true),user,question,{semantic:false,limit:8});
  assert.deepEqual(markdown.results.map(r=>({id:r.id,score:r.score})),plain.results.map(r=>({id:r.id,score:r.score})),'Adding headings already present in metadata must not change relevance or evict supporting passages.');
  assert.ok(markdown.results.some(r=>r.id==='evidence'&&r.text.includes('当前进展、下一步动作、接续责任岗位和复核条件')),'Evidence must remain within the three-passage document budget.');
  const byTitle=await search(fixture(true),user,'SUP-12',{semantic:false,limit:1});
  assert.equal(byTitle.results[0]?.documentId,document.id,'Exact document identifiers must still discover their source.');
  const bySection=await search(fixture(true),user,'登记字段',{semantic:false,limit:1});
  assert.equal(bySection.results[0]?.id,'evidence','A section heading must still identify a passage when the term is absent from its body.');
});

import { createTable } from './table-parser.mjs';
export function parseOcrTsv(tsv){
  const lines=String(tsv||'').trim().split(/\r?\n/),words=[];let width=0,height=0;
  for(const line of lines.slice(1)){const parts=line.split('\t'),level=Number(parts[0]);if(level===1){width=Number(parts[8]);height=Number(parts[9]);}if(level!==5||parts.length<12)continue;const text=parts.slice(11).join('\t').trim(),left=Number(parts[6]),top=Number(parts[7]),w=Number(parts[8]),h=Number(parts[9]),confidence=Number(parts[10]);if(!text||![left,top,w,h].every(Number.isFinite)||w<=0||h<=0)continue;words.push({text,left,top,width:w,height:h,confidence:Number.isFinite(confidence)?confidence:null,lineKey:parts.slice(1,5).join(':')});}
  return {words,width,height};
}
const clean=text=>String(text).replace(/(?<=[\u3400-\u9fff]) (?=[\u3400-\u9fff])/g,'').trim();
function box(words){return [Math.min(...words.map(w=>w.left)),Math.min(...words.map(w=>w.top)),Math.max(...words.map(w=>w.left+w.width)),Math.max(...words.map(w=>w.top+w.height))];}
export function ocrEvidence(data,page,limits){
  const words=(data.words||[]).filter(w=>w.text.trim());if(!words.length)return null;
  if(words.length>50000)throw Object.assign(new Error('OCR词框超过50000个，请拆分文件。'),{code:'DOCUMENT_LIMIT',status:422,statusCode:422});
  const sizes=words.map(w=>w.height).sort((a,b)=>a-b),median=sizes[Math.floor(sizes.length/2)]||20,rows=[];
  for(const word of [...words].sort((a,b)=>(a.top+a.height/2)-(b.top+b.height/2)||a.left-b.left)){const center=word.top+word.height/2;let row=rows.at(-1);if(!row||Math.abs(row.center-center)>median*0.65){row={center,words:[]};rows.push(row);}row.words.push(word);}
  for(const row of rows){row.words.sort((a,b)=>a.left-b.left);row.cells=[];let end=-Infinity;for(const word of row.words){if(!row.cells.length||word.left-end>Math.max(24,median*1.6))row.cells.push({words:[]});row.cells.at(-1).words.push(word);end=word.left+word.width;}for(const cell of row.cells){cell.text=clean(cell.words.map(w=>w.text).join(' '));cell.bbox=box(cell.words);}row.bbox=box(row.words);}
  const locator=bbox=>({page,pageKind:'physical',bbox,coordinateSystem:'image-top-left',unit:'px',...(data.width&&data.height?{pageWidth:data.width,pageHeight:data.height}:{})});
  const blocks=[];let tables=0;
  for(let i=0;i<rows.length;){
    const row=rows[i],width=row.cells.length;let end=i+1;
    if(width>=2&&width<=20)while(end<rows.length&&rows[end].cells.length===width&&rows[end].center-rows[end-1].center<median*6&&rows[end].cells.every((cell,n)=>Math.abs(cell.bbox[0]-row.cells[n].bbox[0])<=Math.max(40,median*2.5)))end++;
    if(width>=2&&end-i>=3){
      const group=rows.slice(i,end),table=createTable(group.map(r=>r.cells.map(c=>c.text)),{tableId:'ocr:page:'+page+':table:'+ ++tables,name:'第'+page+'页扫描表格候选'+tables,format:'ocr'},limits);
      if(table.headerSource==='first-row'){
        const bbox=box(group.flatMap(r=>r.words));table.reviewRequired=true;table.locator=locator(bbox);table.cellBounds=group.flatMap((r,ri)=>r.cells.map((c,ci)=>({row:ri+1,column:ci+1,bbox:c.bbox})));table.extractionMethod='ocr-word-box-alignment';
        blocks.push({type:'table',text:group.map(r=>r.cells.map(c=>c.text).join('\t')).join('\n'),table,locator:table.locator,quality:{text:'unreviewed',numeric:'unreviewed',structure:'candidate',method:'ocr-word-box-alignment'}});i=end;continue;
      }
    }
    blocks.push({type:'paragraph',text:clean(row.words.map(w=>w.text).join(' ')),locator:locator(row.bbox),quality:{text:'unreviewed',numeric:'unreviewed',method:'ocr-word-boxes'}});i++;
  }
  return {blocks,tableCount:tables,method:'ocr-word-boxes-v1'};
}

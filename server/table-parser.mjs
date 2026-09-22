function reject(message, code='DOCUMENT_LIMIT') {
  throw Object.assign(new Error(message), {name:'DocumentParseError',code,status:422,statusCode:422});
}

/** Preserve cells and source row identity; do not infer values for blank cells. */
export function createTable(records,{tableId,name,format,rowNumbers},limits) {
  if(!Array.isArray(records)||records.some(row=>!Array.isArray(row)))reject('表格记录结构无效。','INVALID_DOCUMENT');
  if(records.length>limits.rows)reject('表格超过允许的行数，请拆分文件。');
  const width=records.reduce((max,row)=>Math.max(max,row.length),0);
  if(width>limits.columns)reject('表格超过允许的列数，请拆分文件。');
  const normalized=records.map(row=>Array.from({length:width},(_,i)=>String(row[i]??'')));
  const first=normalized[0]||[];
  const nonempty=first.filter(value=>value.trim());
  // CSV convention uses a header. Numeric/date-like first rows remain data;
  // sparse title rows in workbooks also remain data with generated column names.
  const header=records.length>0&&nonempty.length>=2&&records[0].length===width&&nonempty.every(value=>!/^[-+]?\d|^\d{4}[-/]/.test(value.trim()));
  const originalHeaders=header?first:Array.from({length:width},(_,i)=>`列${i+1}`);
  const headers=originalHeaders.map((value,i)=>{
    const label=value.trim()||`列${i+1}`;
    return originalHeaders.filter(v=>v.trim()===label).length>1?`${label}（列${i+1}）`:label;
  });
  const rows=header?normalized.slice(1):normalized;
  const numbers=(rowNumbers||records.map((_,i)=>i+1)).slice(header?1:0);
  if(numbers.length!==rows.length||numbers.some(n=>!Number.isInteger(n)||n<1))reject('表格来源行号无效。','INVALID_DOCUMENT');
  const fieldTypes=headers.map((_,column)=>{const values=rows.map(row=>row[column]).filter(v=>v.trim());if(!values.length)return 'unknown';if(values.every(v=>/^[-+]?\d+(?:\.\d+)?$/.test(v.trim())))return 'number';if(values.every(v=>/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(v.trim())))return 'date';return 'text';});
  return {schemaVersion:1,tableId,name,format,headers,rows,rowNumbers:numbers,totalRows:rows.length,fieldTypes,headerRowNumber:header?(rowNumbers?.[0]||1):null,headerSource:header?'first-row':'generated',rowNumberKind:format==='xlsx'?'worksheet-row':['csv','tsv'].includes(format)?'record-number':'table-row'};
}

const cellText=value=>String(value).replace(/[\t\r\n]+/g,' ');

/** An evidence chunk contains whole rows and its own header; rows never overlap. */
export function chunkTable(table,page,limits,startOrdinal=1) {
  if(!table||table.schemaVersion!==1||!Array.isArray(table.headers)||!Array.isArray(table.rows)||table.rows.length!==table.totalRows||table.rows.some(r=>!Array.isArray(r)||r.length!==table.headers.length))reject('表格结构或记录数不完整，请重新解析。','INVALID_DOCUMENT');
  const header=table.headers.map(cellText).join('\t');
  const label=`表格：${table.name||'数据表'}`;
  const lines=table.rows.map((row,i)=>`[数据行${i+1}，源${table.rowNumberKind==='worksheet-row'?'行':'记录'}${table.rowNumbers[i]}] ${row.map(cellText).join('\t')}`);
  const limit=limits.tableRowChars||12000;
  if(header.length+label.length+80>limit)reject('表格列名过长，请按业务范围拆分列后重新上传。');
  if(lines.some(line=>line.length+header.length+label.length+80>limit))reject('表格单行过长，无法完整保留记录；请拆分长文本列后重新上传。');
  const chunks=[];
  let start=0;
  while(start<lines.length||(!lines.length&&!chunks.length)) {
    let end=start,length=header.length+label.length+80;
    while(end<lines.length&&(end===start||length+lines[end].length+1<=limits.chunkChars)){length+=lines[end].length+1;end++;}
    const rowStart=lines.length?start+1:0,rowEnd=end;
    const text=`${label}；数据行 ${rowStart}–${rowEnd} / ${table.totalRows}\n${header}${end>start?'\n'+lines.slice(start,end).join('\n'):''}`;
    const selectedRows=table.rowNumbers.slice(start,end);
    const columnLabel=index=>{let result='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
    const cellRange=table.format==='xlsx'&&selectedRows.length?'A'+selectedRows[0]+':'+columnLabel(table.headers.length-1)+selectedRows.at(-1):undefined;
    chunks.push({text,page,heading:table.name||'数据表',ordinal:startOrdinal+chunks.length,evidenceType:'table',locator:{page,pageKind:table.format==='xlsx'?'worksheet':table.format==='docx'?'logical':table.format==='pptx'?'slide':table.format==='pdf'?'physical':'logical',tableId:table.tableId,rowNumbers:selectedRows,rowNumberKind:table.rowNumberKind,...(table.format==='xlsx'?{sheet:table.name,cellRange}:{}),...(table.locator||{})},table:{...table,rows:table.rows.slice(start,end),rowNumbers:selectedRows,rowStart,rowEnd,cellRange,...(table.cellBounds?{cellBounds:table.cellBounds.filter(c=>selectedRows.includes(c.row)||c.row===table.headerRowNumber)}:{}),complete:rowStart<=1&&rowEnd===table.totalRows},quality:{text:'native',structure:table.reviewRequired?'candidate':'native',method:table.format},reviewState:'unreviewed'});
    if(end>=lines.length)break;
    start=end;
  }
  return chunks;
}

export function tableNotes(table) {
  return [table.headerSource==='first-row'?'表格首个记录作为列名；发布前请核对表头。':'未识别到明确表头，使用列序号并保留首行数据；请对照原件核对字段。',table.rowNumberKind==='worksheet-row'?'来源行号为原工作表行号。':table.rowNumberKind==='table-row'?'来源行号为该表格内的行序号。':'CSV/TSV来源记录号按记录计数，单元格内换行不增加记录号。'];
}

import { canBase, canDocument, isRetrievable, cleanString, requireValue } from './security.mjs';

// Resolve a document selection once, pin its actual version, then recheck it at every boundary.
export function resolveDocumentScope(store,user,{baseId='',documentId='',documentVersion}={}) {
  baseId=cleanString(baseId,200); documentId=cleanString(documentId,200);
  if(baseId)requireValue(canBase(user,store.get('base',baseId)),404,'BASE_NOT_FOUND','知识库不存在或无权访问。');
  if(documentVersion!==undefined&&documentVersion!==null&&documentVersion!=='')requireValue(documentId&&Number.isSafeInteger(Number(documentVersion))&&Number(documentVersion)>0,400,'DOCUMENT_SCOPE_INVALID','指定资料版本时必须同时提供文档编号和有效版本号。');
  if(!documentId)return {baseId,documentId:'',documentVersion:null};
  const doc=store.get('document',documentId);
  requireValue(canDocument(user,doc,store),404,'DOCUMENT_NOT_FOUND','指定资料不存在或无权访问。');
  requireValue(!baseId||doc.baseId===baseId,403,'DOCUMENT_SCOPE_DENIED','指定资料不在当前知识库中。');
  requireValue(isRetrievable(doc),409,'DOCUMENT_SCOPE_UNAVAILABLE','指定资料尚未发布、已失效或已被撤回，请选择当前有效版本。');
  requireValue(documentVersion===undefined||documentVersion===null||documentVersion===''||Number(documentVersion)===doc.version,409,'DOCUMENT_VERSION_CHANGED','指定资料版本不匹配，请重新选择资料。');
  return {baseId:baseId||doc.baseId,documentId:doc.id,documentVersion:doc.version};
}
export function documentWithinScope(document,{baseId='',documentId='',documentVersion}={}) {
  return !!document&&(!baseId||document.baseId===baseId)&&(!documentId||document.id===documentId&&(documentVersion==null||document.version===Number(documentVersion)));
}
export function graphWithinScope(graph,scope={}) {
  if(!scope.documentId)return graph;
  const accepts=ref=>ref.documentId===scope.documentId&&(ref.documentVersion==null&&ref.version==null||Number(ref.documentVersion??ref.version)===scope.documentVersion);
  const paths=(graph.paths||[]).filter(p=>p.edges?.length&&p.edges.every(accepts)).map(p=>({...p,evidenceRefs:(p.evidenceRefs||[]).filter(accepts)}));
  const blocks=new Set(paths.flatMap(p=>p.edges.map(e=>e.blockId)));const pathIds=new Set(paths.map(p=>p.id));
  const nodeIds=new Set(paths.flatMap(p=>p.nodeIds||[]));
  return {...graph,paths,results:(graph.results||[]).filter(r=>accepts(r)&&blocks.has(r.id)).map(r=>({...r,graphPathIds:(r.graphPathIds||[]).filter(id=>pathIds.has(id)),graphPaths:paths.filter(p=>p.edges.some(e=>e.documentId===r.documentId&&e.blockId===r.id))})),entities:(graph.entities||[]).filter(n=>nodeIds.has(n.id)).map(n=>({...n,evidenceRefs:(n.evidenceRefs||[]).filter(accepts)})),stats:{status:graph.stats?.status||'available',returnedPaths:paths.length,scope:'selected_document'},warning:'图谱仅保留指定资料内的关系及证据。'};
}
export function evidenceWithinScope(bundle,scope={}) {
  if(!scope.documentId)return true;
  if(!bundle||typeof bundle!=='object')return true;
  if(Array.isArray(bundle))return bundle.every(value=>evidenceWithinScope(value,scope));
  if(bundle.documentId&&bundle.documentId!==scope.documentId)return false;
  if(bundle.documentId&&(bundle.version!=null||bundle.documentVersion!=null)&&Number(bundle.documentVersion??bundle.version)!==scope.documentVersion)return false;
  return Object.entries(bundle).every(([key,value])=>!['citations','graphPaths','graph','toolResults','contextEvidenceRefs','evidenceRefs','turns','summary','edges','results','paths','result'].includes(key)||evidenceWithinScope(value,scope));
}

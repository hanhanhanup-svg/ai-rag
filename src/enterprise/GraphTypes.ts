import type { SourceKind } from './types';

export interface GraphEvidence {
  documentId: string; blockId?: string; title?: string; documentVersion?: number;
  rowNumber?: number; text?: string; sourceKind?: SourceKind;
  locator?: { page?: number; sheet?: string; cellRange?: string; rowNumbers?: number[] };
}
export interface GraphNode {
  id: string; type: string; name: string; externalId?: string; baseId?: string;
  scopeLabel?: string; evidenceRefs?: GraphEvidence[];
}
export interface GraphEdge {
  id: string; subjectId: string; objectId: string; predicate: string; label?: string;
  documentId: string; blockId?: string; rowNumber?: number; documentVersion?: number;
  sourceTitle?: string; revision: number; status: string; stale?: boolean; canManage?: boolean;
  subjectName?: string; objectName?: string; evidenceRefs?: GraphEvidence[];
}
export interface GraphPath {
  id: string; nodeIds: string[]; nodes: GraphNode[]; edges: GraphEdge[]; evidenceRefs?: GraphEvidence[];
}
export interface GraphData {
  nodes: GraphNode[]; edges: GraphEdge[]; paths: GraphPath[]; canManage?: boolean;
  stats: { nodeCount: number; edgeCount: number; confirmed: number; candidate: number; rejected: number; stale: number; matchedNodes: number };
  construction?: {documentCount:number;parsedDocumentCount:number;sourceDocumentCount:number;pendingDocumentCount:number;types:Array<{type:string;nodeCount:number;documentCount:number;confirmed:number;candidate:number;relationCount:number}>;predicates:Array<{predicate:string;label:string;count:number;documentCount:number}>;documents:Array<{id:string;title:string;version:number;sourceKind:string;status:string;phase:string;parsed:boolean;entityCount:number;relationCount:number;candidate:number;stale:number}>;documentsTruncated:boolean};
  limits: { maxNodes: number; maxEdges: number; maxHops: number; truncated: boolean };
}
export const graphTypeLabels: Record<string,string> = Object.assign(Object.create(null), {
  line: '线路', station: '车站', asset: '设备', work_order: '工单', fault: '故障',
  issue: '问题', procedure: '规程', document: '资料',
});
export const graphRelationLabels: Record<string,string> = Object.assign(Object.create(null), {
  located_at: '位于车站', has_work_order: '关联工单', on_line: '所属线路', belongs_to_line: '所属线路',
  has_fault: '关联故障', has_issue: '关联问题', follows_procedure: '适用规程',
  governed_by: '依据规程', references_document: '关联资料',
});
export function graphEvidenceUrl(ref: GraphEvidence) {
  const query = new URLSearchParams({ tab: 'evidence' });
  if (ref.blockId) query.set('block', ref.blockId);
  if (ref.rowNumber != null) query.set('row', String(ref.rowNumber));
  if (ref.locator?.page) query.set('page', String(ref.locator.page));
  return `/documents/${encodeURIComponent(ref.documentId)}?${query}`;
}
export function edgeEvidence(edge: GraphEdge): GraphEvidence[] {
  return edge.evidenceRefs?.length ? edge.evidenceRefs.map(ref => ({...ref,
    documentVersion: ref.documentVersion ?? edge.documentVersion,
    rowNumber: ref.rowNumber ?? edge.rowNumber,
  })) : [{documentId: edge.documentId, blockId: edge.blockId, rowNumber: edge.rowNumber,
    documentVersion: edge.documentVersion, title: edge.sourceTitle}];
}

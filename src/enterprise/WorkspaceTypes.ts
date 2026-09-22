import type { KnowledgeBase, KnowledgeDocument, SourceKind } from './types';
export type WorkspaceTodoKind = 'review' | 'processing' | 'conflict' | 'review_due' | 'feedback' | 'evidence';
export interface WorkspaceTodo { id:string; kind:WorkspaceTodoKind; title:string; description:string; route:string; documentId?:string; baseId?:string; status:string; severity:'high'|'medium'|'low'; sourceKind?:SourceKind; dueAt?:string|null; createdAt?:string; canManage:boolean }
export type WorkspaceCaseStatus='open'|'in_progress'|'verified'|'dismissed';
export interface WorkspaceCaseVerification { documentId:string; documentVersion:number; note:string; evaluationId?:string; verifiedAt?:string; verifiedBy?:string }
export interface WorkspaceCase { id:string; title:string; description:string; baseId:string; kind:'revision'|'clarification'; sourceKind:SourceKind; status:WorkspaceCaseStatus; revision:number; documentId:string|null; documentVersion:number|null; feedbackId:string|null; runId:string|null; runRoute?:string; assigneeLabel:string; dueAt:string|null; createdBy:string; createdAt:string; updatedAt:string; reason:string; seedKey?:string; verification:WorkspaceCaseVerification|null; verificationCurrent:boolean; canManage:boolean; history:Array<{id:string;at:string;actorId:string;actorName:string;from:string|null;to:WorkspaceCaseStatus;reason:string;assigneeLabel:string;verification?:WorkspaceCaseVerification|null}> }
export interface WorkspaceCaseStats { total:number; open:number; in_progress:number; verified:number; dismissed:number; staleVerification:number }
export interface WorkspaceCases { cases:WorkspaceCase[]; stats:WorkspaceCaseStats }
export interface WorkspaceSummary {
 scope:{baseId:string;label:string;generatedAt:string;usageScope:'own_runs'|'accessible_runs';canManage:boolean};
 bases:KnowledgeBase[];
 documents:{total:number;published:number;review:number;failed:number;byStatus:Record<string,number>;bySourceKind:Record<string,number>};
 todos:WorkspaceTodo[]; todoStats:Record<WorkspaceTodoKind,number>; cases:WorkspaceCaseStats;
 usage:{runs:number;completed:number;failed:number;cancelled:number;waitingInput:number;model:number;extractive:number;insufficient:number;tool:number;calls:number;knownCalls:number;unknownCalls:number;inputTokens:number;outputTokens:number;accountingNote:string};
 recentDocuments:KnowledgeDocument[];
 recentRuns:Array<{id:string;conversationId:string;question:string;status:string;mode?:string;createdAt:string;durationMs?:number;route:string;sourceKind:SourceKind}>;
}

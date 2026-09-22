export interface User { id: string; username: string; name: string; role: 'admin' | 'editor' | 'viewer'; department: string; active: boolean; authMode?: 'password' | 'local' }
export interface KnowledgeBase { systemKind?: string; id: string; name: string; description: string; department: string; visibility: 'company' | 'department' | 'private'; ownerId: string; documentCount: number; createdAt: string; members?: string[] }
export type DocumentStatus = 'queued' | 'processing' | 'review' | 'published' | 'rejected' | 'failed' | 'archived' | 'superseded';
export type SourceKind = 'official_public' | 'internal_controlled' | 'synthetic' | 'reference' | 'unspecified';
export interface KnowledgeDocument {
  learning?: { feedbackId: string };
  id: string; baseId: string; title: string; fileName: string; mimeType: string; size: number; sha256: string;
  version: number; status: DocumentStatus; stage: string; progress: number; error?: string;
  ownerId: string; ownerName: string; department: string; sensitivity: 'internal' | 'confidential';
  createdAt: string; updatedAt: string; effectiveAt?: string | null; expiresAt?: string | null;
  reviewDueAt?: string | null; lastReviewedAt?: string | null; lastReviewedBy?: string | null;
  sourceKind?: SourceKind; sourceCategoryId?: string; sourceCategoryName?: string; applicability?: string; businessOwner?: string;
  chunkCount: number; pageCount: number; tags: string[]; summary: string; previousVersionId?: string; revision: number;
  deletedAt?: string | null; deletedBy?: string | null; deletedByName?: string | null; deletedFromStatus?: DocumentStatus | null; restoredAt?: string; restoredBy?: string; canRestore?: boolean;
  canManage?: boolean; embeddingStatus?: 'pending' | 'queued' | 'processing' | 'ready' | 'failed';
  embeddingError?: string | null; embeddingSignature?: string; modelSignature?: string; embeddingUpdatedAt?: string;
  warnings?: string[]; notes?: string[]; durationMs?:number;
  applications?: {
    groupId: string;
    issueId: string;
    count: number;
    label: string;
    summary: string;
    peers: Array<{ id: string; title: string; version: number; status: DocumentStatus; baseId: string; fileName?: string }>;
  } | null;
}
export interface ChunkTable {
  schemaVersion: 1; tableId: string; format: 'csv' | 'tsv' | 'xlsx' | 'docx' | 'pptx'; name: string;
  headers: string[]; rows: string[][]; rowNumbers: number[]; rowStart: number; rowEnd: number;
  totalRows: number; cellBounds?:Array<{row:number;column:number;bbox:number[]}>; rowNumberKind?: string; headerRowNumber: number | null; headerSource: 'first-row' | 'generated'; complete: boolean;
}
export interface Chunk { id: string; documentId: string; text: string; page: number; heading?: string; ordinal: number; table?: ChunkTable }
export interface Coverage { complete: boolean; totalRows: number; returnedRows: number; reason: string; sourceComplete?:boolean; matchedRows?:number }
export interface SearchResult {
  graphPaths?: import('./GraphTypes').GraphPath[];
  id: string; documentId: string; title: string; fileName: string; baseId: string; version: number; text: string;
  page: number; heading?: string; score: number; matchReason?: string; updatedAt: string;
  citation?: number; used?: boolean; locator?: {startMs?:number;endMs?:number;sampleMs?:number;precision?:string;page?:number;cellRange?:string}; sourceKind?:SourceKind; applicability?:string; sourceCoverage?:unknown; table?: ChunkTable; coverage?: Coverage;
}
export interface ChatMessage {
  graphPaths?: import('./GraphTypes').GraphPath[];
  toolResults?: import('./UpgradeTypes').ToolResult[]; traceId?:string; context?:unknown;
  id: string; conversationId?: string; role?: 'user' | 'assistant'; content?: string; question?: string; answer?: string;
  mode?: 'extractive' | 'model' | 'insufficient' | 'tool'; citations?: SearchResult[]; coverage?: Coverage; warning?: string; createdAt?: string;
}
export interface Conversation { id: string; title: string; createdAt: string; updatedAt: string }
export interface AuditEvent { id: string; action: string; actorName?: string; userName?: string; createdAt: string; detail?: string; message?: string }
export interface GovernanceIssue {
  id: string; documentId: string; title: string; type: string; severity: string; ownerName?: string;
  message: string; status: DocumentStatus; revision: number; reviewDueAt?: string | null; expiresAt?: string | null;
  acknowledgement?: { status: 'acknowledged'; reason: string; actorId: string; actorName: string; at: string; fingerprint: string; version: number } | null;
  issueStatus: 'open' | 'acknowledged'; canManage: boolean; actions: string[]; reason?: string; acknowledgedReason?: string;
}
export interface GovernanceNote { documentId: string; title: string; notes: string[] }
export interface GovernanceData { issues: GovernanceIssue[]; notes?: GovernanceNote[]; stats: { total: number; high: number; reviewDue?: number; acknowledged?: number; pendingReview?: number } }

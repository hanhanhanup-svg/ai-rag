import type { AuditEvent } from './types';

const documentAuditNames: Record<string, string> = {
  'document.upload': '资料已上传',
  'document.parse': '资料解析已开始',
  'document.parsed': '资料解析完成',
  'document.parse_failed': '资料解析未完成',
  'document.parse_obsolete': '解析结果已因资料更新而失效',
  'document.publish': '资料已审核发布',
  'document.published': '资料已审核发布',
  'document.reject': '资料已退回修订',
  'document.archive': '资料已下架',
  'document.archived': '资料已下架',
  'document.restore': '资料已恢复待审核',
  'document.deleted': '资料已移入回收站',
  'document.restored_from_trash': '资料已从回收站恢复',
  'document.retry': '资料处理已重新开始',
  'document.edited': '资料校对结果已保存',
  'document.version_created': '待审核新版本已创建',
  'document.download': '原始文件已下载',
  'document.preview': '原始文件已预览',
  'document.indexed': '资料检索内容已更新',
  'document.index_failed': '资料检索准备未完成',
  'document.reindex_requested': '资料检索更新已安排',
  'document.reparse_requested': '重新解析任务已创建',
  'document.draft_superseded': '待审核草稿已由新版本接替',
  'document.scheduled_superseded': '资料已切换至新的有效版本',
  'evidence.reviewed': '原文证据已复核',
  'evidence.ready': '原文证据已准备完成',
  'evidence.withdrawn': '原文证据已撤回',
  'knowledge.relations.extracted': '资料中的知识关系已提取',
  'knowledge.relation.confirm': '知识关系已确认',
  'knowledge.relation.reject': '候选知识关系已排除',
  'knowledge.checked': '知识质量检查已完成',
  'knowledge.issue.start': '知识问题已开始核验',
  'knowledge.issue.resolve': '知识问题已处理完成',
  'knowledge.issue.dismiss': '知识问题已核验排除',
  'knowledge.issue.reopen': '知识问题已重新打开',
  'governance.review': '资料复审已完成',
  'governance.acknowledge': '资料质量提示已复核确认',
  'governance.reopen': '资料质量问题已重新打开',
  'connector.source_deleted': '来源资料已移除并下架',
  'source.withdrawn': '资料来源已撤回',
  'feedback.learned': '反馈已加入机器学习',
  'feedback.created': '资料反馈已提交',
  'feedback.updated': '资料反馈已处理',
};

export function documentAuditName(action: string): string {
  return Object.prototype.hasOwnProperty.call(documentAuditNames, action) ? documentAuditNames[action] : '资料操作已记录';
}

export function documentAuditDetail(event: Pick<AuditEvent, 'detail' | 'message'>): string {
  const detail = typeof event.detail === 'string' ? event.detail.trim() : '';
  // Keep the saved business explanation; machine codes and fingerprints remain
  // available in the original audit record rather than the document reading UI.
  if (!detail || /^[A-Z][A-Z0-9_]+$/.test(detail) || /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(detail) || /^[a-f0-9]{32,}$/i.test(detail)) return '';
  return detail;
}



import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Sparkles } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { SelectControl } from './SelectControl';
import type { KnowledgeDocument, User } from './types';
import './knowledge-extensions.css';

type Card = {
  id: string; title: string; template: string; status: string; revision: number; version: number;
  fields: { questions: string[]; conditions: string; conclusion: string; steps: string[]; materials: string[]; exceptions: string; ownerDept: string };
  evidenceRefs: Array<{ documentId: string; blockId?: string; title?: string; page?: number; text?: string }>;
  sourceDocumentIds: string[]; conflicts?: string[]; sources?: Array<{ id: string; title: string; version: number }>;
  canManage?: boolean; updatedAt?: string;
};

const statusNames: Record<string, string> = {
  draft: '草稿', review: '待审核', published: '已发布', recheck: '待复核', disabled: '已停用', returned: '已退回',
};

const emptyFields = { questions: [''], conditions: '', conclusion: '', steps: [''], materials: [''], exceptions: '', ownerDept: '' };

export function KnowledgeCardsPage({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const object = params.get('object') || '';
  const resource = useResource<{ cards: Card[]; templates: Array<{ id: string; name: string }> }>(`/knowledge-cards?${new URLSearchParams({ status, object })}`);
  const docs = useResource<{ documents: KnowledgeDocument[] }>('/documents?limit=80&status=published');
  const [editor, setEditor] = useState<Partial<Card> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  }

  async function createDraftFromDocs() {
    const first = docs.data?.documents?.[0];
    if (!first) { setError('暂无已发布资料可用于生成草稿。'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ card: Card }>('/knowledge-cards/draft-from-documents', {
        method: 'POST',
        body: JSON.stringify({ documentIds: [first.id], title: `${first.title}知识卡片草稿` }),
      });
      setEditor(result.card); setNotice('系统草稿已生成，不能直接作为标准口径。'); resource.reload();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function saveCard(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    setBusy(true); setError('');
    try {
      if (editor.id) {
        const result = await api<{ card: Card }>(`/knowledge-cards/${editor.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            revision: editor.revision,
            title: editor.title,
            template: editor.template,
            fields: editor.fields,
            evidenceRefs: editor.evidenceRefs,
            sourceDocumentIds: editor.sourceDocumentIds,
            conflicts: editor.conflicts,
          }),
        });
        setEditor(result.card); setNotice('卡片已保存。');
      } else {
        const result = await api<{ card: Card }>('/knowledge-cards', {
          method: 'POST',
          body: JSON.stringify({
            title: editor.title,
            template: editor.template || 'card_concept',
            fields: editor.fields || emptyFields,
            sourceDocumentIds: editor.sourceDocumentIds || [],
            evidenceRefs: editor.evidenceRefs || [],
          }),
        });
        setEditor(result.card); setNotice('卡片已创建为草稿。');
      }
      resource.reload();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function runAction(card: Card, action: string) {
    setBusy(true); setError('');
    try {
      const result = await api<{ card: Card }>(`/knowledge-cards/${card.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ revision: card.revision, action, acknowledgeConflicts: true }),
      });
      setEditor(result.card); setNotice(`已执行：${action}`); resource.reload();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <div className="e-page">
      <PageHeader
        title="知识卡片管理"
        description="把业务事项整理为结构清晰、来源可查的知识卡片。系统草稿需审核后才能作为口径。"
        actions={<>
          <button className="e-btn" onClick={resource.reload}><RefreshCw size={15}/>刷新</button>
          {user.role !== 'viewer' && <button className="e-btn" disabled={busy} onClick={createDraftFromDocs}><Sparkles size={15}/>从资料生成草稿</button>}
          {user.role !== 'viewer' && <button className="e-btn primary" onClick={() => setEditor({ title: '', template: 'card_concept', fields: { ...emptyFields }, evidenceRefs: [], sourceDocumentIds: [], status: 'draft' })}><Plus size={15}/>新建卡片</button>}
        </>}
      />
      <Notice>知识卡片不得替代正式文件效力。多来源冲突应保留差异并提交确认，不自动拼接为确定结论。</Notice>
      {(error || resource.error) && <Notice kind="error">{error || resource.error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      <div className="e-toolbar">
        <SelectControl className="e-input" value={status} onChange={e => filter('status', e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectControl>
        <input className="e-input" placeholder="按对象/关键词筛选" value={object} onChange={e => filter('object', e.target.value)} />
      </div>
      {resource.loading && !resource.data ? <Loading /> : resource.data?.cards.length ? (
        <div className="e-table-wrap">
          <table className="e-table">
            <thead><tr><th>标题</th><th>模板</th><th>状态</th><th>关联资料</th><th>更新</th><th>操作</th></tr></thead>
            <tbody>
              {resource.data.cards.map(card => (
                <tr key={card.id}>
                  <td><strong>{card.title}</strong><p className="e-muted">{(card.fields?.questions || [])[0] || '—'}</p></td>
                  <td>{resource.data?.templates.find(t => t.id === card.template)?.name || card.template}</td>
                  <td><span className="e-badge">{statusNames[card.status] || card.status}</span></td>
                  <td>{(card.sources || []).map(s => s.title).join('、') || '—'}</td>
                  <td>{formatDate(card.updatedAt)}</td>
                  <td><button className="e-text-link" onClick={() => setEditor(card)}>打开</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="暂无知识卡片" description="可人工创建，或从已发布资料生成草稿。" />}

      {editor && (
        <Modal title={editor.id ? `编辑卡片 · ${editor.title}` : '新建知识卡片'} onClose={() => setEditor(null)} busy={busy} wide>
          <form className="e-stack" onSubmit={saveCard}>
            {error && <Notice kind="error">{error}</Notice>}
            {!!editor.conflicts?.length && <Notice kind="warning">{editor.conflicts.join('；')}</Notice>}
            <div className="e-grid two">
              <label className="e-field">标题<input className="e-input" required value={editor.title || ''} onChange={e => setEditor({ ...editor, title: e.target.value })} /></label>
              <label className="e-field">模板
                <SelectControl className="e-input" value={editor.template || 'card_concept'} onChange={e => setEditor({ ...editor, template: e.target.value })}>
                  {(resource.data?.templates || [{ id: 'card_concept', name: '概念解释' }]).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </SelectControl>
              </label>
            </div>
            <label className="e-field">常见问法<textarea className="e-input" rows={2} value={(editor.fields?.questions || []).join('\n')} onChange={e => setEditor({ ...editor, fields: { ...(editor.fields || emptyFields), questions: e.target.value.split('\n') } })} /></label>
            <label className="e-field">适用条件<textarea className="e-input" rows={2} value={editor.fields?.conditions || ''} onChange={e => setEditor({ ...editor, fields: { ...(editor.fields || emptyFields), conditions: e.target.value } })} /></label>
            <label className="e-field">核心结论<textarea className="e-input" rows={4} required value={editor.fields?.conclusion || ''} onChange={e => setEditor({ ...editor, fields: { ...(editor.fields || emptyFields), conclusion: e.target.value } })} /></label>
            <label className="e-field">操作步骤<textarea className="e-input" rows={3} value={(editor.fields?.steps || []).join('\n')} onChange={e => setEditor({ ...editor, fields: { ...(editor.fields || emptyFields), steps: e.target.value.split('\n') } })} /></label>
            <label className="e-field">例外情况<textarea className="e-input" rows={2} value={editor.fields?.exceptions || ''} onChange={e => setEditor({ ...editor, fields: { ...(editor.fields || emptyFields), exceptions: e.target.value } })} /></label>
            <label className="e-field">关联资料
              <SelectControl className="e-input" value={(editor.sourceDocumentIds || [])[0] || ''} onChange={e => {
                const doc = docs.data?.documents.find(d => d.id === e.target.value);
                setEditor({
                  ...editor,
                  sourceDocumentIds: e.target.value ? [e.target.value] : [],
                  evidenceRefs: doc ? [{ documentId: doc.id, title: doc.title, text: doc.summary || doc.title }] : editor.evidenceRefs,
                });
              }}>
                <option value="">选择依据文档</option>
                {(docs.data?.documents || []).map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
              </SelectControl>
            </label>
            <div className="e-modal-actions">
              <button type="button" className="e-btn" disabled={busy} onClick={() => setEditor(null)}>关闭</button>
              <button className="e-btn primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
              {editor.id && editor.status === 'draft' && <button type="button" className="e-btn" disabled={busy} onClick={() => runAction(editor as Card, 'submit')}>提交审核</button>}
              {editor.id && editor.status === 'review' && <button type="button" className="e-btn primary" disabled={busy} onClick={() => runAction(editor as Card, 'publish')}>发布</button>}
              {editor.id && (editor.sources || [])[0] && <Link className="e-text-link" to={`/documents/${(editor.sources || editor.sourceDocumentIds || [])[0]?.id || editor.sourceDocumentIds?.[0]}`}>查看依据文档</Link>}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw, Sparkles, Tags } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Notice, PageHeader } from './components';
import { SelectControl } from './SelectControl';
import type { KnowledgeBase, KnowledgeDocument, User } from './types';
import './knowledge-extensions.css';

type AttrValue = { key: string; label?: string; value: string; source: string; status: string; note?: string };
type Annotation = {
  id: string; documentId: string; documentTitle?: string; templateId: string; status: string; revision: number;
  values: AttrValue[]; updatedAt?: string; canManage?: boolean;
};
type Template = { id: string; name: string; knowledgeType: string; fields: Array<{ key: string; label: string; required?: boolean; valueType?: string; enum?: string[] }> };

const sourceLabel: Record<string, string> = { explicit: '原文依据', inferred: '待确认推断', manual: '人工维护' };
const statusLabel: Record<string, string> = { draft: '草稿', pending_review: '待审核', confirmed: '已确认' };

export function AttributeAnnotationPanel({ user, embedded = false }: { user: User; embedded?: boolean }) {
  const [params, setParams] = useSearchParams();
  const documentId = params.get('documentId') || '';
  const docs = useResource<{ documents: KnowledgeDocument[] }>('/documents?limit=100&status=published');
  const data = useResource<{ annotations: Annotation[]; templates: Template[] }>(`/attribute-annotations?${new URLSearchParams({ documentId })}`);
  const [templateId, setTemplateId] = useState('tmpl_policy');
  const [selected, setSelected] = useState<Annotation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const templates = data.data?.templates || [];
  const annotations = data.data?.annotations || [];
  const current = selected || annotations[0] || null;

  function setDoc(id: string) {
    const next = new URLSearchParams(params);
    id ? next.set('documentId', id) : next.delete('documentId');
    if (embedded) next.set('tab', 'attributes');
    setParams(next);
    setSelected(null);
  }

  async function suggest() {
    if (!documentId) { setError('请先选择文档。'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ annotation: Annotation }>('/attribute-annotations/suggest', { method: 'POST', body: JSON.stringify({ documentId, templateId }) });
      setSelected(result.annotation); setNotice('已生成待确认标注草稿，推断字段不会自动生效。'); data.reload();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!current) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ annotation: Annotation }>('/attribute-annotations', {
        method: 'POST',
        body: JSON.stringify({ id: current.id, revision: current.revision, documentId: current.documentId, templateId: current.templateId, values: current.values, status: current.status }),
      });
      setSelected(result.annotation); setNotice('标注已保存。'); data.reload();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function action(kind: string) {
    if (!current) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ annotation: Annotation }>(`/attribute-annotations/${current.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ revision: current.revision, action: kind, allowInferred: true }),
      });
      setSelected(result.annotation); setNotice(kind === 'confirm' ? '属性已确认生效（不替代文档权限控制）。' : '状态已更新。'); data.reload();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  const body = (
    <>
      {(error || data.error) && <Notice kind="error">{error || data.error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      <Notice>原文明确记载的属性应关联依据；推断结果标记为待确认。无法识别的关键属性不得填造。属性标签不能替代权限控制。</Notice>
      <div className="e-toolbar kx-toolbar">
        <SelectControl className="e-input" aria-label="标注文档" value={documentId} onChange={e => setDoc(e.target.value)}>
          <option value="">选择文档</option>
          {(docs.data?.documents || []).map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
        </SelectControl>
        <SelectControl className="e-input" aria-label="属性模板" value={templateId} onChange={e => setTemplateId(e.target.value)}>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectControl>
        {user.role !== 'viewer' && <button className="e-btn primary" disabled={busy || !documentId} onClick={suggest}><Sparkles size={15}/>智能识别</button>}
        <button className="e-btn" onClick={data.reload}><RefreshCw size={15}/>刷新</button>
      </div>
      {data.loading && !data.data ? <Loading /> : (
        <div className="kx-split">
          <aside className="e-card kx-list">
            <h3>标注记录</h3>
            {annotations.length ? annotations.map(row => (
              <button key={row.id} className={current?.id === row.id ? 'active' : ''} onClick={() => setSelected(row)}>
                <strong>{row.documentTitle || row.documentId}</strong>
                <span>{statusLabel[row.status] || row.status} · {formatDate(row.updatedAt)}</span>
              </button>
            )) : <EmptyState title="暂无标注" description="选择文档后执行智能识别或人工维护。" />}
          </aside>
          <section className="e-card">
            {!current ? <EmptyState title="选择一条标注" description="查看属性字段、来源与确认状态。" /> : (
              <form className="e-stack" onSubmit={save}>
                <div className="e-section-heading">
                  <h2>{current.documentTitle || '属性标注'}</h2>
                  <span className="e-badge">{statusLabel[current.status] || current.status}</span>
                </div>
                <div className="kx-attr-grid">
                  {current.values.map((value, index) => (
                    <label className="e-field" key={value.key + index}>
                      <span>{value.label || value.key}<em className={`kx-source ${value.source}`}>{sourceLabel[value.source] || value.source}</em></span>
                      <input
                        className="e-input"
                        value={value.value}
                        disabled={busy || user.role === 'viewer'}
                        onChange={e => setSelected({
                          ...current,
                          values: current.values.map((row, i) => i === index ? { ...row, value: e.target.value, source: 'manual', status: 'pending_review' } : row),
                        })}
                      />
                      <small className="e-muted">{statusLabel[value.status] || value.status}{value.note ? ` · ${value.note}` : ''}</small>
                    </label>
                  ))}
                </div>
                {user.role !== 'viewer' && current.canManage !== false && (
                  <div className="e-actions e-wrap">
                    <button className="e-btn primary" disabled={busy}>保存修改</button>
                    <button type="button" className="e-btn" disabled={busy} onClick={() => action('submit_review')}>提交审核</button>
                    <button type="button" className="e-btn" disabled={busy} onClick={() => action('confirm')}>确认生效</button>
                    <Link className="e-text-link" to={`/documents/${current.documentId}`}>查看文档</Link>
                  </div>
                )}
              </form>
            )}
          </section>
        </div>
      )}
    </>
  );

  if (embedded) return <div className="kx-panel">{body}</div>;
  return <div className="e-page"><PageHeader title="知识属性标注" description="对入库文档进行属性识别与分类标注，为检索与问答提供结构化条件。" />{body}</div>;
}

export function TasksWithAttributes({ user, tasksView }: { user: User; tasksView: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'attributes' ? 'attributes' : 'tasks';
  function choose(next: string) {
    const values = new URLSearchParams(params);
    next === 'tasks' ? values.delete('tab') : values.set('tab', next);
    setParams(values);
  }
  return (
    <div className="e-page">
      <PageHeader title="解析、索引与属性标注" description="跟踪解析索引任务，并对入库资料进行属性识别与人工确认。" />
      <div className="e-filter-tabs" aria-label="任务与属性">
        <button type="button" className={tab === 'tasks' ? 'active' : ''} onClick={() => choose('tasks')}>任务队列</button>
        <button type="button" className={tab === 'attributes' ? 'active' : ''} onClick={() => choose('attributes')}><Tags size={14}/>属性标注</button>
      </div>
      {tab === 'tasks' ? tasksView : <AttributeAnnotationPanel user={user} embedded />}
    </div>
  );
}

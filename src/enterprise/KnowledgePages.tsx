import { learningBaseDescription } from './LearningBaseOverview';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, Database, Globe2, LockKeyhole, Plus, RefreshCw, Search, Settings2, ShieldCheck, Users, X } from 'lucide-react';
import { api, errorMessage, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import type { KnowledgeBase, User } from './types';
import { SelectControl } from './SelectControl';
import './base-members.css';

export function BasesPage({ user }: { user: User }) {
  const resource = useResource<{ bases: KnowledgeBase[] }>('/bases'); const [editing, setEditing] = useState<KnowledgeBase | 'new' | null>(null); const [search, setSearch] = useState('');
  const bases = (resource.data?.bases || []).filter(base => `${base.name} ${base.description}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="e-page"><PageHeader title="知识库" description="按业务归集知识，明确责任人与适用范围。" actions={user.role !== 'viewer' && <button className="e-btn primary" onClick={() => setEditing('new')}><Plus size={17}/>新建知识库</button>}/><div className="e-toolbar"><input className="e-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索知识库名称或说明" aria-label="搜索知识库"/><span className="e-muted">{bases.length} 个可访问知识库</span></div>{resource.error && <Notice kind="error">{resource.error}</Notice>}{resource.loading ? <Loading/> : bases.length ? <div className="e-base-grid">{bases.map(base => <article className="e-card e-base-card" key={base.id}><div className="e-base-card-top"><span className="e-base-icon"><Database size={24}/></span>{(user.role === 'admin' || base.ownerId === user.id) && <button aria-label={`管理${base.name}`} title="管理知识库" className="e-icon-btn" onClick={() => setEditing(base)}><Settings2 size={18}/></button>}</div><h2>{base.name}</h2><p>{base.systemKind==='feedback_learning'?learningBaseDescription:base.description || '尚未添加说明'}</p><div className="e-base-meta"><span>{base.visibility === 'company' ? <Globe2 size={14}/> : base.visibility === 'department' ? <Building2 size={14}/> : <LockKeyhole size={14}/>}{base.systemKind==='feedback_learning'?'系统自学习 · 后台自用':base.visibility === 'company' ? '企业共享' : base.visibility === 'department' ? `${base.department || '部门'}内共享` : '指定成员'}</span><span>{base.documentCount ?? 0} 份文档</span></div><Link className="e-base-link" to={`/assets/knowledge-bases/${encodeURIComponent(base.id)}`}>进入知识库<ArrowRight size={16}/></Link></article>)}</div> : <div className="e-card"><EmptyState title={search ? '没有找到匹配的知识库' : '创建第一份企业知识空间'} description={search ? '试试其他关键词。' : '建议从企业制度、岗位操作指引或项目经验开始。'} action={!search && user.role !== 'viewer' && <button className="e-btn primary" onClick={() => setEditing('new')}>新建知识库</button>}/></div>}{editing && <BaseEditor user={user} base={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); resource.reload(); }}/>}</div>;
}
export function BaseEditor({ base, user, onClose, onSaved }: { base?: KnowledgeBase; user: User; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(base?.name || '');
  const [description, setDescription] = useState(base?.description || '');
  const [department, setDepartment] = useState(base?.department || user.department || '');
  const [visibility, setVisibility] = useState(base?.visibility || 'company');
  const [members, setMembers] = useState<string[]>(base?.members || []);
  const [membersChanged, setMembersChanged] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const memberHeadingId = useId();
  const memberHelpId = useId();
  const canChooseMembers = user.role === 'admin';
  const people = useResource<{ users: User[] }>(canChooseMembers ? '/users' : null);
  const selectablePeople = (people.data?.users || []).filter(person => person.active && person.id !== user.id && person.id !== base?.ownerId);
  const query = memberSearch.trim().toLocaleLowerCase();
  const matchingPeople = selectablePeople.filter(person => [person.name, person.department, person.username].join(' ').toLocaleLowerCase().includes(query));
  const retainedMembers = members.filter(id => !selectablePeople.some(person => person.id === id));
  const peopleReady = canChooseMembers && !people.loading && !people.error && !!people.data;

  function changeMember(id: string, checked: boolean) {
    setMembersChanged(true);
    setMembers(list => checked ? [...new Set([...list, id])] : list.filter(memberId => memberId !== id));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Omit unchanged membership data so metadata edits never clear existing grants.
      const memberPatch = canChooseMembers && membersChanged ? { members } : {};
      await api(base ? '/bases/' + base.id : '/bases', { method: base ? 'PATCH' : 'POST', body: JSON.stringify({ name, description, department, visibility, ...memberPatch }) });
      onSaved();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <Modal title={base ? '管理知识库' : '新建知识库'} onClose={onClose} busy={busy}>
    <form className="e-stack e-base-editor" onSubmit={submit}>
      {error && <Notice kind="error">{error}</Notice>}
      <label className="e-field">知识库名称<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="例如：企业制度知识库"/></label>
      <label className="e-field">说明<textarea rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} placeholder="说明包含哪些资料、适用哪些业务"/></label>
      <label className="e-field">共享范围<SelectControl value={visibility} onChange={e => setVisibility(e.target.value as KnowledgeBase['visibility'])}>
        <option value="company">企业共享：企业成员可使用已发布知识</option>
        <option value="department">部门共享：所属部门成员可使用</option>
        <option value="private">指定成员：仅负责人、管理员与指定成员</option>
      </SelectControl></label>
      <label className="e-field">所属部门<input required={visibility === 'department'} value={department} onChange={e => setDepartment(e.target.value)} placeholder="例如：综合管理部"/></label>
      <section className="e-base-members" aria-labelledby={memberHeadingId} aria-describedby={memberHelpId}>
        <div className="e-base-members-heading">
          <h3 id={memberHeadingId}>指定成员</h3>
          {canChooseMembers && <span className="e-base-member-count" aria-live="polite">已选 {members.length} 人</span>}
          {canChooseMembers && <button type="button" className="e-icon-btn" title="刷新成员列表" aria-label="刷新成员列表" disabled={busy || people.loading} onClick={people.reload}><RefreshCw size={15}/></button>}
        </div>
        <p className="e-base-members-help" id={memberHelpId}>{visibility === 'private' ? '这些成员可访问本知识库及其中的受限资料。' : '按共享范围开放知识，受限资料另向所选成员授权。'}</p>
        <div className="e-base-members-default"><ShieldCheck size={16}/><span>负责人和管理员默认可访问，无需重复选择</span></div>
        {!canChooseMembers ? <div className="e-base-members-empty">
          <Users size={21}/><div><strong>成员授权由管理员配置</strong><p>{base ? '保存修改会保留现有成员授权。如需调整，请联系管理员。' : '可先保存知识库，再由管理员添加指定成员。'}</p></div>
        </div> : people.loading ? <Loading text="正在加载成员…"/> : people.error ? <div className="e-base-members-error" role="alert">
          <div><strong>成员暂时未加载</strong><p>{people.error}</p><small>已有选择会保留，你可以先保存其他修改。</small></div>
          <button type="button" className="e-btn" disabled={busy} onClick={people.reload}>重试</button>
        </div> : peopleReady && <>
          {selectablePeople.length > 0 ? <>
            <label className="e-base-member-search"><Search size={16}/><input aria-label="搜索成员" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="搜索姓名、部门或账号"/>{memberSearch && <button type="button" className="e-icon-btn" aria-label="清空成员搜索" onClick={() => setMemberSearch('')}><X size={15}/></button>}</label>
            <div className="e-base-member-options" role="group" aria-label="可选成员">
              {matchingPeople.length ? matchingPeople.map(person => <label key={person.id} className={'e-base-member-option' + (members.includes(person.id) ? ' is-selected' : '')}>
                <input type="checkbox" checked={members.includes(person.id)} disabled={busy} onChange={e => changeMember(person.id, e.target.checked)}/>
                <span className="e-base-member-avatar" aria-hidden="true">{(person.name || person.username).slice(0, 1)}</span>
                <span className="e-base-member-person"><strong>{person.name || person.username}</strong><small>{[person.department, person.username].filter(Boolean).join(' · ')}</small></span>
              </label>) : <div className="e-base-members-no-results" role="status"><span>没有找到匹配成员</span><button type="button" className="e-text-link" onClick={() => setMemberSearch('')}>清空搜索</button></div>}
            </div>
          </> : <div className="e-base-members-empty">
            <Users size={21}/><div><strong>{user.authMode === 'local' ? '当前为本机使用，无需选择成员' : '暂无可指定的其他成员'}</strong><p>{user.authMode === 'local' ? '尚未配置其他成员账号，可直接保存知识库。多人协作需先启用账号登录并配置成员。' : '请在「组织与人员」中添加或启用成员，再刷新列表。'}</p>{user.authMode !== 'local' && <Link className="e-text-link" to="/security/users" target="_blank" rel="noreferrer">打开组织与人员<ArrowRight size={13}/></Link>}</div>
          </div>}
          {retainedMembers.length > 0 && <details className="e-base-members-retained">
            <summary>已保留 {retainedMembers.length} 项现有授权</summary>
            <p>部分成员已停用、无需重复指定，或暂时无法显示。未主动移除的授权会继续保留。</p>
            {retainedMembers.map(id => {
              const person = people.data?.users.find(item => item.id === id) || (id === user.id ? user : undefined);
              return <div key={id}><span>{person ? (person.name || person.username) + (!person.active ? '（已停用）' : '') : '成员信息暂不可用'}</span><button type="button" className="e-text-link" disabled={busy} aria-label={'移除' + (person?.name || person?.username || '现有成员') + '的指定授权'} onClick={() => changeMember(id, false)}>移除</button></div>;
            })}
          </details>}
        </>}
      </section>
      <p className="e-base-access-note">共享范围与成员授权统一用于文档、搜索、问答和原件访问。</p>
      <div className="e-modal-actions"><button type="button" className="e-btn" disabled={busy} onClick={onClose}>取消</button><button className="e-btn primary" disabled={busy}>{busy ? '正在保存…' : '保存知识库'}</button></div>
    </form>
  </Modal>;
}

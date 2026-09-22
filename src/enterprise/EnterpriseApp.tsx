import { RetiredGovernanceRoute } from './RetiredGovernanceRoutes';
import { BreadcrumbProvider, FunctionalBreadcrumbs } from './Breadcrumbs';
import { GraphPage } from './GraphPage';

import { KnowledgeIssuesPage } from './KnowledgeIssuesPage';
import { BusinessScenariosPage, RunObservabilityPage } from './IntelligencePages';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, ArrowRight, BookOpen, Building2, ChevronRight, Database, FileText, FolderSync, Gauge, History, LayoutDashboard, ListChecks, LogOut, Menu, MessageSquare, Network, Search, Settings, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Notice, PageHeader, StatusBadge } from './components';
import type { KnowledgeDocument, User } from './types';
import { BasesPage } from './KnowledgePages';
import { DocumentsPage, DocumentDetailPage } from './DocumentPages';
import { ChatPage, SearchPage } from './SearchPages';
import AdminPages from './AdminPages';
import { ServicesPage } from './AdvancedPages';
import { FavoritesPage } from './FavoritesPage';
import { ChevronDown } from 'lucide-react';
import { navigationFor, currentCenter, currentPageTitle } from './navigation';
import { WorkspaceHome } from './WorkspaceHome';
import { ProductionCenter, GovernanceCenter, OperationsCenter, PlatformCenter } from './CenterPages';
import { BaseWorkspace } from './BaseWorkspace';
import { ObjectDirectory } from './ObjectDirectory';
import { BusinessHub } from './BusinessHub';
import { UnifiedSearchPage } from './UnifiedSearchPage';
import { KnowledgeInterfacesPage } from './KnowledgeInterfaces';
import { KnowledgeCardsPage } from './KnowledgeCardsPage';
import { KnowledgeDemandPoolPage } from './KnowledgeDemandPoolPage';
import './enterprise.css';
import './workspace.css';
import './controls.css';
import './chat-workspace.css';

const roleName = { admin: '系统管理员', editor: '知识管理员', viewer: '知识使用者' };
export default function EnterpriseApp() {
  const [user, setUser] = useState<User | null>(null); const [required, setRequired] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  useEffect(() => { let cancelled = false; async function load() { setLoading(true); setError(''); try { const setup = await api<{ required: boolean }>('/setup'); if (cancelled) return; setRequired(setup.required); if (!setup.required) { try { const session = await api<{ user: User }>('/auth/me'); if (!cancelled) setUser(session.user); } catch (e) { if ((e as { status?: number }).status !== 401) throw e; } } } catch (e) { if (!cancelled) setError(errorMessage(e)); } finally { if (!cancelled) setLoading(false); } } void load(); return () => { cancelled = true; }; }, [revision]);
  useEffect(() => { const logout = () => setUser(null); window.addEventListener('enterprise:unauthorized', logout); return () => window.removeEventListener('enterprise:unauthorized', logout); }, []);
  if (loading) return <div className="enterprise e-boot"><BookOpen size={34}/><Loading text="正在连接企业知识库…"/></div>;
  if (error) return <div className="enterprise e-boot"><Notice kind="error">{error}</Notice><button className="e-btn primary" onClick={() => setRevision(r => r + 1)}>重新连接</button></div>;
  if (!user) return <Login setup={required} onLogin={u => { setUser(u); setRequired(false); }}/>;
  return <div className="enterprise"><BreadcrumbProvider><Layout user={user} onLogout={() => setUser(null)}/></BreadcrumbProvider></div>;
}
function Login({ setup, onLogin }: { setup: boolean; onLogin: (user: User) => void }) {
  const sso = useResource<{ enabled: boolean; name: string }>('/auth/sso/status');
  const [username, setUsername] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); if (setup && password !== confirm) { setError('两次输入的密码不一致。'); return; } setBusy(true); try { const result = await api<{ user: User }>(setup ? '/setup' : '/auth/login', { method: 'POST', body: JSON.stringify({ username, name, password }) }); setPassword(''); setConfirm(''); onLogin(result.user); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <div className="enterprise e-login"><div className="e-login-story"><div className="e-brand"><span className="e-brand-icon"><BookOpen size={24}/></span><div>X-RAG<span>企业知识库</span></div></div><div className="e-login-message"><span className="e-eyebrow">ENTERPRISE KNOWLEDGE</span><h1>让企业知识<br/>成为工作的可靠依据。</h1><p>连接资料、流程与经验，让每一次搜索和提问<br className="e-desktop-only"/>都能回到有权限、有版本、有出处的原文。</p><div className="e-login-promises"><span><FileText size={19}/>原件留存与版本管理</span><span><ShieldCheck size={19}/>组织权限与操作留痕</span><span><Sparkles size={19}/>依据可核验的智能问答</span></div></div><small>知识接入 · 审核发布 · 搜索问答 · 持续治理</small></div><main className="e-login-form"><div className="e-login-card"><span className="e-eyebrow">{setup ? 'WELCOME TO X-RAG' : 'WORK BETTER WITH KNOWLEDGE'}</span><h2>{setup ? '初始化企业知识库' : '登录工作空间'}</h2><p className="e-muted">{setup ? '创建首位管理员，开始接入企业的真实知识。' : '使用管理员分配的企业账号登录。'}</p>{error && <Notice kind="error">{error}</Notice>}<form onSubmit={submit} className="e-stack"><label className="e-field">账号<input autoComplete="username" required minLength={3} maxLength={80} value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入账号"/></label>{setup && <label className="e-field">管理员姓名<input autoComplete="name" required value={name} onChange={e => setName(e.target.value)} placeholder="请输入真实姓名"/></label>}<label className="e-field">密码<input type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={setup ? '至少 12 位，请使用强密码' : '请输入密码'}/></label>{setup && <label className="e-field">确认密码<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="再次输入密码"/></label>}<button className="e-btn primary large" disabled={busy}>{busy ? '正在验证…' : setup ? '创建管理员并进入' : '登录'}<ArrowRight size={18}/></button></form><>{!setup && sso.data?.enabled && <a className="e-btn e-sso-login" href="/api/auth/sso/start"><ShieldCheck size={17}/>{sso.data.name}</a>}</><p className="e-login-note"><ShieldCheck size={15}/>账号与权限由企业统一管理，登录会话安全保存。</p></div></main></div>;
}
function Layout({user,onLogout}:{user:User;onLogout:()=>void}){
  const localMode=user.authMode==='local';const [open,setOpen]=useState(false),[logoutError,setLogoutError]=useState('');const location=useLocation();const centers=navigationFor(user);const active=currentCenter(centers,location.pathname);const [expanded,setExpanded]=useState(active.id);
  useEffect(()=>{setOpen(false);setExpanded(active.id);},[location.pathname,active.id]);
  async function logout(){if(localMode)return;try{await api('/auth/logout',{method:'POST'});onLogout();}catch(e){setLogoutError(errorMessage(e));}}
  return <div className={`e-shell ws-shell ${location.pathname.replace(/\/$/, '') === '/application/chat' ? 'e-shell-chat' : ''}`}>{open&&<button className="e-sidebar-backdrop" aria-label="关闭导航" onClick={()=>setOpen(false)}/>}<aside className={`e-sidebar ${open?'open':''}`}><Link to="/workspace/overview" className="e-brand"><span className="e-brand-icon"><BookOpen size={22}/></span><div>X-RAG<span>企业知识平台</span></div></Link><button className="e-icon-btn e-close-nav" aria-label="关闭导航" onClick={()=>setOpen(false)}><X size={18}/></button><nav className="ws-navigation" aria-label="主导航">{centers.map(center=><div className={`ws-nav-center ${active.id===center.id?'is-current':''}`} key={center.id}><div className="ws-nav-heading"><Link to={center.to} aria-current={active.id===center.id?'page':undefined} title={center.description}><center.icon size={18}/><span>{center.label}</span></Link>{center.items.length>0&&<button aria-label={`${expanded===center.id?'收起':'展开'}${center.label}菜单`} aria-expanded={expanded===center.id} onClick={()=>setExpanded(v=>v===center.id?'':center.id)}><ChevronDown size={14}/></button>}</div>{center.items.length>0&&expanded===center.id&&<div className="ws-nav-children">{center.items.map(item=><NavLink key={item.to} end to={item.to} className={({isActive})=>`ws-nav-child ${isActive?'active':''}`}><span/>{item.label}</NavLink>)}</div>}</div>)}</nav><div className="ws-nav-guide"><ShieldCheck size={15}/><span>知识有出处 · 操作可追溯</span></div><div className="e-sidebar-bottom"><div className="e-avatar">{localMode?'本':user.name?.slice(0,1)||'用'}</div>{localMode?<div style={{flex:1,minWidth:0}}><strong>本地工作空间</strong><span className="e-muted" style={{display:'block',fontSize:10}}>本机免登录</span></div>:<><Link to="/settings/account"><strong>{user.name}</strong><span>{roleName[user.role]}</span></Link><button title="退出登录" aria-label="退出登录" className="e-icon-btn" onClick={logout}><LogOut size={17}/></button></>}</div></aside><div className="e-main"><header className="e-topbar"><div className="e-breadcrumb"><button className="e-icon-btn e-mobile-menu" aria-label="打开导航" onClick={()=>setOpen(true)}><Menu size={22}/></button><FunctionalBreadcrumbs centers={centers}/></div><div className="e-topbar-right"><span className="e-access-label"><ShieldCheck size={14}/>有权限 · 有版本 · 有依据</span>{localMode?<span className="e-user-mini">本机免登录</span>:<Link to="/settings/account" className="e-user-mini">{user.department||roleName[user.role]}</Link>}</div></header><main className="e-content">{logoutError&&<Notice kind="error">{logoutError}</Notice>}<Routes>
    <Route path="/workspace/overview" element={<WorkspaceHome user={user}/>}/>
    <Route path="/application/hub" element={<BusinessHub user={user}/>}/>
    <Route path="/application/find" element={<UnifiedSearchPage user={user}/>}/>
    <Route path="/production/overview" element={<ProductionCenter user={user}/>}/>
    <Route path="/governance/overview" element={<GovernanceCenter user={user}/>}/>
    <Route path="/governance/cases" element={<RetiredGovernanceRoute kind="cases"/>}/><Route path="/governance/workbench" element={<RetiredGovernanceRoute kind="review"/>}/>
    <Route path="/operations/overview" element={<OperationsCenter user={user}/>}/>
    <Route path="/settings/overview" element={<PlatformCenter user={user}/>}/>
    <Route path="/settings/knowledge-interfaces" element={<KnowledgeInterfacesPage user={user}/>}/>
    <Route path="/assets/knowledge-bases/:id" element={<BaseWorkspace user={user}/>}/>
    <Route path="/assets/objects" element={<ObjectDirectory user={user}/>}/>
    <Route path="/assets/objects/:id" element={<ObjectDirectory user={user}/>}/>
    <Route path="/assets/knowledge-cards" element={<KnowledgeCardsPage user={user}/>}/>
    <Route path="/assets/demand-pool" element={<KnowledgeDemandPoolPage user={user}/>}/>
    <Route path="/assets/documents" element={<DocumentsPage user={user}/>}/>
    <Route path="/assets/graph" element={<GraphPage user={user}/>}/><Route path="/assets/map" element={<Navigate to="/assets/graph" replace/>}/><Route path="/knowledge-map" element={<Navigate to="/assets/graph" replace/>}/>
    <Route path="/application/recommendations" element={<Navigate replace to={`/application/search${location.search}`}/>}/><Route path="/governance/knowledge-issues" element={<KnowledgeIssuesPage user={user}/>}/><Route path="/application/scenarios" element={<BusinessScenariosPage user={user}/>}/><Route path="/settings/traces" element={<RunObservabilityPage user={user}/>}/><Route path="/governance/evaluations" element={<Navigate to="/settings/traces" replace/>}/><Route path="/integration/services" element={<ServicesPage user={user}/>}/>
    <Route path="/production/upload" element={<DocumentsPage user={user}/>}/><Route path="/documents/:id" element={<DocumentDetailPage user={user}/>}/><Route path="/assets/knowledge-bases" element={<BasesPage user={user}/>}/><Route path="/application/search" element={<SearchPage user={user}/>}/><Route path="/application/chat" element={<ChatPage user={user}/>}/>
    {[['/application/feedback','feedback'],['/governance/feedback','feedback'],['/security/users','users'],['/settings/models','settings'],['/settings/operations','operations'],['/production/tasks','tasks'],['/security/audit','audit'],['/integration/apps','connectors'],['/settings/account','account']].map(([path,page])=><Route key={path} path={path} element={<AdminPages page={page} user={user}/>}/>)}
    <Route path="/assets/catalog" element={<Navigate to="/assets/documents" replace/>}/><Route path="/review" element={<RetiredGovernanceRoute kind="review"/>}/><Route path="/application/favorites" element={<FavoritesPage/>}/><Route path="*" element={<Navigate to="/workspace/overview" replace/>}/>
  </Routes></main></div></div>;
}



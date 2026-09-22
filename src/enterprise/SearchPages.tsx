import { RecommendationsPage } from './RecommendationsPage';
import { scopeFromParams, type BusinessScope } from './BusinessContext';
import { GraphPaths } from './GraphPaths';
import type { GraphPath } from './GraphTypes';
import { RunProgress, ToolResults, useChatRuns } from './ChatRuns';
import { isActiveRun, type BusinessScenario, type ChatRun } from './UpgradeTypes';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, History, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Send, ShieldCheck, Sparkles, ThumbsDown, Trash2 } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { AnswerText, AnswerCitations, CoverageNotice } from './KnowledgeContent';
import type { ChatMessage, Conversation, KnowledgeBase, SearchResult, User, Coverage } from './types';
import { SelectControl } from './SelectControl';

export function SearchPage({user}:{user:User}) { return <RecommendationsPage user={user}/>; }
type DisplayMessage = ChatMessage & {role:'user'|'assistant';content:string};
function normalizeMessages(rows:ChatMessage[]):DisplayMessage[]{const output:DisplayMessage[]=[];for(const row of rows){if(row.role){output.push({...row,role:row.role,content:row.content||row.answer||row.question||''});}else{if(row.question)output.push({id:`${row.id}-question`,role:'user',content:row.question});if(row.answer)output.push({...row,role:'assistant',content:row.answer});}}return output;}

const DEFAULT_CHAT_EXAMPLES = ['请查找有关费用报销的制度依据', '这个业务需要履行哪些审批步骤？', '请列出相关操作指引和注意事项'];
const BASE_CHAT_EXAMPLES: Array<{ match: RegExp; examples: string[] }> = [
  { match: /王阳明|传习录|心学/, examples: ['王阳明龙场悟道是怎么回事？', '王阳明少年时期有哪些特点？', '王阳明的家世渊源有哪些要点？'] },
  { match: /客运|乘客|失物/, examples: ['乘客遗失物品登记需要记录哪些信息？', '乘客投诉材料一般应核对哪些内容？', '无障碍服务相关资料主要查什么？'] },
  { match: /设施设备|维修|工单|台账/, examples: ['维修工单关闭前需要核对哪些资料？', '设备台账唯一标识应怎样管理？', '巡检或检修记录通常要保留哪些依据？'] },
  { match: /培训|岗位|学习|案例/, examples: ['岗位培训计划如何记录学习与考核结果？', '完成培训任务通常需要哪些证据？', '岗位知识整理可以从哪些资料入手？'] },
  { match: /安全|应急/, examples: ['应急处置资料应核对哪些关键信息？', '安全检查记录通常包含哪些内容？', '事故或异常报告需要保留哪些依据？'] },
  { match: /运营|交接|客流/, examples: ['交接班记录一般应整理哪些资料？', '运营资料核对通常关注什么？', '客流相关材料可以从哪里查阅？'] },
  { match: /法规|标准|地铁/, examples: ['相关制度中关于适用范围是怎么规定的？', '请查找与当前业务相关的标准条款', '制度中对审批或留痕有哪些要求？'] },
  { match: /机器|学习|模型/, examples: ['这份资料主要讲了哪些方法或概念？', '请概括当前知识库中的关键要点', '相关实验或流程需要注意什么？'] },
];

function fillExamples(preferred: string[], fallback: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of [...preferred, ...fallback, ...DEFAULT_CHAT_EXAMPLES]) {
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= 3) break;
  }
  return output;
}

function chatExampleQuestions(input: {
  baseName?: string;
  scenarioName?: string;
  scenarioGoal?: string;
  scenarioKey?: string;
  exampleQuestions?: string[];
  evaluationCases?: Array<{ question: string; mustRefuse?: boolean }>;
}) {
  const fromScenario = [
    ...(input.exampleQuestions || []),
    ...((input.evaluationCases || []).filter(item => !item.mustRefuse).map(item => item.question)),
  ].map(item => item.trim()).filter(Boolean);
  if (fromScenario.length) return fillExamples(fromScenario, DEFAULT_CHAT_EXAMPLES);

  const haystack = [input.scenarioName, input.scenarioGoal, input.scenarioKey, input.baseName].filter(Boolean).join(' ');
  const matched = BASE_CHAT_EXAMPLES.find(row => row.match.test(haystack));
  if (matched) return fillExamples(matched.examples, DEFAULT_CHAT_EXAMPLES);

  if (input.baseName) {
    return fillExamples([
      `请依据《${input.baseName}》说明主要适用内容`,
      `《${input.baseName}》中有哪些需要核对的关键要点？`,
      `围绕${input.baseName}，资料不足时应如何说明？`,
    ], DEFAULT_CHAT_EXAMPLES);
  }
  return DEFAULT_CHAT_EXAMPLES;
}

export function ChatPage({ user }: { user: User }) {
  const [params,setParams] = useSearchParams();
  const [scope,setScope]=useState<BusinessScope>(()=>scopeFromParams(params));
  const urlSignature=useRef(params.get('conversationId')||params.get('conversation')?'':params.toString());
  const bases = useResource<{ bases: KnowledgeBase[] }>('/bases');
  const history = useResource<{ conversations: Conversation[] }>('/conversations');
  const [conversationId, setConversationId] = useState('');
  const [conversationRevision,setConversationRevision]=useState<number|undefined>();
  const [runId,setRunId]=useState('');
  const [scenarioVersionId,setScenarioVersionId]=useState(params.get('scenarioVersionId')||'');
  const [scenarioInputs,setScenarioInputs]=useState<Record<string,string|number|boolean>>({});
  const [pendingRequest,setPendingRequest]=useState<{body:Record<string,unknown>;content:string;before:DisplayMessage[]}|null>(null);
  const [baseId, setBaseId] = useState(params.get('baseId') || '');
  const [chatModel, setChatModel] = useState('');
  const capabilities = useResource<{ model?: { defaultModel?: string; profiles?: Array<{ id: string; label: string }> } }>('/intelligence/capabilities');
  useEffect(() => {
    const catalog = capabilities.data?.model;
    if (!catalog) return;
    setChatModel(old => old || catalog.defaultModel || catalog.profiles?.[0]?.id || '');
  }, [capabilities.data]);
  const [question, setQuestion] = useState(params.get('q') || '');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ message: DisplayMessage; question: string } | null>(null);
  const [showHistory, setShowHistory] = useState(() => window.matchMedia('(min-width: 960px)').matches);
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const scenarios = useResource<{ scenarios: BusinessScenario[] }>('/scenarios');
  const publishedScenarios = useMemo(
    () => (scenarios.data?.scenarios || []).flatMap(row => row.versions.filter(version => version.status === 'published').map(version => ({ row, version }))),
    [scenarios.data],
  );
  const selectedScenario = publishedScenarios.find(item => item.version.id === scenarioVersionId)?.version;
  const selectedScenarioRow = publishedScenarios.find(item => item.version.id === scenarioVersionId)?.row;
  const selectedBase = bases.data?.bases.find(base => base.id === baseId);
  const exampleQuestions = useMemo(
    () => chatExampleQuestions({
      baseName: selectedBase?.name,
      scenarioName: selectedScenario?.name || selectedScenarioRow?.name,
      scenarioGoal: selectedScenario?.goal,
      scenarioKey: selectedScenario?.scenario || selectedScenarioRow?.scenario,
      exampleQuestions: selectedScenario?.exampleQuestions,
      evaluationCases: selectedScenario?.evaluationCases,
    }),
    [selectedBase?.name, selectedScenario, selectedScenarioRow],
  );
  const messagesContainer = useRef<HTMLDivElement>(null);
  const currentRequest = useRef(0);
  const scrollIntent = useRef<'answer' | 'end' | null>(null);

  useEffect(() => {
    if (loadingHistory || !scrollIntent.current) return;
    const frame = requestAnimationFrame(() => {
      const container = messagesContainer.current;
      if (!container) return;
      if (scrollIntent.current === 'answer') {
        const answers = container.querySelectorAll<HTMLElement>('.e-message.assistant');
        const answer = answers[answers.length - 1];
        if (answer) container.scrollTop += answer.getBoundingClientRect().top - container.getBoundingClientRect().top - 18;
        else container.scrollTop = 0;
      } else container.scrollTop = container.scrollHeight;
      scrollIntent.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, busy, loadingHistory]);

  const observer=useChatRuns(runId,detail=>{
    const request=currentRequest.current;setBusy(false);setLoadingHistory(true);scrollIntent.current='answer';
    void api<{conversation:Conversation & {revision?:number};messages:ChatMessage[]}>('/conversations/'+detail.run.conversationId).then(result=>{
      if(request!==currentRequest.current)return;setMessages(normalizeMessages(result.messages));setConversationRevision(result.conversation.revision);history.reload();
    }).catch(e=>{if(request===currentRequest.current)setError(errorMessage(e));}).finally(()=>{if(request===currentRequest.current)setLoadingHistory(false);});
  });
  useEffect(()=>{if(observer.detail?.run.id===runId)setBusy(isActiveRun(observer.detail.run.status));},[observer.detail?.run.status,observer.detail?.run.id,runId]);
  async function openConversation(id: string) {
    if (busy) return;
    const request = ++currentRequest.current;
    setLoadingHistory(true);setError('');setMessages([]);setConversationId('');setConversationRevision(undefined);setScope({});setBaseId('');setScenarioVersionId('');setScenarioInputs({});setRunId('');setPendingRequest(null);setQuestion('');
    try {
      const result = await api<{ conversation: Conversation & BusinessScope & { revision?:number; activeRunId?:string }; messages: ChatMessage[] }>(`/conversations/${id}`);
      if (request !== currentRequest.current) return;
      scrollIntent.current = 'answer';
      setConversationId(id); setMessages(normalizeMessages(result.messages));setConversationRevision(result.conversation.revision);setRunId(result.conversation.activeRunId||'');setBusy(Boolean(result.conversation.activeRunId));setPendingRequest(null);setScenarioVersionId('');setScenarioInputs({});
      setBaseId(result.conversation.baseId || '');setScope({baseId:result.conversation.baseId,documentId:result.conversation.documentId,documentVersion:result.conversation.documentVersion,entityId:result.conversation.entityId,task:result.conversation.task,scenario:result.conversation.scenario});setQuestion('');const restoredParams=new URLSearchParams({conversationId:id});urlSignature.current=restoredParams.toString();setParams(restoredParams,{replace:true});if (window.matchMedia('(max-width: 959px)').matches) setShowHistory(false);
    } catch (error) { setError(errorMessage(error)); }
    finally { if (request === currentRequest.current) setLoadingHistory(false); }
  }
  function resetConversationView() {
    ++currentRequest.current; scrollIntent.current = 'end';
    setConversationId('');setConversationRevision(undefined);setRunId('');setPendingRequest(null);setScenarioInputs({});setScenarioVersionId('');setScope({});setBaseId('');urlSignature.current='';setParams({},{replace:true}); setMessages([]); setQuestion(''); setError(''); setLoadingHistory(false); if (window.matchMedia('(max-width: 959px)').matches) setShowHistory(false);
  }
  function newChat() {
    if (busy) return;
    resetConversationView();
  }
  async function confirmDeleteConversation() {
    if (!deleteTarget || deleting || busy) return;
    const id = deleteTarget.id;
    setDeleting(true);setError('');
    try {
      await api(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setDeleteTarget(null);
      history.reload();
      if (conversationId === id) resetConversationView();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }
  useEffect(()=>{const signature=params.toString();if(signature===urlSignature.current||busy)return;urlSignature.current=signature;const requestedConversation=params.get('conversationId')||params.get('conversation');if(requestedConversation){void openConversation(requestedConversation);return;}++currentRequest.current;setConversationId('');setConversationRevision(undefined);setRunId('');setPendingRequest(null);setMessages([]);setScope(scopeFromParams(params));setBaseId(params.get('baseId')||'');setScenarioVersionId(params.get('scenarioVersionId')||'');setScenarioInputs({});setQuestion(params.get('q')||'');setError('');setLoadingHistory(false);},[params,busy]);
  async function startRun(request:{body:Record<string,unknown>;content:string;before:DisplayMessage[]}) {
    setBusy(true);setError('');
    try {
      const result=await api<{run:ChatRun}>('/chat/runs',{method:'POST',body:JSON.stringify(request.body)});
      setRunId(result.run.id);setConversationId(result.run.conversationId);setConversationRevision(result.run.conversationRevision);setPendingRequest(null);setQuestion('');history.reload();
    } catch(error) {
      setBusy(false);setError(errorMessage(error));const status=(error as {status?:number}).status;
      if(status===0||status===502||status===503||status===504)setPendingRequest(request);
      else {setMessages(request.before);setQuestion(request.content);setPendingRequest(null);}
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();const content=question.trim();if(!content||busy||loadingHistory||pendingRequest)return;
    const request={content,before:messages,body:{question:content,baseId:baseId||undefined,documentId:scope.documentId,documentVersion:scope.documentVersion,entityId:scope.entityId,task:scope.task,scenario:scope.scenario,conversationId:conversationId||undefined,conversationRevision,clientRequestId:crypto.randomUUID(),scenarioVersionId:scenarioVersionId||undefined,inputs:scenarioInputs,chatModel:chatModel||undefined}};
    scrollIntent.current='end';setMessages(old=>[...old,{id:String(request.body.clientRequestId),role:'user',content}]);setQuestion('');await startRun(request);
  }
  const rangeLabel = [bases.data?.bases.find(base => base.id === baseId)?.name || '全部可访问知识库', scope.documentId ? ('指定资料' + (scope.documentVersion ? ' · V' + scope.documentVersion : '')) : '', selectedScenario ? selectedScenario.name : '通用问答'].filter(Boolean).join(' / ');
  const scopeLocked = busy || Boolean(messages.length) || Boolean(pendingRequest);
  const runStatus = observer.detail?.run?.status;
  const lastAssistantIndex = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return i; return -1; })();
  const lastAssistant = lastAssistantIndex >= 0 ? messages[lastAssistantIndex] : null;
  const fuseRunIntoAnswer = Boolean(
    runId
    && (runStatus === 'succeeded' || runStatus === 'completed')
    && !loadingHistory
    && !busy
    && lastAssistant
    && (lastAssistant.id === `answer_${runId}` || messages[messages.length - 1]?.role === 'assistant'),
  );
  const attachRun = (id: string) => { setBusy(true); setRunId(id); };
  return <div className="e-page e-chat-page">
    <div className="e-chat-grid" data-history-open={showHistory}>
      {showHistory && <button className="e-chat-history-backdrop" type="button" aria-label="关闭历史会话" onClick={() => setShowHistory(false)}/>}
      <aside id="chat-history" className={`e-card e-chat-history ${showHistory ? 'open' : ''}`} hidden={!showHistory} aria-label="历史会话">
        <div className="e-section-heading"><h2><History size={16}/>历史会话</h2><button type="button" className="e-icon-btn" aria-label="收起历史会话" onClick={() => setShowHistory(false)}><PanelLeftClose size={16}/></button></div>
        {history.error && <Notice kind="error">{history.error}</Notice>}
        {history.loading && !history.data ? <Loading/> : history.data?.conversations.length ?
          <div className="e-conversations">{history.data.conversations.map(item =>
            <div className={`e-conversation-item${conversationId === item.id ? ' active' : ''}`} key={item.id}>
              <button type="button" className="e-conversation-open" title={item.title}
                onClick={() => openConversation(item.id)} disabled={busy || deleting}>
                <MessageSquare size={16}/>
                <div><strong>{item.title || '知识问答'}</strong><span>{formatDate(item.updatedAt || item.createdAt)}</span></div>
              </button>
              <button type="button" className="e-conversation-delete" aria-label={`删除会话：${item.title || '知识问答'}`}
                title="删除此会话" disabled={busy || deleting}
                onClick={event => { event.stopPropagation(); setDeleteTarget(item); }}>
                <Trash2 size={14}/>
              </button>
            </div>)}</div> : <div className="e-history-empty"><MessageSquare size={25}/><p>问答记录将保存在这里</p></div>}
        <p className="e-history-note"><ShieldCheck size={14}/>{user.authMode==='local'?'本地工作空间的会话记录，不代表真实员工身份。':'会话按账号隔离，重新查阅时继续校验知识权限。'}</p>
      </aside>
      <section className="e-card e-chat-main" aria-label="企业知识问答">
        <div className="e-chat-toolbar">
          <button className="e-icon-btn e-history-toggle" type="button" aria-label={showHistory ? '收起历史会话' : '展开历史会话'} title={showHistory ? '收起历史会话' : '展开历史会话'} aria-expanded={showHistory} aria-controls="chat-history" onClick={() => setShowHistory(value => !value)}>{showHistory ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</button>
          <div className="e-chat-identity"><strong><Sparkles size={16}/>企业知识助手</strong><span title={rangeLabel}>{rangeLabel}</span></div>
          <div className="e-chat-toolbar-filters" role="group" aria-label="知识范围与业务场景">
            <label className="e-chat-toolbar-field">
              <span>知识范围</span>
              <SelectControl aria-label="问答知识范围" value={baseId} onChange={event => setBaseId(event.target.value)} disabled={scopeLocked || Boolean(scope.documentId)}>
                <option value="">全部可访问知识库</option>
                {bases.data?.bases.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}
              </SelectControl>
            </label>
            <label className="e-chat-toolbar-field">
              <span>业务场景</span>
              <SelectControl aria-label="业务场景" value={scenarioVersionId} onChange={event => { setScenarioVersionId(event.target.value); setScenarioInputs({}); }} disabled={scopeLocked}>
                <option value="">通用知识问答</option>
                {publishedScenarios.map(({ row, version }) => <option key={version.id} value={version.id}>{row.name} · V{version.version}</option>)}
              </SelectControl>
            </label>
          </div>
          <div className="e-chat-toolbar-actions">
            <button className="e-btn small" type="button" onClick={newChat} disabled={busy} aria-label="新建会话"><Plus size={16}/><span>新建会话</span></button>
          </div>
        </div>
        {(bases.error || scenarios.error) && <Notice kind="error">{bases.error ? `知识库列表：${bases.error}` : `场景列表：${scenarios.error}`}</Notice>}
        {(selectedScenario?.goal || (Boolean(messages.length) && (scope.documentId || scope.entityId || scope.task))) && (
          <div className="e-chat-scope-strip">
            {Boolean(messages.length) && (scope.documentId || scope.entityId || scope.task) && <p className="e-muted e-chat-scope-note">本会话保持原有资料范围；切换资料或任务请新建会话。</p>}
            {selectedScenario?.goal && <p className="e-muted e-chat-scenario-goal">{selectedScenario.goal}</p>}
          </div>
        )}
        <div ref={messagesContainer} className="e-messages" aria-live="polite">
          {loadingHistory ? <Loading text="正在读取历史会话…"/> : messages.length ? messages.map((message, index) =>
            <article className={`e-message ${message.role}`} key={`${message.id}-${index}`}>
              <span className="e-message-avatar">{message.role === 'user' ? '我' : <Sparkles size={18}/>}</span>
              <div className="e-message-body">
                {message.role === 'assistant' && <div className="e-answer-mode"><strong>企业知识助手</strong>
                  <span className={`e-badge ${message.mode === 'model' ? 'published' : message.mode === 'insufficient' ? 'review' : ''}`}>
                    {message.mode === 'model' ? '基于原文生成' : message.mode === 'insufficient' ? '依据不足' : message.mode==='tool'?'工具执行结果':'原文证据摘录'}</span></div>}
                {message.role === 'assistant' ? <AnswerText content={message.content} citations={message.citations}/> : <p className="e-answer-text">{message.content}</p>}
                {message.warning && <Notice kind="warning">{message.warning}</Notice>}
                <CoverageNotice coverage={message.coverage}/><ToolResults results={message.toolResults}/>
                {message.role === 'assistant' && <><AnswerCitations message={message}/><GraphPaths paths={message.graphPaths}/>
                  {fuseRunIntoAnswer && index === lastAssistantIndex ? (
                    <RunProgress layout="inline" observer={observer} user={user} onRun={attachRun}>
                      <button type="button" onClick={() => setFeedback({ message,
                        question: messages.slice(0, index).reverse().find(row => row.role === 'user')?.content || '' })}>
                        <ThumbsDown size={14}/>反馈答案问题</button>
                    </RunProgress>
                  ) : (
                    <div className="e-answer-actions"><button type="button" onClick={() => setFeedback({ message,
                      question: messages.slice(0, index).reverse().find(row => row.role === 'user')?.content || '' })}>
                      <ThumbsDown size={14}/>反馈答案问题</button></div>
                  )}</>}
              </div>
            </article>) : <div className="e-chat-welcome">
              <span className="e-chat-welcome-icon"><Sparkles size={36}/></span><h2>你的企业知识助手</h2>
              <p>描述具体业务问题，我会查找当前有权使用的已发布资料，<br className="e-desktop-only"/>提供相关依据，并保留可核验的来源。</p>
              <div className="e-question-examples" aria-label="示例问题">
                {exampleQuestions.map(text =>
                  <button key={text} type="button" onClick={() => setQuestion(text)}><MessageSquare size={16}/>{text}<ArrowRight size={15}/></button>)}
              </div>
            </div>}
          {runId && !fuseRunIntoAnswer ? <RunProgress observer={observer} user={user} onRun={attachRun}/> : busy && !runId && <Loading text="正在提交问题…"/>}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {pendingRequest&&<Notice kind="warning">请求是否受理尚未确认。重新确认将沿用同一请求编号，不会重新创建相同运行。<button className="e-btn" disabled={busy} onClick={()=>void startRun(pendingRequest)}>重新确认请求</button></Notice>}
        <form className="e-chat-composer" onSubmit={send}>
          <div className="e-chat-model-bar">
            <label className="e-chat-model-field">
              <span className="e-chat-model-label">回答模型</span>
              <SelectControl aria-label="回答所用模型" value={chatModel} onChange={e => setChatModel(e.target.value)} disabled={busy || loadingHistory || Boolean(pendingRequest)}>
                {(capabilities.data?.model?.profiles || [{ id: 'qwen3.8-max', label: '通义千问 3.8 Max（最强）' }]).map(row =>
                  <option key={row.id} value={row.id}>{row.label}</option>)}
              </SelectControl>
            </label>
            <span className="e-muted e-chat-model-hint">回答会尽量说人话，并保留原文引用</span>
          </div>
          <textarea aria-label="输入问题" value={question} onChange={event => setQuestion(event.target.value)}
            placeholder="提出问题，描述背景，或输入需要查找的制度条款…" rows={1} maxLength={4000} disabled={busy || loadingHistory || Boolean(pendingRequest)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
          <div className="e-chat-composer-actions"><span>Enter 发送 · Shift + Enter 换行</span><button className="e-btn primary" disabled={busy || loadingHistory || Boolean(pendingRequest) || !question.trim()}>
            <Send size={15}/>{busy ? '正在回答…' : '发送'}</button></div>
        </form>
      </section>
    </div>
    {feedback && <FeedbackDialog question={feedback.question} messageId={feedback.message.id} defaultType="incorrect" onClose={() => setFeedback(null)}/>}
    {deleteTarget && <Modal title="删除历史会话" onClose={() => !deleting && setDeleteTarget(null)} busy={deleting}>
      <div className="e-stack">
        <p>确定删除「{deleteTarget.title || '知识问答'}」？删除后无法恢复，该会话中的问答记录将一并清除。</p>
        <div className="e-modal-actions">
          <button type="button" className="e-btn" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button>
          <button type="button" className="e-btn primary" disabled={deleting} onClick={() => void confirmDeleteConversation()}>{deleting ? '正在删除…' : '删除'}</button>
        </div>
      </div>
    </Modal>}
  </div>;
}
function FeedbackDialog({question,messageId,documentId,defaultType,onClose}:{question:string;messageId?:string;documentId?:string;defaultType:string;onClose:()=>void}){
  const [type,setType]=useState(defaultType);const [comment,setComment]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/feedback',{method:'POST',body:JSON.stringify({question,messageId,documentId,type,comment})});setSaved(true);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Modal title="反馈知识问题" onClose={onClose} busy={busy}>{saved?<div className="e-stack"><Notice kind="success">反馈已保存，知识管理员可在反馈中心跟进处理。</Notice><div className="e-modal-actions"><Link className="e-btn" to="/application/feedback" onClick={onClose}>查看我的反馈</Link><button className="e-btn primary" onClick={onClose}>完成</button></div></div>:<form className="e-stack" onSubmit={submit}>{error&&<Notice kind="error">{error}</Notice>}<p className="e-muted">问题：{question||'知识内容反馈'}</p><label className="e-field">问题类型<SelectControl value={type} onChange={e=>setType(e.target.value)}><option value="incorrect">内容或答案不准确</option><option value="missing">缺少相关知识</option><option value="outdated">资料已过期</option><option value="citation">引用依据有误</option><option value="other">其他问题</option></SelectControl></label><label className="e-field">具体说明<textarea rows={4} required value={comment} maxLength={2000} onChange={e=>setComment(e.target.value)} placeholder="请描述哪里不准确，或应补充什么资料，便于责任人修订。"/></label><div className="e-modal-actions"><button type="button" className="e-btn" disabled={busy} onClick={onClose}>取消</button><button className="e-btn primary" disabled={busy}>{busy?'正在提交…':'提交反馈'}</button></div></form>}</Modal>;
}

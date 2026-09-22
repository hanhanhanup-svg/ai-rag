import { cleanString, requireValue } from './security.mjs';
import { SCENARIOS, getRecommendations } from './recommendations.mjs';
import { search } from './retrieval.mjs';
import { retrieveGraph } from './knowledge-graph.mjs';
import { knowledgePresentationPolicy } from './knowledge-checks.mjs';

const GRAPH_HINT = /关联|关系|路径|相连|涉及|图谱|实体|线路|车站|设备编号|工单.*(?:问题|故障|规程)/u;
const QUESTION_HINT = /[？?]|(如何|怎么|怎样|为什么|是否|能否|需要什么|请说明|请查找|帮我|有哪些)/u;
const SCENARIO_HINT = /场景|任务|客运|运营|维修|检修|培训|交接|台账|投诉|失物/u;

function scoreChannels(query) {
  const q = cleanString(query, 1000);
  const channels = {
    documents: { id: 'documents', label: '文档搜索', score: 12, reasons: ['默认检索已发布资料原文'] },
    scenarios: { id: 'scenarios', label: '业务场景', score: 0, reasons: [] },
    graph: { id: 'graph', label: '知识图谱', score: 0, reasons: [] },
    chat: { id: 'chat', label: '智能问答', score: 0, reasons: [] },
  };
  const matchedScenarios = [];
  for (const scenario of SCENARIOS) {
    const hits = scenario.keywords.filter(word => q.includes(word));
    if (!hits.length) continue;
    matchedScenarios.push({ ...scenario, hits });
    channels.scenarios.score += 8 + hits.length * 6;
    channels.scenarios.reasons.push(`命中「${scenario.label}」关键词：${hits.slice(0, 3).join('、')}`);
  }
  if (SCENARIO_HINT.test(q) && channels.scenarios.score < 8) {
    channels.scenarios.score += 6;
    channels.scenarios.reasons.push('问句包含业务场景/任务表述');
  }
  if (GRAPH_HINT.test(q)) {
    channels.graph.score += 22;
    channels.graph.reasons.push('问句偏向对象关联、路径或图谱探索');
  }
  if (QUESTION_HINT.test(q) || q.length >= 12) {
    channels.chat.score += QUESTION_HINT.test(q) ? 16 : 8;
    channels.chat.reasons.push(QUESTION_HINT.test(q) ? '问句适合进入有依据的智能问答' : '问题较长，可进一步由问答整理依据');
  }
  if (/规程|规范|制度|手册|原文|资料|文档|页/.test(q)) {
    channels.documents.score += 10;
    channels.documents.reasons.push('问句指向资料原文或规程条款');
  }
  const ranked = Object.values(channels).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = ranked.filter(row => row.score >= 8).slice(0, 3);
  if (!selected.some(row => row.id === 'documents')) selected.push(channels.documents);
  const primary = selected[0]?.id || 'documents';
  return {
    query: q,
    primary,
    channels: ranked.map(row => ({
      id: row.id,
      label: row.label,
      score: row.score,
      selected: selected.some(item => item.id === row.id),
      reasons: row.reasons.slice(0, 3),
    })),
    matchedScenarios: matchedScenarios
      .sort((a, b) => b.hits.length - a.hits.length)
      .slice(0, 3)
      .map(({ id, label, tasks, hits }) => ({ id, label, tasks, hits })),
  };
}

function href(path, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return path + (params.size ? `?${params}` : '');
}

function publicDoc(row) {
  return {
    documentId: row.documentId,
    title: row.title,
    version: row.version,
    baseId: row.baseId,
    page: row.page,
    heading: row.heading || '',
    excerpt: cleanString(row.text || row.excerpt || '', 320),
    score: row.score,
    matchReason: row.matchReason || (row.reasons && row.reasons[0]) || '',
    sourceKind: row.sourceKind || 'unspecified',
    chunkId: row.id || row.chunkId || null,
    route: href(`/documents/${row.documentId}`, { chunk: row.id || row.chunkId || undefined }),
  };
}

export function analyzeUnifiedIntent(query) {
  return scoreChannels(query);
}

export async function unifiedSearch(store, user, input = {}) {
  const query = cleanString(input.q ?? input.query, 1000);
  requireValue(query, 400, 'QUERY_REQUIRED', '请输入查找内容。');
  const baseId = cleanString(input.baseId, 120);
  const intent = analyzeUnifiedIntent(query);
  const selected = new Set(intent.channels.filter(row => row.selected).map(row => row.id));
  const topScenario = intent.matchedScenarios[0];
  const policy = knowledgePresentationPolicy(store, user);

  const jobs = {
    documents: selected.has('documents') || selected.has('chat')
      ? search(store, user, query, { baseId, limit: 8 })
      : Promise.resolve(null),
    graph: selected.has('graph')
      ? Promise.resolve(retrieveGraph(store, user, query, { baseId, limit: 10, maxHops: 3 }))
      : Promise.resolve(null),
  };
  const [documentsRaw, graphRaw] = await Promise.all([jobs.documents, jobs.graph]);

  let recommendations = null;
  if (selected.has('scenarios') && topScenario) {
    recommendations = getRecommendations(store, user, {
      q: query,
      scenario: topScenario.id,
      task: topScenario.tasks[0] || '',
      baseId,
      contextId: 'unified-search',
    }, { policy, searchResult: documentsRaw });
  }

  const documents = (documentsRaw?.results || []).slice(0, 8).map(publicDoc);
  const scenarioItems = (recommendations?.items || []).slice(0, 6).map(item => ({
    ...publicDoc(item),
    reasons: item.reasons || [],
    reviewOverdue: !!item.reviewOverdue,
    route: href(`/documents/${item.documentId}`, { chunk: item.chunkId || undefined }),
  }));
  const graph = graphRaw
    ? {
        entities: (graphRaw.entities || []).slice(0, 8).map(node => ({
          id: node.id,
          name: node.name,
          type: node.type,
          externalId: node.externalId || '',
          route: href('/assets/objects/' + encodeURIComponent(node.id), { baseId }),
        })),
        paths: (graphRaw.paths || []).slice(0, 6).map(path => ({
          id: path.id,
          label: (path.edges || []).map(edge => edge.label).join(' → '),
          hops: (path.edges || []).length,
          nodeNames: (path.nodes || []).map(node => node?.name).filter(Boolean),
        })),
        evidence: (graphRaw.results || []).slice(0, 6).map(publicDoc),
        stats: graphRaw.stats || {},
      }
    : null;

  const routes = {
    unified: href('/application/find', { q: query, baseId }),
    documents: href('/application/search', { q: query, baseId, ...(topScenario ? { scenario: topScenario.id, task: topScenario.tasks[0] } : {}) }),
    scenarios: href('/application/hub', { q: query, baseId, ...(topScenario ? { scenario: topScenario.id, task: topScenario.tasks[0] } : {}) }),
    graph: href('/assets/graph', { query, baseId, hops: 3 }),
    chat: href('/application/chat', { q: query, baseId, ...(topScenario ? { scenario: topScenario.id, task: topScenario.tasks[0] } : {}) }),
  };

  return {
    query,
    baseId: baseId || null,
    intent,
    strategy: {
      selectedChannels: [...selected],
      primary: intent.primary,
      summary: `优先使用${intent.channels.find(row => row.id === intent.primary)?.label || '文档搜索'}，并组合 ${[...selected].map(id => intent.channels.find(row => row.id === id)?.label).filter(Boolean).join('、')}`,
    },
    scenarios: {
      matched: intent.matchedScenarios,
      items: scenarioItems,
      emptyReason: selected.has('scenarios') ? (scenarioItems.length ? null : '当前场景下暂无匹配任务资料') : null,
    },
    documents: {
      strategy: documentsRaw?.strategy || null,
      evidence: documentsRaw?.evidence || null,
      items: documents,
      emptyReason: selected.has('documents') || selected.has('chat') ? (documents.length ? null : '未命中可用原文依据') : null,
    },
    graph: graph && {
      ...graph,
      emptyReason: (graph.entities.length || graph.paths.length) ? null : '未匹配到已核验的知识关系',
    },
    routes,
    nextActions: [
      selected.has('chat') || intent.primary === 'chat' ? { id: 'chat', label: '进入智能问答整理依据', route: routes.chat } : null,
      selected.has('scenarios') ? { id: 'scenarios', label: '按业务场景继续', route: routes.scenarios } : null,
      selected.has('documents') ? { id: 'documents', label: '查看更多文档依据', route: routes.documents } : null,
      selected.has('graph') ? { id: 'graph', label: '在知识图谱中探索', route: routes.graph } : null,
    ].filter(Boolean),
  };
}

export function unifiedSearchSpec() {
  return {
    name: '综合查找',
    version: '1.0',
    description: '根据用户问题智能判断应走业务场景、文档搜索、知识图谱或智能问答，并一次性返回组合结果与跳转路由。',
    endpoint: 'GET /api/unified-search',
    authentication: '登录会话（与网页业务接口相同）',
    query: [
      { name: 'q', required: true, type: 'string', description: '查找语句，最长 1000 字' },
      { name: 'baseId', required: false, type: 'string', description: '可选，限定知识库' },
    ],
    response: {
      intent: '意图分析结果，含 channels[].selected 与 matchedScenarios',
      documents: '文档搜索命中摘要',
      scenarios: '业务场景匹配及任务资料',
      graph: '图谱实体、路径与证据（按需）',
      routes: '各通道深度页面链接',
      nextActions: '建议的下一步操作',
    },
    notes: [
      '不会自动发起完整智能问答 run；如需生成回答，请跳转 routes.chat 或调用 /api/chat/runs。',
      '仅返回当前账号有权访问、已发布且在有效期内的知识。',
      '意图规则可解释；不伪造图谱关系或文档命中。',
    ],
    example: '/api/unified-search?q=' + encodeURIComponent('设备台账与工单有什么关联？'),
  };
}

export async function handleUnifiedSearch(context) {
  const { pathname, method, store, user, res, send, rate, url } = context;
  if (pathname === '/api/unified-search/spec' && method === 'GET') {
    send(res, 200, unifiedSearchSpec());
    return true;
  }
  if (pathname === '/api/unified-search' && method === 'GET') {
    rate?.(`unified-search:${user.id}`, 60, 60000);
    const input = Object.fromEntries(url.searchParams);
    send(res, 200, await unifiedSearch(store, user, input));
    return true;
  }
  return false;
}

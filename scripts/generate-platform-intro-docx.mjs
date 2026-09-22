/**
 * Generate docs/企业多模态知识库平台介绍.docx
 * Run: node scripts/generate-platform-intro-docx.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  VerticalAlign,
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(path.resolve(__dirname, '..'), 'docs', '企业多模态知识库平台介绍.docx');

const brand = '1E5A86';
const muted = '5A6D7E';
const ink = '1A2B3C';
const soft = 'E8F1F8';
const accentSoft = 'FFF4E8';
const okSoft = 'E8F5EF';

function run(text, opts = {}) {
  return new TextRun({
    text,
    font: '微软雅黑',
    size: opts.size ?? 21,
    bold: opts.bold,
    color: opts.color ?? ink,
    italics: opts.italics,
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 140, before: opts.before ?? 0, line: 360 },
    alignment: opts.align,
    children: [run(text, opts)],
  });
}

function h(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 300, after: 140 },
    children: [run(text, { bold: true, color: brand, size: level === HeadingLevel.HEADING_1 ? 32 : 26 })],
  });
}

function bullets(items) {
  return items.map(
    (text) =>
      new Paragraph({
        spacing: { after: 70, line: 340 },
        indent: { left: 280 },
        children: [run(`• ${text}`, { size: 20 })],
      }),
  );
}

function cell(text, { header = false, width = 2340, fill, align = AlignmentType.LEFT, bold } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: header || fill ? { type: ShadingType.CLEAR, fill: fill || soft } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'D5DEE7' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D5DEE7' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'D5DEE7' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'D5DEE7' },
    },
    children: [
      new Paragraph({
        alignment: align,
        spacing: { after: 40, before: 40 },
        children: [run(String(text), { size: header ? 18 : 18, bold: bold ?? header, color: header ? brand : ink })],
      }),
    ],
  });
}

function table(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(9020 / headers.length));
  return new Table({
    width: { size: 9020, type: WidthType.DXA },
    rows: [
      new TableRow({ children: headers.map((title, i) => cell(title, { header: true, width: w[i] })) }),
      ...rows.map((row) => new TableRow({ children: row.map((c, i) => cell(c, { width: w[i] })) })),
    ],
  });
}

/** Visual architecture block as colored cells */
function archRow(items, widths, fills) {
  return new Table({
    width: { size: 9020, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: items.map((text, i) =>
          cell(text, {
            width: widths[i],
            fill: fills[i],
            align: AlignmentType.CENTER,
            bold: true,
          }),
        ),
      }),
    ],
  });
}

function figCaption(text) {
  return p(text, { size: 17, color: muted, align: AlignmentType.CENTER, after: 200, before: 60 });
}

function spacer() {
  return p('', { after: 80 });
}

const doc = new Document({
  creator: 'X-RAG',
  title: '企业多模态知识库平台介绍',
  description: '面向决策层的企业多模态知识库平台总体介绍',
  sections: [
    {
      properties: {
        page: { margin: { top: 1008, bottom: 1008, left: 1008, right: 1008 } },
      },
      headers: {
        default: new Header({
          children: [p('企业多模态知识库平台介绍 · X-RAG', { size: 16, color: muted, after: 0 })],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run('第 ', { size: 16, color: muted }),
                new TextRun({ children: [PageNumber.CURRENT], font: '微软雅黑', size: 16, color: muted }),
                run(' 页', { size: 16, color: muted }),
              ],
            }),
          ],
        }),
      },
      children: [
        p('ENTERPRISE MULTIMODAL KNOWLEDGE', { size: 18, color: brand, bold: true, after: 60 }),
        new Paragraph({
          spacing: { after: 180 },
          children: [run('企业多模态知识库平台介绍', { bold: true, size: 44, color: brand })],
        }),
        p(
          '把分散在制度、表格、图纸说明、音视频中的企业资料，建成「找得到、管得住、用得开、有出处」的知识服务平台，支撑业务查找、带依据问答与系统集成，辅助决策而不替代正式制度效力。',
          { size: 22, after: 160 },
        ),
        p('文档定位：面向决策层 / 业务负责人　　产品形态：单节点可部署企业知识平台　　更新日期：2026-09', {
          size: 17,
          color: muted,
          after: 280,
        }),

        h('1. 总体定位与价值'),
        p(
          '企业知识往往散落在 PDF、Word、Excel、扫描件与音视频中。业务人员「问得到人、找不到依据」；知识管理人员「有文档、难治理」；系统建设「有模型、缺证据」。本平台以多模态接入 + 证据核验 + 权限可控 + 场景化应用为主线，形成可持续运营的企业知识底座。',
        ),
        ...bullets(['找得着 · 场景与原文双路径', '管得住 · 发布审核与版本', '用得开 · 问答 / 图谱 / 标准接口']),
        p('对业务人员：按任务、对象、问题快速定位有效资料；问答结果带回原文引用，减少「凭印象答复」。', { size: 20 }),
        p('对知识管理员：统一接入、解析、属性标注、重复冲突核验、知识卡片与需求池，形成可运营的知识生产流水线。', { size: 20 }),
        p('对平台与 IT：服务端鉴权、审计留痕、模型与解析服务可配置；标准知识接口可被业务系统安全调用。', { size: 20 }),
        p(
          '一句话口径：将企业多模态资料纳入「授权可控、原文可溯、发布可审、接口可集成」的知识闭环，支撑业务场景查找与带依据智能问答，并以需求池、卡片、评测与审计持续治理质量。',
          { bold: true, size: 20, after: 220 },
        ),

        h('2. 总体能力全景'),
        p('从「资料进入」到「业务使用」，再到「质量回流」的端到端视图，便于领导把握平台全貌。'),
        spacer(),
        archRow(['① 资料接入', '② 知识资产', '③ 知识应用', '④ 质量运营'], [2255, 2255, 2255, 2255], [soft, soft, accentSoft, okSoft]),
        spacer(),
        archRow(
          ['上传/解析/同步/属性标注', '库·文档·对象·卡片·需求池·图谱', '查找·问答·场景·标准接口', '核验·补全·评测·审计备份'],
          [2255, 2255, 2255, 2255],
          ['F7FBFE', 'F7FBFE', 'FFFBF5', 'F5FBF8'],
        ),
        p('主链路：接入 → 资产 → 应用；应用缺口回流需求池，补齐后回归验证再进入应用。', {
          size: 18,
          color: muted,
          align: AlignmentType.CENTER,
          before: 100,
        }),
        figCaption('图1 企业多模态知识库总体能力全景'),
        table(
          ['能力亮点', '说明'],
          [
            ['7 大导航能力中心', '工作台 / 应用 / 资产 / 加工 / 治理 / 运营 / 管理'],
            ['单文件 100MB', '多模态资料接入上限'],
            ['全程引用', '答复可回原文证据'],
          ],
          [2800, 6220],
        ),

        h('3. 功能架构'),
        p(
          '平台按「工作台 → 应用 → 资产 → 加工 → 治理 → 运营 → 管理」七大中心组织能力，菜单按角色（管理员 / 知识管理员 / 使用者）裁剪，保证一线人员界面简洁、管理人员能力完整。',
        ),
        h('3.1 七大功能中心', HeadingLevel.HEADING_2),
        spacer(),
        archRow(['工作台', '知识应用', '知识资产'], [3006, 3007, 3007], [soft, soft, soft]),
        spacer(),
        archRow(['接入加工', '质量治理', '运营分析', '平台管理'], [2255, 2255, 2255, 2255], [accentSoft, accentSoft, okSoft, soft]),
        p('加工成果进入资产；资产支撑应用；应用驱动治理与运营；平台管理为全链路提供模型、接口、审计与备份能力。', {
          size: 18,
          color: muted,
          align: AlignmentType.CENTER,
          before: 100,
        }),
        figCaption('图2 功能架构：七大中心协同关系'),
        table(
          ['中心', '面向角色', '核心能力'],
          [
            ['工作台', '全员', '知识规模、待办汇聚，一键进入查找 / 问答 / 图谱'],
            ['知识应用', '业务人员、管理员', '综合查找、知识搜索、智能问答、业务场景、收藏与反馈'],
            ['知识资产', '全员（按权限）', '知识库矩阵、文档、业务对象、知识卡片、需求池、知识图谱'],
            ['接入加工', '知识管理员', '多模态文件接入、资料源同步、解析索引、属性标注'],
            ['质量治理', '知识管理员', '近似重复 / 条款冲突核验、反馈记录与沉淀'],
            ['运营分析', '管理员', '质量评测、运行追踪、答复完整性补全'],
            ['平台管理', '管理员', '模型与服务目录、标准知识接口、审计、备份、组织人员'],
          ],
          [1600, 2200, 5220],
        ),
        h('3.2 知识生产与应用功能分层', HeadingLevel.HEADING_2),
        p('生产侧：多模态解析、属性标注（模板草稿+人工确认）、知识卡片（发布须关联原文）、图谱关系候选确认。', { size: 20 }),
        p('应用侧：综合查找意图分流、智能问答强制引用、业务场景评测发布、标准接口按绑定范围调用。', { size: 20 }),
        h('3.3 近期增强能力（知识闭环升级）', HeadingLevel.HEADING_2),
        spacer(),
        archRow(['属性标注', '知识卡片', '完整性补全', '知识需求池'], [2255, 2255, 2255, 2255], [soft, soft, accentSoft, okSoft]),
        p('属性/卡片强化检索与口径 → 问答完整性发现缺口 → 需求池分派补齐 → 回归复测。', {
          size: 18,
          color: muted,
          align: AlignmentType.CENTER,
          before: 100,
        }),
        figCaption('图3 属性 · 卡片 · 完整性 · 需求池闭环'),
        ...bullets([
          '属性标注：文档/片段级属性建议与确认，服务检索过滤与问答条件。',
          '知识卡片：四类模板；草稿不作标准口径，冲突并排保留。',
          '完整性补全：解析应答要点；智能补全仅结构/澄清，知识补全必须带证据。',
          '知识需求池：缺口归集为待确认工单，支持分派、复测、关闭。',
        ]),

        h('4. 技术架构'),
        p('技术选型强调可落地、可审计、可单节点试点，兼顾后续扩展。'),
        h('4.1 分层技术架构', HeadingLevel.HEADING_2),
        spacer(),
        archRow(['表现层：React + TypeScript + Vite 企业工作台'], [9020], [soft]),
        spacer(),
        archRow(['服务层：Node.js API（会话 · ACL · 业务模块）'], [9020], [soft]),
        spacer(),
        archRow(['混合检索', '问答编排/引用', '多模态解析', '图谱与对象'], [2255, 2255, 2255, 2255], [accentSoft, accentSoft, okSoft, soft]),
        spacer(),
        archRow(['数据层：SQLite WAL + 原件库 uploads', '外部：大模型 / Ollama / 向量嵌入'], [4510, 4510], [soft, accentSoft]),
        figCaption('图4 技术分层架构'),
        ...bullets([
          '前端：统一企业壳与七大导航；文档预览、图谱可视化、运行追踪与完整性面板。',
          'API：统一入口处理认证、权限、文档生命周期、检索问答、属性/卡片/需求池、标准接口、备份与审计。',
          '检索：中文 BM25 + 可选向量 RRF 融合；无向量时可降级。',
          '存储：单节点 SQLite（WAL）+ 原件目录；模型密钥服务端密封。',
        ]),
        h('4.2 多模态处理链路', HeadingLevel.HEADING_2),
        spacer(),
        archRow(['上传≤100MB', '任务队列', '类型解析', '分块索引', '审核发布'], [1804, 1804, 1804, 1804, 1804], [soft, soft, accentSoft, okSoft, soft]),
        p('文本/Office抽取 · PDF扫描 OCR · 表格结构化 · 音视频 ASR/抽帧 OCR', {
          size: 18,
          color: muted,
          align: AlignmentType.CENTER,
          before: 80,
        }),
        figCaption('图5 多模态接入与发布链路'),
        h('4.3 问答与检索技术路径', HeadingLevel.HEADING_2),
        table(
          ['环节', '做法', '领导关注点'],
          [
            ['检索', 'BM25 + 可选向量，RRF 融合；可叠加已确认图谱路径', '先保证找得到原文，再谈生成'],
            ['生成', '可配置兼容 Chat Completions 或本地 Ollama', '模型可替换，不绑死单一厂商'],
            ['引用', '区分归纳 / 摘录 / 依据不足；回链页码或证据块', '可核验，降低幻觉风险'],
            ['补全', 'smart 仅结构澄清；knowledge 必须有证据；否则进需求池', '不凭常识编造企业时限、审批权限等'],
          ],
          [1400, 4200, 3420],
        ),

        h('5. 核心业务闭环'),
        p('平台不是「一次上传、永久可用」，而是持续运营的知识供应链。'),
        spacer(),
        archRow(['①接入', '②加工', '③核验', '④发布', '⑤应用', '⑥回流', '⑦改进'], [1288, 1288, 1288, 1288, 1288, 1288, 1292], [soft, soft, soft, accentSoft, accentSoft, okSoft, okSoft]),
        p('⑦改进后回到④发布，形成持续运营闭环。', { size: 18, color: muted, align: AlignmentType.CENTER, before: 80 }),
        figCaption('图6 知识运营七步闭环'),
        ...bullets([
          '发布状态机：资料排队→解析→待审→已发布；卡片草稿→审核→有证据后发布；图谱关系需人工确认。',
          '质量回流：用户反馈可沉淀；问答缺口进需求池；评测题库检验场景版本。',
          '对外赋能：标准知识接口绑定库/场景/任务范围，密钥可轮换，调用方无法扩大授权。',
        ]),

        h('6. 安全、治理与建设边界'),
        p(
          '安全与权限：知识库可见范围（企业/部门/成员）；文档保密级别；列表/原件/搜索/问答/接口均服务端鉴权；写操作 Origin 校验；关键动作进入操作审计。',
          { size: 20 },
        ),
        p(
          '治理原则（明确不做）：属性标签不替代 ACL；不自动揉合多来源冲突；不凭模型常识填写审批/时限/金额等事实；知识卡片不替代正式文件效力；当前定位为部门试点可部署，非已验收高可用集群。',
          { size: 20 },
        ),
        p(
          '管理提示：平台产出的答复与卡片是「可追溯的业务辅助口径」。涉及对外承诺、审批结论、安全操作时，仍应以现行有效正式文件与制度流程为准。',
          { bold: true, size: 20 },
        ),

        h('7. 建设成效与推进建议'),
        h('7.1 已形成的能力资产', HeadingLevel.HEADING_2),
        ...bullets([
          '覆盖接入、资产、应用、治理、运营、管理的完整功能骨架。',
          '多模态处理与混合检索底座，支持「无向量也可用、有向量更准」。',
          '引用式问答 + 场景评测发布，降低不可核验答复进入生产的风险。',
          '属性 / 卡片 / 完整性 / 需求池打通「发现缺口 → 补知识 → 再验证」闭环。',
          '标准知识接口便于与既有业务系统集成。',
        ]),
        h('7.2 建议推进节奏', HeadingLevel.HEADING_2),
        spacer(),
        archRow(['阶段一 试点建库', '阶段二 场景问答', '阶段三 需求池治理', '阶段四 接口赋能'], [2255, 2255, 2255, 2255], [soft, soft, accentSoft, okSoft]),
        figCaption('图7 建议建设节奏'),
        table(
          ['阶段', '目标', '衡量方式（示例）'],
          [
            ['阶段一', '核心资料可检索、权限清晰', '入库覆盖率、发布通过率'],
            ['阶段二', '高频问题可带依据回答', '引用完整率、用户有效反馈占比'],
            ['阶段三', '缺口可分派、可关闭、可复测', '需求池关闭周期、复测通过率'],
            ['阶段四', '业务系统稳定调用知识服务', '接口成功率、越权拦截审计'],
          ],
          [1600, 3200, 4220],
        ),

        p('— 完 —', { align: AlignmentType.CENTER, color: muted, after: 60, before: 360 }),
        p('技术实现以现行 X-RAG 企业知识平台代码与配置为准。同步提供 HTML 图文版便于浏览。', {
          align: AlignmentType.CENTER,
          size: 17,
          color: muted,
        }),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log('Wrote', outPath, `(${buffer.length} bytes)`);

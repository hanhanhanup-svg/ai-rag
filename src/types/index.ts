import type { LucideIcon } from "lucide-react";

export type StatusTone = "normal" | "attention" | "success" | "warning" | "danger" | "muted";
export type KnowledgeType = "FAQ" | "SOP" | "text_chunk" | "实体" | "政策" | "合同" | "合规" | "竞品" | "regulation";
export type SensitivityLevel = "公开" | "内部" | "机密" | "绝密";

export interface NavItem {
  title: string;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface Metric {
  label: string;
  value: string | number;
  hint?: string;
  tone?: StatusTone;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  type: "个人" | "部门" | "企业" | "平台";
  owner: string;
  createdAt: string;
  itemCount: number;
  monthlyNew: number;
  qualityScore?: number;
  pendingReview: number;
  status: "正常" | "注意" | "停用";
  color: "blue" | "purple" | "green" | "orange" | "red";
  sensitivity: SensitivityLevel;
  description: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  summary: string;
  type: KnowledgeType;
  knowledgeBase: string;
  tags: string[];
  sensitivity: SensitivityLevel;
  qualityScore: number;
  relevance: number;
  updatedAt: string;
  sourceFile: string;
  status: "有效" | "即将到期" | "已过期";
  reviewer?: string;
  approvedAt?: string;
}

export interface ReviewTask {
  id: string;
  type: KnowledgeType;
  status: "待审核" | "已通过" | "已驳回";
  confidence: number;
  knowledgeBase: string;
  source: string;
  submittedAt: string;
  title: string;
  sourceFile: string;
  submitter: string;
  sla: "正常" | "已超时";
  originalText: string;
  page: string;
  paragraph: string;
  summary: string;
  content: string;
  tags: string[];
  sensitivity: SensitivityLevel;
}

export interface UploadTask {
  id: string;
  fileName: string;
  size: string;
  pages: number;
  skill: string;
  stage: string;
  progress: number;
  extractedCount: number;
  status: "解析中" | "待审核" | "已完成" | "失败";
}

export interface TagSystem {
  id: string;
  name: string;
  dimensions: string[];
  tagCount: number;
  coverage: number;
}

export interface ToolItem {
  id: string;
  name: string;
  toolId: string;
  description: string;
  category: "解析" | "清洗" | "切分" | "抽取" | "知识构建";
  calls: number;
  latency: string;
  successRate: string;
  input: string;
  output: string;
  scenario: string;
  params: string[];
}

export interface SkillItem {
  id: string;
  name: string;
  category: string;
  status: "运行中" | "草稿";
  description: string;
  version: string;
  calls: number;
  latency: string;
  successRate: string;
  pipeline: string[];
}

export interface OutputRule {
  id: string;
  name: string;
  source: string;
  target: string;
  group: string;
  input: string;
  output: string;
  logic: string;
  code: string;
}

export interface ApiApp {
  id: string;
  name: string;
  type: string;
  keyStatus: "启用" | "停用";
  knowledgeBase: string;
  maxSensitivity: string;
  todayCalls: number;
  successRate: string;
  status: "正常" | "限流中";
}

export interface AuditLog {
  id: string;
  time: string;
  operator: string;
  action: string;
  target: string;
  note: string;
}

export interface GovernanceTask {
  id: string;
  title: string;
  issueType: string;
  knowledgeBase: string;
  relatedCount: number;
  owner: string;
  priority: "高" | "中" | "低";
  status: "待处理" | "处理中" | "已完成" | "已延期";
  dueAt: string;
  createdAt: string;
  description: string;
}

export interface QualityRule {
  id: string;
  name: string;
  description: string;
  tags: string[];
  triggers7d: number;
  enabled: boolean;
}

export interface ChatReference {
  title: string;
  sourceFile: string;
  excerpt: string;
  relevance: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  references?: ChatReference[];
  relatedKnowledge?: string[];
  confidence?: number;
}

export interface UserFeedback {
  id: string;
  content: string;
  question: string;
  user: string;
  relatedKnowledge: string;
  type: "答案不准" | "找不到" | "过期" | "权限问题";
  status: "待处理" | "处理中" | "已解决";
  createdAt: string;
}

export interface KnowledgeVersion {
  id: string;
  title: string;
  version: string;
  editor: string;
  editedAt: string;
  changeNote: string;
  status: "当前版本" | "历史版本" | "待发布";
}

export interface LifecycleItem {
  id: string;
  title: string;
  knowledgeBase: string;
  type: KnowledgeType;
  validUntil: string;
  daysLeft: number;
  owner: string;
  status: "正常" | "即将到期" | "已过期" | "长期未更新";
}

export interface ApplicationScenario {
  id: string;
  name: string;
  type: string;
  owner: string;
  knowledgeBase: string;
  maxSensitivity: string;
  calls: number;
  hitRate: string;
  status: "正常" | "配置中" | "停用";
}

export interface PlatformUser {
  id: string;
  name: string;
  department: string;
  role: string;
  knowledgeBases: string;
  maxSensitivity: string;
  status: "启用" | "停用";
  lastLogin: string;
}

export interface PlatformRole {
  id: string;
  name: string;
  description: string;
  userCount: number;
  permissions: string[];
}

export interface NotificationItem {
  id: string;
  title: string;
  type: "待审核提醒" | "SLA 超时提醒" | "治理任务提醒" | "知识到期提醒" | "安全告警提醒" | "API 异常提醒";
  content: string;
  time: string;
  read: boolean;
}

export interface ModelConfig {
  id: string;
  usage: "问答模型" | "Embedding 模型" | "重排模型" | "摘要模型";
  modelName: string;
  provider: string;
  status: "使用中" | "备用" | "未配置";
  updatedAt: string;
}

export interface WebhookItem {
  id: string;
  eventType: string;
  callbackUrl: string;
  status: "启用" | "停用";
  lastTriggered: string;
}

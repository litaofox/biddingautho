// 核心类型定义

/** 审核模式：local=本地规则审核，llm=LLM智能审核 */
export type ReviewMode = "local" | "llm";

export interface Section {
  level: number;
  title: string;
  content: string;
}

export interface UploadedFile {
  name: string;
  size: string;
  text: string;
  sections: Section[];
}

export interface BidderFile {
  type: "technical" | "commercial";
  name: string;
  size: string;
  text: string;
  sections: Section[];
}

export interface Bidder {
  id: string;
  name: string;
  files: BidderFile[]; // 技术标 + 商务标（可只有一个，视为综合）
}

export type StatusType = "pass" | "warn" | "fail" | "none";

export interface ReviewItem {
  id: string;
  name: string;
  category: "qualification" | "commitment" | "technical";
  scope: "common" | "project" | "custom"; // 通用 / 项目特有 / 用户自定义
  keywords: string[];
  expectedText: string;
}

/**
 * 分层审查项集合
 */
export interface ReviewItemSet {
  common: ReviewItem[]; // 通用规则（固定）
  project: ReviewItem[]; // 从采购文件提取的项目特有规则
  custom: ReviewItem[]; // 用户手动添加的自定义规则
}

export interface CellData {
  status: StatusType;
  score: number;
  evidence: string;
  deviation: string;
}

export interface TableRow {
  item: string;
  category: string;
  expectedText: string;
  cells: CellData[];
}

export interface ReviewResult {
  bidders: string[];
  complianceTable: TableRow[];
  evaluation: {
    score: number;
    risks: string[];
    conclusion: string;
  };
  llmEnhanced: boolean;
}

// ========== LLM 审核模块专用类型 ==========

/** 废标项严重程度 */
export type RejectionSeverity = "critical" | "major" | "minor";

/** 废标项定义与判定结果 */
export interface RejectionItem {
  /** 废标项名称 */
  name: string;
  /** 废标条件描述（来自采购文件） */
  description: string;
  /** 严重程度 */
  severity: RejectionSeverity;
  /** 是否触发废标 */
  triggered: boolean;
  /** 触发证据（投标文件原文片段） */
  evidence: string;
  /** 判定理由 */
  reason: string;
}

/** 评分项中单个投标人的得分 */
export interface BidderScore {
  bidder: string;
  /** 得分（0 ~ maxScore） */
  score: number;
  /** 打分理由 */
  reason: string;
  /** 证据片段 */
  evidence: string;
}

/** 评分项 */
export interface ScoringItem {
  /** 评分项名称 */
  name: string;
  /** 满分 */
  maxScore: number;
  /** 评分类别：技术 / 商务 / 价格 / 服务 等 */
  category: string;
  /** 评分标准描述 */
  requirement: string;
  /** 各投标人得分 */
  bidderScores: BidderScore[];
}

/** LLM 审核结果（独立于本地审核的完整结构） */
export interface LLMReviewResult {
  mode: "llm";
  bidders: string[];
  /** LLM 智能梳理的审核项清单 */
  reviewItems: ReviewItem[];
  /** 符合性检查表格（LLM 逐项判定） */
  complianceTable: TableRow[];
  /** 废标项分析 */
  rejection: {
    /** 识别到的所有废标项 */
    items: RejectionItem[];
    /** 按投标人分组的废标触发情况 */
    byBidder: Record<string, RejectionItem[]>;
  };
  /** 评分项与模拟打分 */
  scoringItems: ScoringItem[];
  /** 分析过程日志（可追溯） */
  analysisLog: string[];
  /** 综合评价 */
  evaluation: {
    score: number;
    risks: string[];
    conclusion: string;
    summary: string;
  };
}

/** 本地审核结果（保持原结构，增加 mode 标识） */
export interface LocalReviewResult {
  mode: "local";
  bidders: string[];
  complianceTable: TableRow[];
  evaluation: {
    score: number;
    risks: string[];
    conclusion: string;
  };
  llmEnhanced: boolean;
}

/** 统一审核结果类型 */
export type UnifiedReviewResult = LocalReviewResult | LLMReviewResult;

export interface ReviewConfig {
  items: string[];
  threshold: number;
  /** 审核模式，默认 local */
  mode?: ReviewMode;
  llm?: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    scope: string[];
  };
}

export interface TaskLLMConfig {
  provider: string;
  apiKey: string;
  scope: string[];
}

export interface Task {
  sessionId: string;
  procurement: UploadedFile;
  projectRequirements?: UploadedFile;
  bidders: Bidder[];
  reviewItems?: ReviewItemSet; // 三层审查项集合
  config?: ReviewConfig;
  result?: UnifiedReviewResult; // 双模式统一结果
  llmMode?: boolean; // 是否启用了 LLM 模式（用户触发 LLM 重新生成审查项后置为 true）
  llmConfig?: TaskLLMConfig; // LLM 模式下的配置快照
  reviewMode?: ReviewMode; // 当前审核模式
  createdAt: number;
  lastAccessedAt: number; // 最后访问时间，用于活跃会话续期
  // 多维审核结果（F1-F10 升级后新增）
  multiDimResult?: MultiDimReviewResult;
  // LLM 模式：用户确认后的动态审核清单
  auditPlan?: AuditPlan;
  // LLM 模式：审核清单阶段使用的配置快照
  auditLlmConfig?: TaskLLMConfig;
}

// ========== 多维审核模块类型（F1-F10） ==========

/** 问题位置定位（F9） */
export interface IssueLocation {
  /** 文件名（商务/技术/采购） */
  file: string;
  /** 章节标题 */
  chapter?: string;
  /** 页码（如能解析） */
  page?: number;
  /** 表格编号（如表17-1） */
  tableId?: string;
  /** 表格行号 */
  tableRow?: number;
  /** 原文片段（80字以内） */
  snippet?: string;
}

/** 问题风险等级 */
export type RiskLevel =
  | "critical" // 准高危/废标风险
  | "major"    // 扣分项
  | "minor"    // 细节优化
  | "info"     // 提示
  | "highlight"; // 合规亮点

/** 审核维度 */
export type IssueDimension =
  | "qualification"   // 资格合规
  | "substantive"     // ★实质性条款
  | "consistency"     // 数据一致性（F1）
  | "structure"       // 结构规范（F2）
  | "template"        // 模板残留（F3）
  | "signature"       // 签字盖章（F4）
  | "textFlaw"        // 文本瑕疵（F5）
  | "highlight"       // 合规亮点（F6）
  | "completeness";   // 完整性对照（F8）

/** 审核问题统一结构 */
export interface Issue {
  id: string;
  /** 所属维度 */
  dimension: IssueDimension;
  /** 问题名称 */
  name: string;
  /** 风险等级 */
  riskLevel: RiskLevel;
  /** 位置 */
  location: IssueLocation;
  /** 问题描述 */
  description: string;
  /** 证据片段 */
  evidence?: string;
  /** 招标文件依据条款 */
  basis?: string;
  /** 整改方案 */
  remediation?: string;
  /** 整改优先级（自动从 riskLevel 推导，可手动覆盖） */
  priority?: "P0" | "P1" | "P2";
}

/** 完整性对照项（F8） */
export interface CompletenessItem {
  /** 格式编号（一~十二） */
  formatId: string;
  /** 格式名称 */
  formatName: string;
  /** 对应投标文件 */
  fileName: string;
  /** 状态 */
  status: "complete" | "partial" | "missing";
  /** 备注 */
  remark?: string;
}

/** 整改清单 */
export interface RemediationPlan {
  /** P0 - 递交前必须完成 */
  p0: Issue[];
  /** P1 - 强烈建议完成 */
  p1: Issue[];
  /** P2 - 时间允许时优化 */
  p2: Issue[];
  /** 待人工核验项 */
  manualCheck: string[];
}

/** 多维审核结果（F1-F10 总输出） */
export interface MultiDimReviewResult {
  /** 审核模式 */
  mode: ReviewMode;
  /** 投标人列表 */
  bidders: string[];
  /** 所有维度问题汇总 */
  issues: Issue[];
  /** 完整性对照表 */
  completeness: CompletenessItem[];
  /** 合规亮点 */
  highlights: Issue[];
  /** 整改清单 */
  remediationPlan: RemediationPlan;
  /** 风险总览 */
  summary: {
    criticalCount: number;
    majorCount: number;
    minorCount: number;
    highlightCount: number;
    /** 整体风险 */
    overallRisk: "high" | "medium" | "low";
    /** 综合结论 */
    conclusion: string;
  };
}

// ========== LLM 动态审核清单（两阶段：生成清单 → 用户确认 → 执行审查） ==========

/** 项目元信息（LLM 从采购文件抽取，用于报告抬头） */
export interface ProjectMeta {
  /** 项目名称 */
  projectName: string;
  /** 项目编号 */
  projectCode?: string;
  /** 采购人 */
  purchaser?: string;
  /** 代理机构 */
  agency?: string;
  /** 评标方法（如 综合评分法 100 分） */
  evalMethod?: string;
  /** 预算 / 最高限价（含★超预算说明） */
  budget?: string;
  /** 投标截止 / 开标时间 */
  bidDeadline?: string;
  /** ★实质性条款 / 废标关键点概要 */
  starClauses?: string[];
}

/** 审核要点：审核清单中的最小单位，对应该项目需要核查的一个具体点 */
export interface AuditCheckpoint {
  id: string;
  /** 所属九大维度 */
  dimension: IssueDimension;
  /** 要点名称（简洁，如"二线人员数量跨章节一致"） */
  name: string;
  /** 审查要求 / 判定标准（LLM 据此对投标文件作判定） */
  requirement: string;
  /** 招标文件依据条款（如"评分细则·人员配备12分""须知23.1"） */
  basis?: string;
  /** 预期风险等级，决定该要点命中问题后的默认分级 */
  riskLevel: "critical" | "major" | "minor";
  /** 是否启用审查（用户可勾选） */
  enabled: boolean;
}

/** LLM 动态审核清单 */
export interface AuditPlan {
  /** 项目元信息 */
  meta: ProjectMeta;
  /** 审核要点（九大维度） */
  checkpoints: AuditCheckpoint[];
  /** 生成时间戳 */
  generatedAt: number;
}

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
}

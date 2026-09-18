// 前端共享类型 - 双轨制审核

export type StatusType = "pass" | "warn" | "fail" | "none";

/** 审核模式 */
export type ReviewMode = "local" | "llm";

export interface ReviewItem {
  id: string;
  name: string;
  category: "qualification" | "commitment" | "technical";
  scope: "common" | "project" | "custom";
  keywords: string[];
  expectedText: string;
}

export interface ReviewItemSet {
  common: ReviewItem[];
  project: ReviewItem[];
  custom: ReviewItem[];
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

// ========== 本地审核结果 ==========
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

// ========== LLM 审核结果 ==========
export type RejectionSeverity = "critical" | "major" | "minor";

export interface RejectionItem {
  name: string;
  description: string;
  severity: RejectionSeverity;
  triggered: boolean;
  evidence: string;
  reason: string;
}

export interface BidderScore {
  bidder: string;
  score: number;
  reason: string;
  evidence: string;
}

export interface ScoringItem {
  name: string;
  maxScore: number;
  category: string;
  requirement: string;
  bidderScores: BidderScore[];
}

export interface LLMReviewResult {
  mode: "llm";
  bidders: string[];
  reviewItems: ReviewItem[];
  complianceTable: TableRow[];
  rejection: {
    items: RejectionItem[];
    byBidder: Record<string, RejectionItem[]>;
  };
  scoringItems: ScoringItem[];
  analysisLog: string[];
  evaluation: {
    score: number;
    risks: string[];
    conclusion: string;
    summary: string;
  };
}

/** 统一审核结果 */
export type UnifiedReviewResult = LocalReviewResult | LLMReviewResult;

// 兼容旧代码
export type ReviewResult = UnifiedReviewResult;

export interface ReviewConfig {
  items: string[];
  threshold: number;
  mode?: ReviewMode;
  llm?: {
    enabled: boolean;
    provider: string;
    apiKey: string;
    scope: string[];
  };
}

export interface UploadedBidderFile {
  type: "technical" | "commercial";
  file: File;
}

export interface BidderForm {
  id: number;
  name: string;
  technical: File | null;
  commercial: File | null;
}

// ========== 多维审核模块类型（F1-F10） ==========

/** 问题位置定位（F9） */
export interface IssueLocation {
  file: string;
  chapter?: string;
  page?: number;
  tableId?: string;
  tableRow?: number;
  snippet?: string;
}

/** 问题风险等级 */
export type RiskLevel = "critical" | "major" | "minor" | "info" | "highlight";

/** 审核维度 */
export type IssueDimension =
  | "qualification"
  | "substantive"
  | "consistency"
  | "structure"
  | "template"
  | "signature"
  | "textFlaw"
  | "highlight"
  | "completeness";

/** 审核问题统一结构 */
export interface Issue {
  id: string;
  dimension: IssueDimension;
  name: string;
  riskLevel: RiskLevel;
  location: IssueLocation;
  description: string;
  evidence?: string;
  basis?: string;
  remediation?: string;
  priority?: "P0" | "P1" | "P2";
}

/** 完整性对照项（F8） */
export interface CompletenessItem {
  formatId: string;
  formatName: string;
  fileName: string;
  status: "complete" | "partial" | "missing";
  remark?: string;
}

/** 整改清单 */
export interface RemediationPlan {
  p0: Issue[];
  p1: Issue[];
  p2: Issue[];
  manualCheck: string[];
}

/** 多维审核结果 */
export interface MultiDimReviewResult {
  mode: ReviewMode;
  bidders: string[];
  issues: Issue[];
  completeness: CompletenessItem[];
  highlights: Issue[];
  remediationPlan: RemediationPlan;
  summary: {
    criticalCount: number;
    majorCount: number;
    minorCount: number;
    highlightCount: number;
    overallRisk: "high" | "medium" | "low";
    conclusion: string;
  };
}

/** 多维审核配置 */
export interface MultiDimConfig {
  enabledDimensions?: IssueDimension[];
  mode?: ReviewMode;
}

// ========== LLM 动态审核清单（两阶段） ==========

/** 项目元信息 */
export interface ProjectMeta {
  projectName: string;
  projectCode?: string;
  purchaser?: string;
  agency?: string;
  evalMethod?: string;
  budget?: string;
  bidDeadline?: string;
  starClauses?: string[];
}

/** 审核要点 */
export interface AuditCheckpoint {
  id: string;
  dimension: IssueDimension;
  name: string;
  requirement: string;
  basis?: string;
  riskLevel: "critical" | "major" | "minor";
  enabled: boolean;
}

/** LLM 动态审核清单 */
export interface AuditPlan {
  meta: ProjectMeta;
  checkpoints: AuditCheckpoint[];
  generatedAt: number;
}

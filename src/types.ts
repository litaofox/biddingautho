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

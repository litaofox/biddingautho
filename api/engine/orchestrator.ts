// 多维审核调度器
// 聚合 F1-F8 八大审核维度的检测结果，统一生成 MultiDimReviewResult
// 与现有 runReview（符合性+废标+评分）并行工作，互不干扰
import type {
  Bidder,
  CompletenessItem,
  Issue,
  IssueDimension,
  MultiDimReviewResult,
  ReviewMode,
  UploadedFile,
} from "../types.js";
import { runConsistencyCheck } from "./consistency.js";
import { runStructureCheck } from "./structure.js";
import { runTemplateCheck } from "./template.js";
import { runSignatureCheck } from "./signature.js";
import { runTextFlawCheck } from "./textFlaw.js";
import { runHighlightCheck } from "./highlight.js";
import { runCompletenessCheck } from "./completeness.js";
import { buildRemediationPlan, ensureAllRemediation } from "./remediation.js";

export interface MultiDimConfig {
  /** 启用的维度（默认全开） */
  enabledDimensions?: IssueDimension[];
  /** 审核模式（默认 local） */
  mode?: ReviewMode;
}

/** 多维审核调度入口 */
export async function runMultiDimReview(
  bidders: Bidder[],
  procurement: UploadedFile,
  config?: MultiDimConfig
): Promise<MultiDimReviewResult> {
  const enabled = config?.enabledDimensions || [
    "consistency",
    "structure",
    "template",
    "signature",
    "textFlaw",
    "highlight",
    "completeness",
  ];
  const mode = config?.mode || "local";

  const allIssues: Issue[] = [];
  const allHighlights: Issue[] = [];
  let allCompleteness: CompletenessItem[] = [];
  const manualChecks: string[] = [];

  for (const bidder of bidders) {
    // F1 一致性核查
    if (enabled.includes("consistency")) {
      allIssues.push(...runConsistencyCheck({ bidder, procurement }));
    }
    // F2 结构规范性检测
    if (enabled.includes("structure")) {
      allIssues.push(...runStructureCheck(bidder));
    }
    // F3 模板残留检测
    if (enabled.includes("template")) {
      allIssues.push(...runTemplateCheck(bidder, procurement));
    }
    // F4 签字盖章完整性
    if (enabled.includes("signature")) {
      const sig = runSignatureCheck(bidder, procurement);
      allIssues.push(...sig.issues);
      manualChecks.push(...sig.manualChecks);
    }
    // F5 文本瑕疵检测
    if (enabled.includes("textFlaw")) {
      allIssues.push(...runTextFlawCheck(bidder));
    }
    // F6 合规亮点识别
    if (enabled.includes("highlight")) {
      const hl = runHighlightCheck(bidder, procurement);
      allHighlights.push(...hl);
    }
    // F8 完整性对照表（按投标人输出，取首个投标人的结果作为代表）
    if (enabled.includes("completeness") && allCompleteness.length === 0) {
      const comp = runCompletenessCheck(bidder, procurement);
      allIssues.push(...comp.issues);
      allCompleteness = comp.items;
    }
  }

  // 补充整改方案
  const issuesWithRemediation = ensureAllRemediation(allIssues);

  // 生成整改清单
  const remediationPlan = buildRemediationPlan(issuesWithRemediation);
  remediationPlan.manualCheck.push(...manualChecks);

  // 风险总览
  const criticalCount = issuesWithRemediation.filter((i) => i.riskLevel === "critical").length;
  const majorCount = issuesWithRemediation.filter((i) => i.riskLevel === "major").length;
  const minorCount = issuesWithRemediation.filter((i) => i.riskLevel === "minor").length;
  const highlightCount = allHighlights.length;

  const overallRisk =
    criticalCount > 0 ? "high" : majorCount >= 3 ? "medium" : "low";

  const conclusion = generateConclusion(criticalCount, majorCount, overallRisk);

  return {
    mode,
    bidders: bidders.map((b) => b.name),
    issues: issuesWithRemediation,
    completeness: allCompleteness,
    highlights: allHighlights,
    remediationPlan,
    summary: {
      criticalCount,
      majorCount,
      minorCount,
      highlightCount,
      overallRisk,
      conclusion,
    },
  };
}

/** 生成综合结论 */
function generateConclusion(
  criticalCount: number,
  majorCount: number,
  overallRisk: "high" | "medium" | "low"
): string {
  if (criticalCount > 0) {
    return `存在 ${criticalCount} 项准高危风险，需限期整改后递交（无直接废标项，但含高危风险）`;
  }
  if (overallRisk === "medium") {
    return `存在 ${majorCount} 项扣分问题，建议整改后递交`;
  }
  return "无高危风险，仅有少量细节瑕疵，可递交";
}

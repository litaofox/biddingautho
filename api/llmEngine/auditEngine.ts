// LLM 全方位审核编排器（两阶段）
// 阶段一 generateAuditPlan：采购文件+需求 → 动态审核清单（前端用户确认）
// 阶段二 runLlmAudit：确认后的清单 + 投标文件 → 逐维度 LLM 审查 → MultiDimReviewResult
// 输出结构与本地多维审核（engine/orchestrator.ts）完全一致，复用同一前端与报告模板
import type {
  AuditCheckpoint,
  AuditPlan,
  Bidder,
  CompletenessItem,
  Issue,
  IssueDimension,
  MultiDimReviewResult,
  ProjectMeta,
  Task,
} from "../types.js";
import type { LLMAugmenter } from "../llm/index.js";
import { buildRemediationPlan, ensureAllRemediation } from "../engine/remediation.js";

/** 九大维度的审查与展示顺序 */
const DIM_ORDER: IssueDimension[] = [
  "qualification",
  "substantive",
  "consistency",
  "structure",
  "template",
  "signature",
  "textFlaw",
  "completeness",
  "highlight",
];

/**
 * 阶段一：生成动态审核清单
 */
export async function generateAuditPlan(
  augmenter: LLMAugmenter,
  task: Task
): Promise<AuditPlan> {
  if (!task.procurement) {
    throw new Error("缺少采购文件，无法生成审核清单");
  }
  const plan = await augmenter.generateAuditPlan(
    task.procurement.text,
    task.projectRequirements?.text
  );
  if (!plan) {
    throw new Error("审核清单生成失败：大模型未返回有效结果，请检查模型配置或稍后重试");
  }
  return plan;
}

/**
 * 阶段二：依据用户确认的审核清单，对投标文件执行 LLM 全方位审查
 */
export async function runLlmAudit(
  augmenter: LLMAugmenter,
  task: Task
): Promise<MultiDimReviewResult> {
  const plan = task.auditPlan;
  if (!plan) {
    throw new Error("尚未生成并确认审核清单");
  }

  const enabledCheckpoints = plan.checkpoints.filter((c) => c.enabled);
  if (enabledCheckpoints.length === 0) {
    throw new Error("审核清单中没有启用的审查要点，请至少勾选一项");
  }
  if (task.bidders.length === 0) {
    throw new Error("没有投标文件可供审查");
  }

  // 按维度分组（保持固定顺序）
  const byDimension = new Map<IssueDimension, AuditCheckpoint[]>();
  for (const cp of enabledCheckpoints) {
    const list = byDimension.get(cp.dimension);
    if (list) {
      list.push(cp);
    } else {
      byDimension.set(cp.dimension, [cp]);
    }
  }
  const activeDims = DIM_ORDER.filter((d) => byDimension.has(d));

  const issues: Issue[] = [];
  const highlights: Issue[] = [];
  let completeness: CompletenessItem[] = [];
  const manualChecks: string[] = [];

  for (const bidder of task.bidders) {
    const bidText = mergeBidderText(bidder);

    // 逐维度证据检索 + 判定
    for (const dim of activeDims) {
      const cps = byDimension.get(dim)!;
      console.log(`[LLM审核] ${bidder.name} / 维度 ${dim} / ${cps.length} 个要点`);
      const found = await augmenter.auditDimensionBatch(dim, cps, bidText);
      if (dim === "highlight") {
        highlights.push(...found);
      } else {
        issues.push(...found);
      }
    }

    // 完整性对照表 + 待人工核验（取首个有结果的投标人）
    if (completeness.length === 0) {
      const r = await augmenter.auditCompleteness(bidText);
      completeness = r.completeness;
      manualChecks.push(...r.manualCheck);
    }
  }

  // 补全整改方案 + 构建 P0/P1/P2 整改清单（复用本地规则）
  const issuesWithRemediation = ensureAllRemediation(issues);
  const remediationPlan = buildRemediationPlan(issuesWithRemediation);
  remediationPlan.manualCheck = Array.from(
    new Set([...remediationPlan.manualCheck, ...manualChecks])
  );

  // 风险总览
  const criticalCount = issuesWithRemediation.filter((i) => i.riskLevel === "critical").length;
  const majorCount = issuesWithRemediation.filter((i) => i.riskLevel === "major").length;
  const minorCount = issuesWithRemediation.filter((i) => i.riskLevel === "minor").length;
  const highlightCount = highlights.length;
  const overallRisk: "high" | "medium" | "low" =
    criticalCount > 0 ? "high" : majorCount >= 3 ? "medium" : "low";
  const conclusion = generateConclusion(
    plan.meta,
    criticalCount,
    majorCount,
    minorCount,
    highlightCount,
    overallRisk
  );

  return {
    mode: "llm",
    bidders: task.bidders.map((b) => b.name),
    issues: issuesWithRemediation,
    completeness,
    highlights,
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

/** 合并某投标人的商务+技术文件全文，加分隔标记辅助 LLM 判定位置来源 */
function mergeBidderText(bidder: Bidder): string {
  const sorted = bidder.files.slice().sort((a, b) => {
    const rank = (t: string) => (t === "commercial" ? 0 : 1);
    return rank(a.type) - rank(b.type);
  });
  return sorted
    .map((f) => {
      const label = f.type === "commercial" ? "商务文件" : "技术文件";
      return `===== 【${label}】${f.name} =====\n${f.text || ""}`;
    })
    .join("\n\n");
}

/** 依据计数与风险等级生成综合结论 */
function generateConclusion(
  meta: ProjectMeta,
  criticalCount: number,
  majorCount: number,
  minorCount: number,
  highlightCount: number,
  overallRisk: "high" | "medium" | "low"
): string {
  const prefix = meta.projectName ? `《${meta.projectName}》` : "本项目";
  const tail = highlightCount > 0 ? `，并识别出 ${highlightCount} 项合规亮点` : "";
  if (criticalCount > 0) {
    return `${prefix}审核发现 ${criticalCount} 项准高危/废标风险、${majorCount} 项扣分问题、${minorCount} 项细节瑕疵${tail}。存在一票否决或重大数据矛盾风险，须完成全部 P0 整改后方可递交。`;
  }
  if (overallRisk === "medium") {
    return `${prefix}审核未发现直接废标项，但存在 ${majorCount} 项扣分问题、${minorCount} 项细节瑕疵${tail}。建议完成 P1 及以上整改后递交。`;
  }
  return `${prefix}审核未发现高危及实质性扣分问题，仅 ${minorCount} 项细节瑕疵${tail}，整体风险低，可递交。`;
}

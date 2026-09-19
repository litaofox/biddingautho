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
  ScoringIndexEntry,
  Task,
} from "../types.js";
import type { LLMAugmenter } from "../llm/index.js";
import { buildRemediationPlan, ensureAllRemediation } from "../engine/remediation.js";
import { guardIssueFacts } from "./factGuard.js";
import { enforceRejectionRules, mergeDuplicateIssues } from "./criticalRules.js";
import { buildFormatDigest } from "./procurementDigest.js";

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
 * @param onProgress 进度回调（percent 30-100，由调用方在阶段一前后自行设置 0-30）
 */
export async function runLlmAudit(
  augmenter: LLMAugmenter,
  task: Task,
  onProgress?: (percent: number, stage: string, message: string) => void
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

  const DIM_LABEL: Record<IssueDimension, string> = {
    qualification: "资格合规性",
    substantive: "实质性条款",
    consistency: "数据一致性",
    structure: "结构规范性",
    template: "模板残留",
    signature: "签字盖章",
    textFlaw: "文本瑕疵",
    completeness: "完整性对照",
    highlight: "合规亮点",
  };

  // 采购文件中的格式清单（章节感知抽取，完整性对照以采购文件为准）
  const formatDigest = task.procurement
    ? buildFormatDigest(task.procurement.text, 8000)
    : "";

  // 从评分办法抽取结构化评分项（审核开始前抽取一次，所有投标人共用）
  // 用户可在第一步取消勾选"模拟打分"（task.auditLlmConfig.simulateScoring，默认启用）
  const simulateScoring = task.auditLlmConfig?.simulateScoring !== false;
  let scoringIndex: ScoringIndexEntry[] = [];
  if (simulateScoring) {
    onProgress?.(30, "scoreplan", "正在解析招标文件评分标准，构建评分索引");
    if (task.procurement) {
      try {
        const { items: scoreItems } = await augmenter.extractScoringItems(
          task.procurement.text,
          task.projectRequirements?.text
        );
        scoringIndex = scoreItems.map((it) => ({ ...it }));
        console.log(`[LLM审核] 评分项抽取完成，共 ${scoringIndex.length} 项`);
        if (scoringIndex.length === 0) {
          manualChecks.push(
            "未能自动抽取到结构化评分项，未能进行逐项打分；请人工核查招标文件中的评分办法/评标标准章节（通常位于评标办法章，如“评分标准/评分细则/评审因素及分值”页），按原文分值表逐项评估投标文件"
          );
        }
      } catch (err) {
        console.warn("[LLM审核] 评分项抽取失败（不影响合规审查）", err instanceof Error ? err.message : err);
        manualChecks.push("评分项自动抽取异常，未能进行逐项打分，请人工核查招标文件评分办法章节后补评");
      }
    }
  } else {
    console.log("[LLM审核] 用户未启用模拟打分，跳过评分索引与逐项打分");
  }

  const totalUnits = task.bidders.length * activeDims.length;
  let doneUnits = 0;
  let bidderSeq = 0;
  let estimatedScore: number | undefined;
  let estimatedFullScore: number | undefined;

  for (const bidder of task.bidders) {
    bidderSeq++;
    const bidText = mergeBidderText(bidder);
    const bidderIssues: Issue[] = [];
    const bidderHighlights: Issue[] = [];

    // 逐维度证据检索 + 判定（进度 32% ~ 66%）
    for (const dim of activeDims) {
      const cps = byDimension.get(dim)!;
      const pct = 32 + Math.round((doneUnits / Math.max(1, totalUnits)) * 34);
      onProgress?.(
        pct,
        `dim_${dim}`,
        `正在审查「${DIM_LABEL[dim]}」（${bidder.name}，${cps.length} 个要点）`
      );
      console.log(`[LLM审核] ${bidder.name} / 维度 ${dim} / ${cps.length} 个要点`);
      const found = await augmenter.auditDimensionBatch(dim, cps, bidText, plan.meta);
      if (dim === "highlight") {
        bidderHighlights.push(...found);
      } else {
        bidderIssues.push(...found);
      }
      doneUnits++;
    }

    // 采购要求逐条覆盖比对（服务承诺等漏检治理，进度 68% ~ 78%）
    const requirements = plan.requirements || [];
    if (requirements.length > 0) {
      onProgress?.(
        70,
        "requirements",
        `正在逐条比对采购要求响应情况（${bidder.name}，${requirements.length} 条要求）`
      );
      console.log(`[LLM审核] ${bidder.name} / 采购要求覆盖比对 ${requirements.length} 条`);
      const coverageIssues = await augmenter.auditRequirementsCoverage(
        requirements,
        bidText,
        plan.meta
      );
      bidderIssues.push(...coverageIssues);
    }

    // 事实校验：日期断言、证据原文复核（拦截"当前年份应为2024/2025"类幻觉）
    const guarded = guardIssueFacts(bidderIssues, {
      today: new Date(),
      deadlineText: plan.meta.bidDeadline,
      bidText,
    });
    if (guarded.disputedMessages.length > 0) {
      console.warn(`[事实校验] ${bidder.name} 标记 ${guarded.disputedMessages.length} 条可疑断言`);
      manualChecks.push(...guarded.disputedMessages);
    }

    // 废标红线强制升级（如多处报价/金额不一致，无论模型定级如何一律 critical）
    const ruled = enforceRejectionRules(guarded.issues);
    if (ruled.escalated.length > 0) {
      console.warn(`[红线规则] ${bidder.name} 强制升级 ${ruled.escalated.length} 项为准高危`);
      manualChecks.push(...ruled.escalated);
    }
    issues.push(...ruled.issues);
    highlights.push(...bidderHighlights);

    // 逐项评分（首个投标人产出评分索引，进度 80% ~ 88%）
    if (bidderSeq === 1 && scoringIndex.length > 0) {
      onProgress?.(
        82,
        "scoring",
        `正在依据评分标准逐项打分（${bidder.name}，${scoringIndex.length} 个评分项）`
      );
      console.log(`[LLM审核] ${bidder.name} / 逐项打分 ${scoringIndex.length} 项`);
      const assessments = await augmenter.scoreBidItems(
        scoringIndex.map((e) => ({
          id: e.id,
          code: e.code,
          name: e.name,
          category: e.category,
          description: e.description,
          fullScore: e.fullScore,
          weight: e.weight,
          rules: e.rules,
          sourceClause: e.sourceClause,
        })),
        bidText,
        plan.meta
      );
      const assessMap = new Map(assessments.map((a) => [a.itemId, a]));
      scoringIndex.forEach((entry) => {
        const a = assessMap.get(entry.id);
        if (a) entry.assessment = a;
      });
      const assessed = scoringIndex.filter((e) => e.assessment);
      if (assessed.length > 0) {
        estimatedFullScore = scoringIndex.reduce((s, e) => s + e.fullScore, 0);
        estimatedScore = Math.round(assessed.reduce((s, e) => s + (e.assessment?.score || 0), 0) * 10) / 10;
      }
    }

    // 完整性对照表 + 待人工核验（取首个有结果的投标人）
    if (completeness.length === 0) {
      onProgress?.(90, "completeness", "正在进行投标文件完整性对照与人工核验项梳理");
      const r = await augmenter.auditCompleteness(bidText, formatDigest, plan.meta);
      completeness = r.completeness;
      manualChecks.push(...r.manualCheck);
    }
  }

  // 跨环节近似问题去重（同一缺陷可能被维度审查与要求覆盖比对各报一次，合并取最高级别）
  const dedupedIssues = mergeDuplicateIssues(issues);
  const removedCount = issues.length - dedupedIssues.length;
  if (removedCount > 0) console.log(`[LLM审核] 合并重复问题 ${removedCount} 条`);

  // 补全整改方案 + 构建 P0/P1/P2 整改清单（复用本地规则）
  onProgress?.(93, "remediation", "正在生成整改清单与风险结论");
  const issuesWithRemediation = ensureAllRemediation(dedupedIssues);
  const remediationPlan = buildRemediationPlan(issuesWithRemediation);
  // 人工核查提示去重：先精确去重，再按"剥离问题名称后的核心表述"近似去重
  const allManualChecks = Array.from(new Set([...remediationPlan.manualCheck, ...manualChecks]));
  const seenKeys = new Set<string>();
  remediationPlan.manualCheck = allManualChecks.filter((msg) => {
    const key = msg.replace(/「[^」]*」/g, "「」").replace(/\s+/g, "").slice(0, 60);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

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
    scoringIndex: scoringIndex.length > 0 ? scoringIndex : undefined,
    summary: {
      criticalCount,
      majorCount,
      minorCount,
      highlightCount,
      overallRisk,
      conclusion,
      estimatedScore,
      estimatedFullScore,
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

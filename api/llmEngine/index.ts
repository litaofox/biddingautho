// LLM 审核引擎 - 独立的全流程 AI 审核模块
// 与本地规则引擎完全独立，可单独运行
import type {
  Bidder,
  ReviewItem,
  RejectionItem,
  ScoringItem,
  TableRow,
  CellData,
  LLMReviewResult,
} from "../types.js";
import { LLMAugmenter, type LLMConfig } from "../llm/index.js";

/**
 * 执行 LLM 全流程审核
 * 1. 智能梳理审查项/废标项/评分项
 * 2. 逐投标人符合性判定
 * 3. 逐投标人废标项判定
 * 4. 逐投标人评分项打分
 * 5. 生成综合评价
 */
export async function runLLMReview(
  bidders: Bidder[],
  procurementText: string,
  projectReqText: string | undefined,
  llmConfig: LLMConfig
): Promise<LLMReviewResult> {
  const augmenter = new LLMAugmenter(llmConfig);
  const analysisLog: string[] = [];
  const log = (msg: string) => {
    const ts = new Date().toLocaleTimeString("zh-CN");
    analysisLog.push(`[${ts}] ${msg}`);
  };

  log(`LLM 审核启动，投标人 ${bidders.length} 家，服务商：${llmConfig.provider}`);

  // ========== 步骤1：智能梳理审查维度 ==========
  log("步骤1/5：从采购文件智能梳理审查项、废标项、评分项...");
  const { reviewItems, rejectionItems, scoringItems } =
    await augmenter.extractReviewDimensions(procurementText, projectReqText);
  log(`  提取完成：审查项 ${reviewItems.length} 项，废标项 ${rejectionItems.length} 项，评分项 ${scoringItems.length} 项`);

  if (reviewItems.length === 0 && rejectionItems.length === 0 && scoringItems.length === 0) {
    log("警告：未提取到任何审查维度，LLM 审核结果为空");
    return emptyLLMResult(bidders, analysisLog);
  }

  // ========== 步骤2：逐投标人符合性判定 ==========
  log("步骤2/5：逐投标人符合性判定...");
  const complianceTable: TableRow[] = reviewItems.map((item) => ({
    item: item.name,
    category: mapCategory(item.category),
    expectedText: item.expectedText,
    cells: bidders.map(() => emptyCell()),
  }));

  for (let i = 0; i < bidders.length; i++) {
    const bidder = bidders[i];
    const bidText = mergeBidderText(bidder);
    log(`  判定【${bidder.name}】符合性（${reviewItems.length} 项）...`);

    const judgments = await augmenter.judgeCompliance(reviewItems, bidText);

    for (let j = 0; j < reviewItems.length; j++) {
      const judgment = judgments[j] || { name: "", score: 0, status: "none", evidence: "", deviation: "" };
      complianceTable[j].cells[i] = {
        status: judgment.status as CellData["status"],
        score: judgment.score,
        evidence: judgment.evidence,
        deviation: judgment.deviation,
      };
    }
  }
  log("  符合性判定完成");

  // ========== 步骤3：逐投标人废标项判定 ==========
  log("步骤3/5：逐投标人废标项判定...");
  const rejectionByBidder: Record<string, RejectionItem[]> = {};

  for (const bidder of bidders) {
    const bidText = mergeBidderText(bidder);
    log(`  判定【${bidder.name}】废标项（${rejectionItems.length} 项）...`);

    const judgments = await augmenter.judgeRejection(rejectionItems, bidText);
    const bidderRejections: RejectionItem[] = rejectionItems.map((item, idx) => {
      const j = judgments[idx] || { name: item.name, triggered: false, evidence: "", reason: "" };
      return {
        ...item,
        triggered: j.triggered,
        evidence: j.evidence,
        reason: j.reason,
      };
    });
    rejectionByBidder[bidder.name] = bidderRejections;

    const triggered = bidderRejections.filter((r) => r.triggered);
    log(`  【${bidder.name}】触发废标项 ${triggered.length} 项`);
  }

  // ========== 步骤4：逐投标人评分项打分 ==========
  log("步骤4/5：逐投标人评分项模拟打分...");
  const filledScoringItems: ScoringItem[] = scoringItems.map((item) => ({ ...item, bidderScores: [] }));

  for (const bidder of bidders) {
    const bidText = mergeBidderText(bidder);
    log(`  打分【${bidder.name}】（${scoringItems.length} 项）...`);

    const scores = await augmenter.judgeScoring(scoringItems, bidText);
    for (let j = 0; j < scoringItems.length; j++) {
      const s = scores[j] || { name: scoringItems[j].name, score: 0, reason: "", evidence: "" };
      filledScoringItems[j].bidderScores.push({
        bidder: bidder.name,
        score: Math.min(s.score, scoringItems[j].maxScore),
        reason: s.reason,
        evidence: s.evidence,
      });
    }
  }
  log("  评分完成");

  // ========== 步骤5：综合评价 ==========
  log("步骤5/5：生成综合评价...");
  const evalSummary = buildEvaluationSummary(bidders, complianceTable, rejectionByBidder, filledScoringItems);
  const evaluation = await augmenter.evaluateLLMReview(evalSummary);
  log(`  综合评分：${evaluation.score}，结论：${evaluation.conclusion}`);
  log("LLM 审核完成");

  return {
    mode: "llm",
    bidders: bidders.map((b) => b.name),
    reviewItems,
    complianceTable,
    rejection: {
      items: rejectionItems,
      byBidder: rejectionByBidder,
    },
    scoringItems: filledScoringItems,
    analysisLog,
    evaluation: {
      score: evaluation.score,
      risks: evaluation.risks,
      conclusion: evaluation.conclusion,
      summary: evaluation.summary,
    },
  };
}

/** 合并投标人所有文件文本 */
function mergeBidderText(bidder: Bidder): string {
  return bidder.files.map((f) => f.text).join("\n\n");
}

function emptyCell(): CellData {
  return { status: "none", score: 0, evidence: "", deviation: "" };
}

function mapCategory(cat: string): string {
  const map: Record<string, string> = {
    qualification: "报名资格",
    commitment: "承诺条款",
    technical: "技术偏离",
  };
  return map[cat] || cat;
}

/** 空结果（提取失败时返回） */
function emptyLLMResult(bidders: Bidder[], analysisLog: string[]): LLMReviewResult {
  return {
    mode: "llm",
    bidders: bidders.map((b) => b.name),
    reviewItems: [],
    complianceTable: [],
    rejection: { items: [], byBidder: {} },
    scoringItems: [],
    analysisLog,
    evaluation: { score: 0, risks: ["LLM 未能提取到审查维度，请检查采购文件内容"], conclusion: "不推荐", summary: "" },
  };
}

/** 构建综合评价的摘要文本 */
function buildEvaluationSummary(
  bidders: Bidder[],
  table: TableRow[],
  rejectionByBidder: Record<string, RejectionItem[]>,
  scoringItems: ScoringItem[]
): string {
  const lines: string[] = [];

  lines.push(`投标人：${bidders.map((b) => b.name).join("、")}`);

  // 符合性概览
  lines.push("\n【符合性审查概览】");
  for (const bidder of bidders) {
    const idx = bidders.indexOf(bidder);
    const cells = table.map((row) => row.cells[idx]);
    const pass = cells.filter((c) => c.status === "pass").length;
    const warn = cells.filter((c) => c.status === "warn").length;
    const fail = cells.filter((c) => c.status === "fail").length;
    const none = cells.filter((c) => c.status === "none").length;
    lines.push(`- ${bidder.name}：符合${pass}项，偏离${warn}项，不符合${fail}项，未响应${none}项`);
  }

  // 废标概览
  lines.push("\n【废标项判定概览】");
  for (const bidder of bidders) {
    const rejections = rejectionByBidder[bidder.name] || [];
    const triggered = rejections.filter((r) => r.triggered);
    if (triggered.length > 0) {
      lines.push(`- ${bidder.name}：触发废标项 ${triggered.length} 项 - ${triggered.map((t) => t.name).join("、")}`);
    } else {
      lines.push(`- ${bidder.name}：未触发废标项`);
    }
  }

  // 评分概览
  if (scoringItems.length > 0) {
    lines.push("\n【评分概览】");
    for (const bidder of bidders) {
      const total = scoringItems.reduce((sum, item) => {
        const bs = item.bidderScores.find((s) => s.bidder === bidder.name);
        return sum + (bs?.score || 0);
      }, 0);
      const maxTotal = scoringItems.reduce((sum, item) => sum + item.maxScore, 0);
      lines.push(`- ${bidder.name}：得分 ${total} / ${maxTotal}`);
    }
  }

  return lines.join("\n");
}

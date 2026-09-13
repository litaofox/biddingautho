// 审查引擎主入口 - 双轨制调度器
// 本地审核（规则引擎）与 LLM 审核（AI引擎）完全独立，可单独运行
import type {
  Bidder,
  ReviewConfig,
  ReviewItem,
  LocalReviewResult,
  LLMReviewResult,
  UnifiedReviewResult,
} from "../types.js";
import { getRulesByIds } from "./rules.js";
import { matchReviewItem } from "./matcher.js";
import { buildLLMConfig, LLMAugmenter, type LLMConfig } from "../llm/index.js";
import { runLLMReview } from "../llmEngine/index.js";

/**
 * 统一审核入口：根据 config.mode 调度到本地审核或 LLM 审核
 */
export async function runReview(
  bidders: Bidder[],
  config: ReviewConfig,
  allRules?: ReviewItem[]
): Promise<UnifiedReviewResult> {
  const mode = config.mode || "local";
  if (mode === "llm") {
    return runLLMReviewDispatcher(bidders, config, allRules);
  }
  return runLocalReview(bidders, config, allRules);
}

/**
 * 本地审核模块：完全基于规则引擎，不依赖任何外部 API
 * 算法与重构前保持一致，保障业务连续性
 */
export async function runLocalReview(
  bidders: Bidder[],
  config: ReviewConfig,
  allRules?: ReviewItem[]
): Promise<LocalReviewResult> {
  const threshold = config.threshold || 75;
  const rules = getRulesByIds(config.items || [], allRules);

  // 生成符合性表格（规则引擎）
  let complianceTable = rules.map((rule) => ({
    item: rule.name,
    category: mapCategory(rule.category),
    expectedText: rule.expectedText,
    cells: bidders.map((bidder) => matchReviewItem(bidder, rule, threshold)),
  }));

  // LLM 增强（可选，仅在本地模式下用户主动启用时）
  const llmConfig = buildLLMConfig(config);
  let llmEnhanced = false;

  if (llmConfig) {
    const augmenter = new LLMAugmenter(llmConfig);
    llmEnhanced = true;

    // 语义比对增强：对每个单元格重新评估
    if (augmenter.has("semanticMatch")) {
      for (const row of complianceTable) {
        for (let i = 0; i < row.cells.length; i++) {
          const cell = row.cells[i];
          // 仅对有响应内容的进行 LLM 增强
          if (cell.evidence && cell.status !== "none") {
            const llmResult = await augmenter.semanticMatch(
              row.expectedText,
              cell.evidence
            );
            if (llmResult.score >= 0) {
              cell.score = llmResult.score;
              cell.status = determineStatus(llmResult.score, threshold);
              if (llmResult.deviation) {
                cell.deviation = llmResult.deviation;
              }
            }
          }
        }
      }
    }
  }

  // 生成专业评价
  const evaluation = generateEvaluation(bidders, complianceTable, threshold);

  return {
    mode: "local",
    bidders: bidders.map((b) => b.name),
    complianceTable,
    evaluation,
    llmEnhanced,
  };
}

/**
 * LLM 审核调度：从任务中获取采购文本并调用独立 LLM 引擎
 * 注意：此函数需要采购文件文本，由路由层传入
 */
async function runLLMReviewDispatcher(
  bidders: Bidder[],
  config: ReviewConfig,
  allRules?: ReviewItem[]
): Promise<LLMReviewResult> {
  // LLM 模式下，需要从 config 或外部获取采购文本
  // 这里通过一个约定：config 中附带 procurementText（由路由层注入）
  const procurementText = (config as any).procurementText || "";
  const projectReqText = (config as any).projectReqText || undefined;

  const llmConfig: LLMConfig = {
    enabled: true,
    provider: (config.llm?.provider as LLMConfig["provider"]) || "local",
    apiKey: config.llm?.apiKey || "",
    scope: config.llm?.scope || ["clauseExtract", "semanticMatch", "deviation", "evaluation"],
  };

  return runLLMReview(bidders, procurementText, projectReqText, llmConfig);
}

/**
 * 根据得分判定状态
 */
function determineStatus(score: number, threshold: number): "pass" | "warn" | "fail" | "none" {
  if (score === 0) return "none";
  if (score >= threshold) return "pass";
  if (score >= threshold * 0.5) return "warn";
  return "fail";
}

/**
 * 类别名称映射
 */
function mapCategory(cat: string): string {
  const map: Record<string, string> = {
    qualification: "报名资格",
    commitment: "承诺条款",
    technical: "技术偏离",
  };
  return map[cat] || cat;
}

/**
 * 生成专业评价
 */
function generateEvaluation(
  bidders: Bidder[],
  table: { cells: { status: string; score: number }[] }[],
  threshold: number
): { score: number; risks: string[]; conclusion: string } {
  const risks: string[] = [];
  const bidderScores: number[] = [];

  for (let i = 0; i < bidders.length; i++) {
    const cells = table.map((row) => row.cells[i]);
    const avgScore = cells.reduce((sum, c) => sum + c.score, 0) / cells.length;
    bidderScores.push(avgScore);

    cells.forEach((cell, idx) => {
      if (cell.status === "fail") {
        risks.push(`${bidders[i].name}：未通过"${table[idx] && (table[idx] as any).item}"审查`);
      } else if (cell.status === "none") {
        risks.push(`${bidders[i].name}：未响应"${table[idx] && (table[idx] as any).item}"`);
      } else if (cell.status === "warn") {
        risks.push(`${bidders[i].name}："${table[idx] && (table[idx] as any).item}"存在偏离，需复核`);
      }
    });
  }

  const overallScore = Math.round(
    bidderScores.reduce((a, b) => a + b, 0) / bidderScores.length
  );

  const failCount = table
    .flatMap((row) => row.cells)
    .filter((c) => c.status === "fail" || c.status === "none").length;
  const totalCells = table.length * bidders.length;
  const failRate = failCount / totalCells;

  let conclusion: string;
  if (failRate === 0) {
    conclusion = "推荐";
  } else if (failRate < 0.15) {
    conclusion = "有条件推荐";
  } else {
    conclusion = "不推荐";
  }

  return {
    score: overallScore,
    risks: risks.slice(0, 10),
    conclusion,
  };
}

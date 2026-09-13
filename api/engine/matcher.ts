// 检索比对算法模块
import type { ReviewItem, Bidder, CellData, StatusType } from "../types.js";
import { synonymMap } from "./rules.js";

/**
 * 在投标文件全文中检索审查项的匹配情况
 * @param bidder 投标公司（含技术标+商务标文本）
 * @param rule 审查项规则
 * @param threshold 匹配阈值 0-100
 */
export function matchReviewItem(
  bidder: Bidder,
  rule: ReviewItem,
  threshold: number
): CellData {
  // 合并技术标和商务标全文
  const fullText = bidder.files
    .map((f) => f.text)
    .join("\n")
    .toLowerCase();

  if (!fullText) {
    return {
      status: "none",
      score: 0,
      evidence: "未找到投标文件内容",
      deviation: "投标文件为空",
    };
  }

  // 收集所有匹配词（含同义词）
  const allKeywords = rule.keywords.flatMap((kw) => {
    const synonyms = synonymMap[kw] || [];
    return [kw, ...synonyms];
  });

  // 统计命中次数
  let hitCount = 0;
  const hitKeywords: string[] = [];
  for (const kw of allKeywords) {
    if (fullText.includes(kw.toLowerCase())) {
      hitCount++;
      hitKeywords.push(kw);
    }
  }

  // 计算匹配得分（命中率 × 100）
  const score = Math.round((hitCount / allKeywords.length) * 100);

  // 提取证据片段（取第一个命中关键词的上下文）
  let evidence = "";
  if (hitKeywords.length > 0) {
    evidence = extractEvidence(fullText, hitKeywords[0]);
  }

  // 判定状态
  const status = determineStatus(score, threshold, rule, fullText);

  // 偏离说明
  const deviation = generateDeviation(status, rule, evidence);

  return {
    status,
    score,
    evidence,
    deviation,
  };
}

/**
 * 提取关键词附近的上下文作为证据
 */
function extractEvidence(text: string, keyword: string): string {
  const idx = text.indexOf(keyword.toLowerCase());
  if (idx === -1) return "";
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + keyword.length + 50);
  let snippet = text.slice(start, end).trim();
  // 清理多余空白
  snippet = snippet.replace(/\s+/g, " ");
  return snippet.length > 80 ? snippet.slice(0, 80) + "..." : snippet;
}

/**
 * 根据得分和阈值判定符合性状态
 */
function determineStatus(
  score: number,
  threshold: number,
  rule: ReviewItem,
  text: string
): StatusType {
  if (score === 0) return "none";

  // 检查是否有明确的负偏离表述
  const negativePatterns = [
    /不满足|不符合|无法满足|不能满足/,
    /负偏离|存在偏离|有偏离/,
  ];
  const hasNegative = negativePatterns.some((p) => p.test(text));

  if (score >= threshold) {
    return hasNegative ? "warn" : "pass";
  }

  if (score >= threshold * 0.5) {
    return "warn";
  }

  return "fail";
}

/**
 * 生成偏离说明
 */
function generateDeviation(
  status: StatusType,
  rule: ReviewItem,
  evidence: string
): string {
  switch (status) {
    case "pass":
      return "";
    case "warn":
      return `部分响应"${rule.name}"要求，可能存在偏离，建议人工复核`;
    case "fail":
      return `未充分响应"${rule.name}"要求`;
    case "none":
      return `未找到"${rule.name}"相关内容`;
  }
}

// 审核后置硬性规则层（不依赖 LLM 自觉，对所有项目通用，不含任何项目特定内容）
// 1. enforceRejectionRules：法定/招标文件通行的废标红线，无论模型定成什么级别，强制升级为 critical
// 2. mergeDuplicateIssues：同一缺陷被不同环节重复报告时合并，保留最高级别与最完整表述
import type { Issue, RiskLevel } from "../types.js";
import { isPriceConsistencyIssue } from "./factGuard.js";

const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  info: 1,
  highlight: 0,
};

/** 去除 factGuard 降级前缀（红线升级回 critical 时，"已降级"表述不再适用） */
function stripGuardPrefix(desc: string): string {
  return desc
    .replace(/【系统事实校验[：:][^】]*】/g, "")
    .trim();
}

/** 提取大写金额链/阿拉伯金额等强特征 token（用于判断两条问题是否指向同一缺陷） */
function extractMoneyTokens(text: string): Set<string> {
  const set = new Set<string>();
  const cnRe = /[壹贰叁肆伍陆柒捌玖拾佰仟万亿零]{3,}[元圆角分]?整?/g;
  let m: RegExpExecArray | null;
  while ((m = cnRe.exec(text)) !== null) set.add(m[0]);
  const numRe = /\d[\d,]{3,}(?:\.\d+)?/g;
  while ((m = numRe.exec(text)) !== null) set.add(m[0]);
  return set;
}

/**
 * 废标红线规则（通用规则，依据政府采购通行规定与招标文件通用否决条款模式）：
 * R1 报价一致性：投标函/投标书/开标一览表/报价明细表之间报价不一致
 *    （大写错漏字、大小写不符、总价≠单价合计、一处一价）—— 实质性响应缺陷，强制 critical。
 * 返回升级信息用于人工核验提示。
 */
export function enforceRejectionRules(
  issues: Issue[]
): { issues: Issue[]; escalated: string[] } {
  const escalated: string[] = [];
  const next = issues.map((issue) => {
    if (issue.riskLevel === "highlight") return issue;
    const text = `${issue.name} ${issue.description} ${issue.evidence || ""}`;

    const priceRed = isPriceConsistencyIssue(text);
    if (priceRed && issue.riskLevel !== "critical") {
      const cleaned: Issue = {
        ...issue,
        riskLevel: "critical",
        description:
          stripGuardPrefix(issue.description) +
          "（系统按废标红线规则强制定级：投标文件各报价表/投标函之间报价不一致属实质性响应缺陷，以招标文件规定及评标委员会认定为准）",
      };
      escalated.push(
        `「${issue.name}」涉及报价金额不一致，系统已按废标红线强制升级为废标项，请优先核对各报价表原件`
      );
      return { ...cleaned, rejection: true };
    }

    // 废标定性：报价红线问题，或 critical 且名称/描述/依据明确指向否决条款（废标/否决/无效投标）
    const clauseText = `${issue.name} ${issue.description} ${issue.basis || ""}`;
    if (priceRed || (issue.riskLevel === "critical" && /废标|否决|无效投标|投标无效/.test(clauseText))) {
      return { ...issue, rejection: true };
    }
    return issue;
  });
  return { issues: next, escalated };
}

/** 归一化标题用于相似比较（去标点、去括号说明、去常见前缀） */
function normalizeTitle(s: string): string {
  return (s || "")
    .replace(/【[^】]*】/g, "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
}

/** 最长公共子串长度 */
function lcsLen(a: string, b: string): number {
  if (!a || !b) return 0;
  const dp = new Array(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
        if (dp[j] > best) best = dp[j];
      } else {
        dp[j] = 0;
      }
      prev = tmp;
    }
  }
  return best;
}

/** 判断两条问题是否指向同一缺陷：共享金额 token 且标题高度相似，或标题包含且描述同段 */
function isDuplicate(a: Issue, b: Issue): boolean {
  const ta = `${a.name} ${a.description}`;
  const tb = `${b.name} ${b.description}`;
  const moneyA = extractMoneyTokens(ta);
  const moneyB = extractMoneyTokens(tb);
  let sharedMoney = 0;
  moneyA.forEach((t) => {
    if (moneyB.has(t)) sharedMoney++;
  });
  // 共享两个以上金额特征（大写链/阿拉伯金额），基本可断定为同一处金额缺陷
  if (sharedMoney >= 2) return true;
  const na = normalizeTitle(a.name);
  const nb = normalizeTitle(b.name);
  const common = lcsLen(na, nb);
  const titleRatio = common / Math.max(1, Math.min(na.length, nb.length));
  // 共享具体金额且标题核心词重合（如"大写金额…不一致"与"金额大写不一致"）
  if (sharedMoney >= 1 && common >= 3) return true;
  if (titleRatio >= 0.72 && common >= 8) return true;
  // 标题包含关系且共享金额
  if ((na.includes(nb) || nb.includes(na)) && sharedMoney >= 1) return true;
  return false;
}

/** 合并两条重复问题：保留较高级别、更完整证据与整改方案 */
function mergePair(keep: Issue, drop: Issue): Issue {
  const winner = RISK_ORDER[keep.riskLevel] >= RISK_ORDER[drop.riskLevel] ? keep : drop;
  const loser = winner === keep ? drop : keep;
  const pick = <T,>(x: T | undefined, y: T | undefined): T | undefined => {
    if (x === undefined || x === null || x === "") return y;
    return x;
  };
  const merged: Issue = {
    ...winner,
    evidence: pick(winner.evidence, loser.evidence),
    basis: pick(winner.basis, loser.basis),
    remediation: pick(winner.remediation, loser.remediation),
    description: winner.description || loser.description,
    factFlag: winner.factFlag || loser.factFlag,
  };
  // 位置优先取有页码/章节的
  const loc = winner.location;
  const other = loser.location;
  if (!loc?.page && other?.page) merged.location = { ...loc, page: other.page, chapter: loc.chapter || other.chapter };
  return merged;
}

/** 近似问题去重（同一缺陷只保留一条，取最高级别） */
export function mergeDuplicateIssues(issues: Issue[]): Issue[] {
  const out: Issue[] = [];
  const used = new Array(issues.length).fill(false);
  for (let i = 0; i < issues.length; i++) {
    if (used[i]) continue;
    let cur = issues[i];
    for (let j = i + 1; j < issues.length; j++) {
      if (used[j]) continue;
      if (cur.riskLevel === "highlight" || issues[j].riskLevel === "highlight") continue;
      if (isDuplicate(cur, issues[j])) {
        cur = mergePair(cur, issues[j]);
        used[j] = true;
      }
    }
    out.push(cur);
  }
  return out;
}

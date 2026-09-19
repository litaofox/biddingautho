// LLM 输出事实校验（输出侧过滤层，与 prompt 输入约束共同构成反幻觉双保险）
// 校验规则全部基于通用文本模式（日期解析、原文比对、报价红线），不针对任何具体项目或单位。
import type { Issue, RiskLevel } from "../types.js";

export interface FactGuardContext {
  /** 审核基准日期（今天） */
  today: Date;
  /** 采购文件载明的投标截止/开标时间原文 */
  deadlineText?: string;
  /** 投标文件合并全文（用于证据原文复核） */
  bidText: string;
}

export interface FactGuardResult {
  /** 校验后的问题（部分被降级/标注） */
  issues: Issue[];
  /** 被拦截或存疑事项的人工核验提示 */
  disputedMessages: string[];
}

/** 解析中文/数字日期：2026年09月04日、2026-9-4、2026/09/04、2026.09.04 */
export function parseDates(text: string): Date[] {
  const out: Date[] = [];
  const re = /(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      out.push(new Date(y, mo - 1, d));
    }
  }
  return out;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 归一化为仅保留中文/字母/数字，便于证据原文比对 */
function normalize(s: string): string {
  return (s || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
}

/**
 * 报价一致性红线：投标函/投标书、开标一览表、报价明细表之间报价不一致
 * （大写错漏字、大小写不符、总价≠单价合计、多表/多页报价互不一致）
 * 属法定/招标文件明确的实质性响应问题，不得因"证据文本层无法机械复核"而降级。
 * 该规则对所有政府采购项目通用，不包含任何项目特定内容。
 */
export function isPriceConsistencyIssue(text: string): boolean {
  const hasPriceObject = /报价|金额|总价|单价|合价|小写|大写|开标一览表|报价明细|投标函|投标书/.test(text);
  const hasConflict = /不一致|不符|不相符合|矛盾|错字|漏字|多字|缺字|合计不等|计算错误|不相等|存在差异|文字差异/.test(text);
  const hasNumeral =
    /[壹贰叁肆伍陆柒捌玖拾佰仟万亿零][壹贰叁肆伍陆柒捌玖拾佰仟万亿零元圆角分整]{2,}/.test(text) ||
    /\d[\d,]*(?:\.\d+)?\s*(?:元|万元|圆)/.test(text);
  if (!(hasPriceObject && hasConflict && hasNumeral)) return false;
  // 反向语境排除（仅限冲突表述整体处于否定语境时）：
  // "不存在不一致 / 未发现差异 / 并无矛盾 / 无错漏" → 正常核对结论，不视为缺陷。
  // 注意：不可用"完全一致/均一致/核对一致"作排除信号——问题描述常引用招标条款原文
  // （如"三处总价必须完全一致"），条款义务表述含"一致"但恰恰是在指出不一致缺陷，
  // 用它排除会把真实的报价红线问题误判为正常说明（已发生的线上缺陷）。
  const NEG_RE =
    /(?:不存在|未发现|并无|未出现|无)[^。，；\n]{0,10}(?:不一致|不符|矛盾|差异|错漏|错字|漏字|缺字|多字)/;
  const CONFLICT_RE = /不一致|不符|矛盾|错字|漏字|多字|缺字|存在差异/;
  const conflictNegated = text.split(/[。；\n]/).some((clause) => {
    if (!NEG_RE.test(clause)) return false;
    // 该分句剔除否定命中后不得残留独立冲突表述，避免"无错字但存在不一致"被整体误排
    const rest = clause.replace(new RegExp(NEG_RE.source, "g"), "");
    return !CONFLICT_RE.test(rest);
  });
  return !conflictNegated;
}

/** 提取证据中的"强可定位 token"：引号内原文、中文大写金额链、阿拉伯金额/数字 */
function extractGroundTokens(evidence: string): string[] {
  const tokens = new Set<string>();

  // 引号/书名号内的原文片段（‘…’、“…”、「…」、『…』、《…》）
  const quoteRe = /[‘’“”「」『』《》]([^‘’“”「」『』《》]{4,60})[‘’“”「」『』《》]/g;
  let qm: RegExpExecArray | null;
  while ((qm = quoteRe.exec(evidence)) !== null) tokens.add(qm[1]);

  // 中文大写金额链，如 壹佰玖拾捌万壹仟元整
  const cnRe = /[壹贰叁肆伍陆柒捌玖拾佰仟万亿零]{3,}[元圆角分]?整?/g;
  let cm: RegExpExecArray | null;
  while ((cm = cnRe.exec(evidence)) !== null) {
    if (cm[0].length >= 4) tokens.add(cm[0]);
  }

  // 阿拉伯金额/长数字，如 1,981,000.00 元
  const numRe = /\d[\d,]{3,}(?:\.\d+)?/g;
  let nm: RegExpExecArray | null;
  while ((nm = numRe.exec(evidence)) !== null) tokens.add(nm[0]);

  return Array.from(tokens);
}

/**
 * 判断证据文本是否能在投标原文中找到落点：
 * 1. 强 token（引号原文/大写金额/阿拉伯金额）任一命中即视为可溯源（表格抽取常改变叙述文字，但金额数字一致）；
 * 2. 否则退化为多窗口 6~8 字滑窗探测。
 */
function evidenceGroundable(evidence: string, normalizedBid: string): boolean {
  const ev = normalize(evidence);
  if (ev.length < 10) return true; // 过短的证据不做机械比对，避免误伤

  // 1. 强 token 定位
  const tokens = extractGroundTokens(evidence)
    .map((t) => normalize(t))
    .filter((t) => t.length >= 4);
  if (tokens.length > 0) {
    if (tokens.some((t) => normalizedBid.includes(t))) return true;
    // 有强 token 但全部无法命中 → 确实可疑（继续走滑窗给一次机会）
  }

  // 2. 滑窗探测（更短窗口、更多探针，容忍表格断行/轻微 OCR 差异）
  const probes: string[] = [ev.slice(0, 12), ev.slice(-12)];
  for (let i = 0; i + 6 <= ev.length; i += 4) {
    probes.push(ev.slice(i, i + 6));
    if (probes.length >= 16) break;
  }
  return probes.some((p) => p.length >= 6 && normalizedBid.includes(p));
}

/** 风险等级序数（用于合并/升级比较） */
const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  info: 1,
  highlight: 0,
};

/**
 * 对 LLM 产出的问题做事实校验：
 * A. 日期断言：声称"未来日期/晚于今天/当前年份应为…"但与基准日期矛盾 → 降级 info 并转人工核验
 * B. 投标截止断言：声称日期晚于截止日但实际不晚 → 同上
 * C. 证据溯源：evidence 无法在投标原文中找到落点 → 标注；
 *    普通 critical 降级 info 转人工核验；但报价一致性红线问题保留 critical（表格金额抽取差异不影响定性）
 */
export function guardIssueFacts(issues: Issue[], ctx: FactGuardContext): FactGuardResult {
  const todayMs = startOfDay(ctx.today);
  const deadlineMs = ctx.deadlineText ? parseDates(ctx.deadlineText)[0] : undefined;
  const normalizedBid = normalize(ctx.bidText);
  const disputedMessages: string[] = [];
  const todayLabel = `${ctx.today.getFullYear()}-${ctx.today.getMonth() + 1}-${ctx.today.getDate()}`;

  const guarded = issues.map((issue) => {
    const text = `${issue.name} ${issue.description} ${issue.evidence || ""}`;
    const dates = parseDates(text);

    // ---- A1. 模型自述"当前年份应为 X"类幻觉（X 早于真实年份）----
    const yearClaim = text.match(/(?:当前|现在|今年|本年度)[^。；]{0,12}?年份?[^。；]{0,6}?(20\d{2})/);
    if (yearClaim && Number(yearClaim[1]) < ctx.today.getFullYear()) {
      return dispute(
        issue,
        "date-disputed",
        `模型声称的"当前年份 ${yearClaim[1]}"与审核基准日期 ${todayLabel} 矛盾`,
        disputedMessages
      );
    }

    // ---- A2. "未来日期/晚于当前/晚于今天/尚未到来" 但证据日期并不晚于今天 ----
    const claimsFuture =
      /未来日期|晚于当前|晚于今天|尚未到来|还未到|日期超前/.test(text) ||
      (/晚于/.test(text) && /当前|今天|现在|今日/.test(text));
    if (claimsFuture && dates.length > 0) {
      const anyFuture = dates.some((d) => startOfDay(d) > todayMs);
      if (!anyFuture) {
        return dispute(
          issue,
          "date-disputed",
          `证据日期（${dates[0].getFullYear()}-${dates[0].getMonth() + 1}-${dates[0].getDate()}）不晚于审核基准日期 ${todayLabel}，"未来日期"判定不成立`,
          disputedMessages
        );
      }
    }

    // ---- B. 声称"晚于投标截止"但实际不晚（仅在截止日可解析时校验）----
    if (deadlineMs && /晚于.{0,10}(投标截止|截止时间|开标)/.test(text) && dates.length > 0) {
      const anyAfterDeadline = dates.some((d) => startOfDay(d) > startOfDay(deadlineMs));
      if (!anyAfterDeadline) {
        return dispute(
          issue,
          "date-disputed",
          `证据日期不晚于投标截止时间，时效违规判定与事实不符`,
          disputedMessages
        );
      }
    }

    // ---- C. 证据原文复核 ----
    const ev = (issue.evidence || "").trim();
    if (
      ev &&
      ev !== "未检索到对应内容" &&
      issue.riskLevel !== "highlight" &&
      !evidenceGroundable(ev, normalizedBid)
    ) {
      const priceRedLine = isPriceConsistencyIssue(text);

      if (issue.riskLevel === "critical" && !priceRedLine) {
        const next: Issue = {
          ...issue,
          riskLevel: "info",
          factFlag: "evidence-unverified",
          description:
            `【系统事实校验：引用证据未能在投标文件原文中复核，已由准高危降级为待人工核验】` +
            issue.description,
        };
        disputedMessages.push(
          `「${issue.name}」引用的证据原文未能在投标文件中自动复核，疑似模型转述失真，已降级并需人工核验`
        );
        return next;
      }

      // 报价红线问题或非 critical：保留定级，仅打标提示人工核对（表格/扫描件文本抽取差异不改变定性）
      if (!issue.factFlag) {
        const note = priceRedLine
          ? "（注：金额/表格文本抽取可能存在差异，请以开标一览表等原件扫描件人工核对，但多处报价不一致的定性不因文本抽取差异改变）"
          : "（注：引用证据未能在投标原文中自动复核，建议人工确认）";
        const next: Issue = {
          ...issue,
          factFlag: "evidence-unverified",
          description: issue.description + note,
        };
        if (priceRedLine) {
          disputedMessages.push(
            `「${issue.name}」涉及多处报价/金额不一致，请人工核对开标一览表、投标函、报价明细表原件后确认（系统已按废标风险保留最高级警示）`
          );
        }
        return next;
      }
    }

    return issue;
  });

  return { issues: guarded, disputedMessages };
}

/** 日期类断言与事实矛盾：降级 info + 标注 + 生成人工核验提示 */
function dispute(
  issue: Issue,
  flag: Issue["factFlag"],
  reason: string,
  disputedMessages: string[]
): Issue {
  const next: Issue = {
    ...issue,
    riskLevel: "info",
    factFlag: flag,
    description: `【系统事实校验存疑·已转人工核验：${reason}】\n` + issue.description,
  };
  disputedMessages.push(`「${issue.name}」${reason}，请人工核对后再下结论`);
  return next;
}

export { RISK_ORDER };

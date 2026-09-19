// 采购文件章节感知摘要工具
// 解决"盲截前 N 字符导致中后部章节（服务要求/评分办法/投标文件格式）整条丢失"的问题。
// 全部基于文档自身章节结构抽取，不内置任何项目相关的硬编码内容。
//
// 关键修复：
// 1. 目录（TOC）中的标题行（如"第三章 评标办法 ........ 48"）不是正文标题，
//    必须跳过，否则截取到的只是两行目录，P48 正文评分办法整条丢失（第三章评分索引缺失根因）。
// 2. 同一关键词可能命中多个正文标题（正文 + 附件），取最长/合并多个候选片段。
// 3. 标题无法匹配时，用全文关键词信号密度窗口兜底。

/** 识别标题行：第X章/节/部分/条、一、二、（一）、1. / 1.1 / 1.1.1 等
 *  注意"部分/条"必须用 (?:…|部分|条) 整词匹配，单字符类 [章节部分条] 会把"第六部分…"只匹配到"第六部"，
 *  导致章级标题被误判为低级标题、章节切片被提前截断。
 */
const HEADING_RE =
  /^\s*(第[一二三四五六七八九十百零0-9]+(?:章|节|部分|条)|[一二三四五六七八九十]+[、.．]\s*|（[一二三四五六七八九十0-9]+）|\([一二三四五六七八九十0-9]+\)|\d+(?:\.\d+){0,3}[、.．]\s*)/;

/** 是否为列表式标题（非"第X章/节/部分/条"）：这类标题必须是短行，段落折行（如"4、比较与评分。评标委员会按…"）不是标题 */
function isListStyleHeading(head: string): boolean {
  return !/^第[一二三四五六七八九十百零0-9]+(?:章|节|部分|条)/.test(head);
}

/** 目录引导符：连续点/省略号等（如 "评标办法 ………… 48"、"投标格式 ...... 30"） */
const TOC_LEADER_RE = /(?:[.．。·•・…]{3,}|…{2,})/;

interface HeadingLine {
  idx: number;
  level: number;
  title: string;
  isToc: boolean;
}

/** 判断是否为目录行：含连续引导符，或"标题 + 大量空白/制表符 + 页码" */
function isTocLine(line: string): boolean {
  if (TOC_LEADER_RE.test(line)) return true;
  // 形如 "第三章 评标办法            48"（标题后 4+ 空白再接孤立数字结尾）
  if (/\S\s{4,}\d{1,3}\s*$/.test(line)) return true;
  if (/\t\s*\d{1,3}\s*$/.test(line)) return true;
  return false;
}

/** 提取所有标题行（保留顺序），标注是否目录行 */
export function listHeadings(text: string): HeadingLine[] {
  const lines = text.split(/\r?\n/);
  const out: HeadingLine[] = [];
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.length > 80) return;
    const m = line.match(HEADING_RE);
    if (!m) return;
    const head = m[0];
    let level = 4;
    if (/^第[一二三四五六七八九十百零0-9]+章/.test(head)) level = 1;
    else if (/^第[一二三四五六七八九十百零0-9]+节/.test(head)) level = 2;
    else if (/^第[一二三四五六七八九十百零0-9]+部分/.test(head)) level = 1;
    else if (/^\d+\.\d+/.test(head)) level = 3;
    else if (/^[一二三四五六七八九十]+[、.．]/.test(head)) level = 2;
    else level = 3;
    // 伪标题过滤：列表式标题必须是短行且不含句中句号；
    // 段落折行（如"4、比较与评分。评标委员会按招标文件规定的《投标评分细则》，对符合"）会被 \d+、 误命中，
    // 把章级切片在半截截断，导致真正的评分细则表丢失。
    if (isListStyleHeading(head) && (line.length > 30 || line.includes("。"))) return;
    out.push({ idx, level, title: line, isToc: isTocLine(line) });
  });
  return out;
}

/** 提取章节目录文本（供长文前置索引，包含目录行也无妨——这里本来就是做索引） */
export function buildHeadingCatalog(text: string, maxLines = 200): string {
  return listHeadings(text)
    .slice(0, maxLines)
    .map((h) => h.title.replace(TOC_LEADER_RE, " ").replace(/\s{2,}/g, " ").trim())
    .join("\n");
}

/**
 * 按关键词定位【正文】章节并截取正文（从命中标题到下一个同级/更高标题为止，限幅保护）。
 * 若存在多个候选标题，合并去重后返回（覆盖正文与附件中的同名章节）。
 */
export function sliceSectionByKeywords(
  text: string,
  keywords: string[],
  maxChars = 8000
): string {
  const sections = sliceSectionsByKeywords(text, keywords, maxChars, 3);
  return sections.slice(0, 1)[0] || "";
}

/** 多候选版本：返回多个命中章节片段（已去重、按长度降序），总幅不超过 maxChars */
export function sliceSectionsByKeywords(
  text: string,
  keywords: string[],
  maxChars = 12000,
  maxCandidates = 3
): string[] {
  const lines = text.split(/\r?\n/);
  // 只保留正文标题（跳过目录行）
  const bodyHeadings = listHeadings(text).filter((h) => !h.isToc);

  const matched = bodyHeadings.filter((h) => keywords.some((k) => h.title.includes(k)));
  const candidates: string[] = [];
  let budget = maxChars;

  // 先按截取长度降序（正文章节长，误命中的短小节标题排后）
  const slices = matched
    .map((hit, order) => {
      const pos = bodyHeadings.indexOf(hit);
      const next = bodyHeadings.find((h, i) => i > pos && h.level <= hit.level);
      // 无下一个同级标题时截到文末（章级章节可能超过 400 行；字符预算 maxChars 已限幅）
      const endLine = next ? next.idx : lines.length;
      return {
        order,
        slice: lines.slice(hit.idx, endLine).join("\n"),
      };
    })
    .sort((a, b) => b.slice.length - a.slice.length);

  const seenPrefix = new Set<string>();
  for (const s of slices) {
    const piece = s.slice.trim();
    if (piece.length < 40) continue;
    const key = piece.slice(0, 60);
    if (seenPrefix.has(key)) continue;
    // 去除与已选片段高度重叠的候选（子串关系）
    if (candidates.some((c) => c.includes(piece) || piece.includes(c))) continue;
    seenPrefix.add(key);
    if (piece.length > budget) {
      candidates.push(piece.slice(0, budget));
      budget = 0;
    } else {
      candidates.push(piece);
      budget -= piece.length;
    }
    if (candidates.length >= maxCandidates || budget <= 100) break;
  }
  return candidates;
}

/**
 * 全文关键词信号密度窗口兜底：
 * 当章节标题无法命中（标题被解析成表格/图片/非常规编号）时，
 * 直接在全文中按关键词出现位置开窗，选信号密度最高的非重叠窗口。
 *
 * @param signalRe 评分/打分信号正则（数字+分、评分关键词），用于窗口打分
 */
export function sliceKeywordWindows(
  text: string,
  keywords: string[],
  signalRe: RegExp,
  windowSize = 6000,
  maxWindows = 2
): string[] {
  if (!text) return [];
  const positions: number[] = [];
  for (const k of keywords) {
    let from = 0;
    while (positions.length < 200) {
      const idx = text.indexOf(k, from);
      if (idx < 0) break;
      positions.push(idx);
      from = idx + k.length;
    }
  }
  if (positions.length === 0) return [];

  const scored = positions.map((p) => {
    const start = Math.max(0, p - Math.round(windowSize * 0.25));
    const win = text.slice(start, start + windowSize);
    const signals = (win.match(signalRe) || []).length;
    const kwHits = keywords.reduce((n, k) => n + (win.includes(k) ? 1 : 0), 0);
    return { start, score: signals * 2 + kwHits * 5 };
  });
  scored.sort((a, b) => b.score - a.score);

  const picked: { start: number }[] = [];
  const out: string[] = [];
  for (const s of scored) {
    // 与已选窗口重叠度过高则跳过
    if (picked.some((p) => Math.abs(p.start - s.start) < windowSize * 0.6)) continue;
    picked.push({ start: s.start });
    out.push(text.slice(s.start, s.start + windowSize).trim());
    if (out.length >= maxWindows) break;
  }
  return out;
}

/** 去重拼接多个章节片段 */
function joinSections(sections: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sections) {
    const key = s.slice(0, 80);
    if (s.trim() && !seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out.join("\n\n……\n\n");
}

/**
 * 生成审核清单用摘要：目录索引 + 关键章节（评分/服务/商务/技术需求/格式/合同）+ 文首兜底
 */
export function buildPlanDigest(text: string, maxChars = 30000): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const catalog = buildHeadingCatalog(text, 250);
  const sections = [
    joinSections(sliceSectionsByKeywords(text, ["评分办法", "评标办法", "评分标准", "评审办法", "打分"], 9000, 2)),
    joinSections(sliceSectionsByKeywords(text, ["采购需求", "服务要求", "服务内容", "商务要求", "技术要求", "项目需求"], 9000, 2)),
    joinSections(sliceSectionsByKeywords(text, ["投标文件格式", "投标文件组成", "响应文件格式", "文件格式"], 6000, 2)),
    joinSections(sliceSectionsByKeywords(text, ["合同条款", "合同主要条款", "合同范本"], 4000, 1)),
    joinSections(sliceSectionsByKeywords(text, ["投标人须知", "前附表"], 5000, 2)),
  ].filter(Boolean);
  const head = text.slice(0, 4000);

  const digest =
    `【采购文件章节目录】\n${catalog}\n【目录结束】\n\n` +
    `【关键章节摘录】\n${sections.join("\n\n……\n\n")}\n\n【文首内容】\n${head}`;
  return digest.slice(0, maxChars);
}

/** 评分信号：数字+分、评分/打分/评审/得分 等 */
const SCORING_SIGNAL_RE = /\d+(?:\.\d+)?\s*分|评分|打分|评审因素|得分|满分|分值/g;

/** 评分办法专用摘要：正文章节多候选合并 → 全文信号窗口兜底 → 目录+文首最后兜底 */
export function buildScoringDigest(text: string, maxChars = 14000): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const sections = sliceSectionsByKeywords(
    text,
    ["评分办法", "评标办法", "评分标准", "评审办法", "评分细则", "评分因素", "打分"],
    maxChars,
    3
  );
  if (sections.length > 0) {
    const joined = joinSections(sections).slice(0, maxChars);
    // 章节片段中确实出现评分信号才采用，否则继续走窗口兜底
    if ((joined.match(SCORING_SIGNAL_RE) || []).length >= 3) return joined;
  }

  const windows = sliceKeywordWindows(
    text,
    ["评分", "评标", "打分", "评审因素", "满分", "得分"],
    SCORING_SIGNAL_RE,
    Math.round(maxChars / 2),
    2
  );
  if (windows.length > 0) {
    return `【评分办法原文摘录（按关键词定位）】\n${joinSections(windows).slice(0, maxChars)}`;
  }

  // 最后兜底：目录 + 文首
  const catalog = buildHeadingCatalog(text, 200);
  return `【采购文件章节目录】\n${catalog}\n【目录结束】\n\n${text.slice(0, 8000)}`;
}

/** 投标文件格式清单专用摘要 */
export function buildFormatDigest(text: string, maxChars = 8000): string {
  if (!text) return "";
  const sections = sliceSectionsByKeywords(
    text,
    ["投标文件格式", "投标文件组成", "响应文件格式", "文件格式", "投标格式"],
    maxChars,
    2
  );
  if (sections.length > 0) return joinSections(sections).slice(0, maxChars);
  // 兜底：含格式编号关键词的窗口
  const windows = sliceKeywordWindows(
    text,
    ["投标文件格式", "格式一", "格式二", "开标一览表", "投标书"],
    /格式[一二三四五六七八九十0-9]|开标一览表|授权委托书|投标文件格式/g,
    maxChars,
    1
  );
  return windows[0] || "";
}

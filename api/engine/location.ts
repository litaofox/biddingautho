// 位置定位引擎（F9）
// 为每个审核问题提供精确的位置信息：文件名、章节、页码、表格行号、原文片段
// 基于已解析的 Section 结构与全文文本进行检索
import type { Bidder, BidderFile, IssueLocation, Section, UploadedFile } from "../types.js";

/**
 * 在文件中查找关键词首次出现位置，并构造 IssueLocation
 * @param file 投标文件
 * @param keyword 关键词（已小写化的查询字符串）
 * @param hintChapter 章节提示（如已知所属章节，限定在该章节内查找）
 */
export function locateKeyword(
  file: BidderFile | UploadedFile,
  keyword: string,
  hintChapter?: string
): IssueLocation {
  const lowerKeyword = keyword.toLowerCase();
  if (!lowerKeyword) {
    return { file: file.name };
  }

  // 1. 优先在指定章节内查找
  if (hintChapter) {
    const section = (file.sections || []).find((s) =>
      s.title.includes(hintChapter)
    );
    if (section && section.content.toLowerCase().includes(lowerKeyword)) {
      return {
        file: file.name,
        chapter: section.title,
        snippet: extractSnippet(section.content, lowerKeyword),
      };
    }
  }

  // 2. 全章节扫描，找到首个含关键词的章节
  for (const section of file.sections || []) {
    const haystack = (section.title + "\n" + section.content).toLowerCase();
    if (haystack.includes(lowerKeyword)) {
      return {
        file: file.name,
        chapter: section.title,
        snippet: extractSnippet(section.content, lowerKeyword),
      };
    }
  }

  // 3. 退回到全文检索
  const fullText = (file.text || "").toLowerCase();
  if (fullText.includes(lowerKeyword)) {
    return {
      file: file.name,
      snippet: extractSnippet(file.text || "", lowerKeyword),
    };
  }

  // 4. 未找到
  return { file: file.name };
}

/**
 * 提取关键词附近的上下文片段（最多 80 字）
 */
export function extractSnippet(text: string, keyword: string): string {
  if (!text || !keyword) return "";
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const idx = lowerText.indexOf(lowerKeyword);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + keyword.length + 50);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (snippet.length > 80) snippet = snippet.slice(0, 80) + "...";
  return snippet;
}

/**
 * 在多个文件中检索关键词，返回首个命中位置
 */
export function locateAcrossFiles(
  files: (BidderFile | UploadedFile)[],
  keyword: string,
  hintChapter?: string
): IssueLocation | null {
  for (const f of files) {
    const loc = locateKeyword(f, keyword, hintChapter);
    if (loc.snippet) return loc;
  }
  return null;
}

/**
 * 在 Bidder（含商务/技术文件）中查找关键词位置
 */
export function locateInBidder(
  bidder: Bidder,
  keyword: string,
  hintChapter?: string
): IssueLocation {
  const loc = locateAcrossFiles(bidder.files, keyword, hintChapter);
  return loc || { file: bidder.files[0]?.name || bidder.name };
}

/**
 * 定位表格：识别"表X-Y"编号在文本中的位置
 * 简化策略：检索"表X-Y"字样附近的内容，标注 tableId
 */
export function locateTable(
  file: BidderFile | UploadedFile,
  tableId: string
): IssueLocation {
  const lowerTableId = tableId.toLowerCase();
  const sections = file.sections || [];
  for (const section of sections) {
    const haystack = (section.title + "\n" + section.content).toLowerCase();
    if (haystack.includes(lowerTableId)) {
      return {
        file: file.name,
        chapter: section.title,
        tableId,
        snippet: extractSnippet(section.content, lowerTableId),
      };
    }
  }
  // 退回全文
  if ((file.text || "").toLowerCase().includes(lowerTableId)) {
    return {
      file: file.name,
      tableId,
      snippet: extractSnippet(file.text || "", lowerTableId),
    };
  }
  return { file: file.name, tableId };
}

/**
 * 估算页码：基于字符位置与平均每页字符数
 * 仅作粗略估算，标注时应说明"约第X页"
 */
export function estimatePage(text: string, keyword: string, charsPerPage = 1500): number | undefined {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return undefined;
  return Math.floor(idx / charsPerPage) + 1;
}

// 文本瑕疵检测模块（F5）
// 检测投标文件中的文本规范问题：
// - 错别字（基于词典）
// - 重复字（如"正本正本"）
// - 图表编号错乱（图4-18 被写成 图418 等）
// - 页脚格式混用（罗马数字与阿拉伯数字）
// - 断句拼接错误（年份拼接混乱）
import type { Bidder, BidderFile, Issue } from "../types.js";
import { locateKeyword } from "./location.js";

/** 错别字词典 */
const TYPO_DICT: { wrong: string; correct: string }[] = [
  { wrong: "对答", correct: "应答" },
  { wrong: "正本正本", correct: "正本" },
  { wrong: "布署", correct: "部署" },
  { wrong: "按装", correct: "安装" },
  { wrong: "既使", correct: "即使" },
  { wrong: "身处", correct: "申明" },
  { wrong: "启示", correct: "启事" },
  { wrong: "过度", correct: "过渡" }, // 仅在特定语境，保守不报
];

/** 文本瑕疵检测入口 */
export function runTextFlawCheck(bidder: Bidder): Issue[] {
  return [
    ...detectTypo(bidder),
    ...detectDuplicateChar(bidder),
    ...detectFigureNumbering(bidder),
    ...detectFooterInconsistency(bidder),
    ...detectBrokenSentence(bidder),
  ];
}

// ============ 错别字检测 ============

function detectTypo(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    for (const { wrong, correct } of TYPO_DICT) {
      // 排除"过度"这类语境敏感词，仅在简单字符串匹配时报告
      if (wrong === "过度") continue;
      const idx = text.indexOf(wrong);
      if (idx === -1) continue;
      const count = text.split(wrong).length - 1;
      issues.push(makeIssue(
        bidder,
        file,
        `错别字-${wrong}`,
        `检测到 ${count} 处错别字"${wrong}"，应为"${correct}"`,
        "minor",
        locateKeyword(file, wrong),
        `将"${wrong}"替换为"${correct}"`,
        "评分细则-方案规范性"
      ));
    }
  }
  return issues;
}

// ============ 重复字检测 ============

function detectDuplicateChar(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  // 检测同一中文词连续重复 2 次以上（如"正本正本"、"的的"）
  const dupPattern = /([\u4e00-\u9fa5]{2})\1{1,}/g;
  for (const file of bidder.files) {
    const text = file.text || "";
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = dupPattern.exec(text)) !== null) {
      const word = m[1];
      if (seen.has(word)) continue;
      seen.add(word);
      // 排除合理重复（如"年"重复、"的"在"目的目的"中可能合理，仅报告明显异常）
      if (["意义", "可以", "进行", "相关"].includes(word)) continue;
      issues.push(makeIssue(
        bidder,
        file,
        `重复字-${word}`,
        `检测到重复字"${word}${word}"，疑为录入错误`,
        "minor",
        locateKeyword(file, word),
        `删除重复字，仅保留一个"${word}"`,
        "评分细则-方案规范性"
      ));
    }
  }
  return issues;
}

// ============ 图表编号错乱检测 ============

function detectFigureNumbering(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";

    // 检测"图418""表415"这种缺失分隔符的编号
    // 正确格式应为"图4-18"或"图4.18"
    const brokenPattern = /([图表])(\d{2,})/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = brokenPattern.exec(text)) !== null) {
      const num = m[2];
      // 仅当数字长度≥3（如图418、表415）时判定为错乱
      if (num.length < 3) continue;
      const key = `${m[1]}${num}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // 检查同章节是否存在正确格式"图4-18"
      // 提取前缀数字（如图418 → 章节4，编号18）
      const chapter = num[0];
      const itemNum = num.slice(1);
      const correctForm = `${m[1]}${chapter}-${itemNum}`;
      const hasCorrectForm = text.includes(correctForm);

      if (hasCorrectForm) {
        issues.push(makeIssue(
          bidder,
          file,
          `编号错乱-${m[1]}${num}`,
          `编号"${m[1]}${num}"格式错乱，应改为"${correctForm}"（同章节已存在正确格式）`,
          "minor",
          locateKeyword(file, m[0]),
          `统一全章图表编号格式为"${m[1]}X-Y"，更新交叉引用`,
          "评分细则-方案规范性"
        ));
      }
    }
  }
  return issues;
}

// ============ 页脚格式混用检测 ============

function detectFooterInconsistency(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    // 检测"第I页""第X页"罗马数字与"第1页""第2页"阿拉伯数字混用
    const romanPattern = /第[IVXLCDMivxlcdm]+\s*页/g;
    const arabicPattern = /第\d+\s*页/g;
    const romans = text.match(romanPattern) || [];
    const arabics = text.match(arabicPattern) || [];

    if (romans.length >= 2 && arabics.length >= 2) {
      issues.push(makeIssue(
        bidder,
        file,
        "页脚格式混用",
        `页脚罗马数字（${romans.length} 处）与阿拉伯数字（${arabics.length} 处）混用`,
        "minor",
        locateKeyword(file, romans[0]),
        "统一全文章节页脚格式（建议统一为阿拉伯数字）",
        "评分细则-方案规范性"
      ));
    }
  }
  return issues;
}

// ============ 断句拼接错误检测 ============

function detectBrokenSentence(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    // 检测年份重复拼接（如"2021-2024年度上海市奉贤2024-2025年度奉贤区"）
    const brokenPattern = /(\d{4})[-至到~](\d{4})[年度]?[^。、\n]{0,15}?\1[-至到~](\d{4})/g;
    let m: RegExpExecArray | null;
    while ((m = brokenPattern.exec(text)) !== null) {
      issues.push(makeIssue(
        bidder,
        file,
        "断句拼接错误",
        `检测到年份拼接断句："${m[0].slice(0, 40)}..."，疑为两段文本未正确分隔`,
        "minor",
        { file: file.name, snippet: m[0].slice(0, 60) },
        "断句重写该段文字，确保时间表述清晰",
        "评分细则-方案规范性"
      ));
    }
  }
  return issues;
}

// ============ 工具函数 ============

function makeIssue(
  bidder: Bidder,
  file: BidderFile,
  name: string,
  description: string,
  riskLevel: "critical" | "major" | "minor" | "info" | "highlight",
  location: import("../types.js").IssueLocation,
  remediation: string,
  basis: string
): Issue {
  return {
    id: `textflaw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimension: "textFlaw",
    name: `${bidder.name} - ${name}`,
    riskLevel,
    location,
    description,
    evidence: location.snippet,
    basis,
    remediation,
  };
}

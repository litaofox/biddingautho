// 签字盖章完整性模块（F4）
// 基于"●"必签标记的全文检索：
// - 从采购文件提取必签位置清单（"●"标记 + 关联格式）
// - 在投标文件对应格式中检索签字栏
// - 文本层无法判断电子签章覆盖，列入"待人工核验"
import type { Bidder, BidderFile, Issue, UploadedFile } from "../types.js";
import { locateKeyword } from "./location.js";

/** 必签位置项（从采购文件提取） */
interface MustSignItem {
  /** 关联格式名（投标书/授权委托书/开标一览表/报价明细表/服务承诺） */
  formatName: string;
  /** 必验内容描述 */
  requiredContent: string;
  /** 在采购文件中的位置 */
  procurementSnippet: string;
}

/** 签字盖章检测入口 */
export function runSignatureCheck(
  bidder: Bidder,
  procurement: UploadedFile
): { issues: Issue[]; manualChecks: string[] } {
  const mustSigns = extractMustSignLocations(procurement);
  const issues: Issue[] = [];
  const manualChecks: string[] = [];

  for (const ms of mustSigns) {
    // 在投标文件中查找对应格式
    const matchedFile = findFormatFile(bidder, ms.formatName);
    if (!matchedFile) {
      // 投标文件未提供对应格式（结构问题，由 F8 完整性检测处理）
      continue;
    }

    const text = matchedFile.text || "";
    // 检测必验内容关键词是否出现在投标文件中
    const keywords = extractKeywords(ms.requiredContent);
    const missing = keywords.filter((k) => !text.includes(k));

    if (missing.length > 0) {
      issues.push(makeIssue(
        bidder,
        matchedFile,
        `签字栏缺失-${ms.formatName}`,
        `采购文件要求"${ms.formatName}"需 ${ms.requiredContent}；投标文件未检索到关键词：${missing.join("、")}`,
        "critical",
        locateKeyword(matchedFile, ms.formatName),
        `在"${ms.formatName}"对应位置补齐：${ms.requiredContent}`,
        `须知23.1 ★条款（${ms.procurementSnippet}）`
      ));
    }

    // 无论关键词是否齐全，文本层无法验证电子签章覆盖，列入人工核验
    manualChecks.push(
      `${ms.formatName}：${ms.requiredContent} - 需在上传件中确认电子签章/手写签名实际覆盖情况`
    );
  }

  return { issues, manualChecks };
}

// ============ 从采购文件提取必签位置清单 ============

/**
 * 扫描采购文件中"●"标记位置，关联到投标文件格式
 * 简化策略：检索"●"附近的格式名关键词
 */
export function extractMustSignLocations(procurement: UploadedFile): MustSignItem[] {
  const text = procurement.text || "";
  const items: MustSignItem[] = [];
  const seen = new Set<string>();

  // 按"●"切分，每个 ● 后的内容视为一条必签要求
  const segments = text.split(/●/);
  if (segments.length <= 1) {
    // 采购文件无 ● 标记，退回通用必签项
    return DEFAULT_MUST_SIGNS;
  }

  for (let i = 1; i < segments.length; i++) {
    const after = segments[i].slice(0, 100).trim();
    if (!after) continue;
    // 关联到格式名
    const formatName = matchFormatName(after);
    if (!formatName) continue;
    if (seen.has(formatName)) continue;
    seen.add(formatName);
    items.push({
      formatName,
      requiredContent: after.slice(0, 60),
      procurementSnippet: after.slice(0, 40),
    });
  }

  // 合并默认项（去重）
  for (const d of DEFAULT_MUST_SIGNS) {
    if (!seen.has(d.formatName)) {
      items.push(d);
      seen.add(d.formatName);
    }
  }

  return items;
}

/** 默认必签项（即使采购文件未明确标注，也按通用规则核验） */
const DEFAULT_MUST_SIGNS: MustSignItem[] = [
  {
    formatName: "投标书",
    requiredContent: "投标人（公章）+全权代表签字+日期",
    procurementSnippet: "须知23.1★条款",
  },
  {
    formatName: "法定代表人授权委托书",
    requiredContent: "投标人（公章）、法定代表人（签字或盖章）、被授权人（签字）",
    procurementSnippet: "须知23.1★条款",
  },
  {
    formatName: "开标一览表",
    requiredContent: "投标人（公章）",
    procurementSnippet: "须知23.1",
  },
  {
    formatName: "报价明细表",
    requiredContent: "投标人（公章）",
    procurementSnippet: "格式四",
  },
  {
    formatName: "服务承诺",
    requiredContent: "投标人（公章）",
    procurementSnippet: "格式十一",
  },
];

/** 关联到投标文件格式名 */
function matchFormatName(text: string): string | null {
  const patterns: { name: string; regex: RegExp }[] = [
    { name: "投标书", regex: /投标书|投标函/ },
    { name: "法定代表人授权委托书", regex: /法定代表人授权|授权委托书|法人授权/ },
    { name: "开标一览表", regex: /开标一览表|开标记录表/ },
    { name: "报价明细表", regex: /报价明细表|分项报价表/ },
    { name: "服务承诺", regex: /服务承诺|承诺函/ },
    { name: "资格证明文件", regex: /资格证明|声明函/ },
  ];
  for (const p of patterns) {
    if (p.regex.test(text)) return p.name;
  }
  return null;
}

/** 在 Bidder 中查找对应格式的文件 */
function findFormatFile(bidder: Bidder, formatName: string): BidderFile | null {
  // 商务文件通常包含投标书/授权委托书/开标一览表/报价明细表
  // 技术文件可能包含服务承诺
  const allFiles = bidder.files;
  for (const f of allFiles) {
    if (f.text && f.text.includes(formatName)) return f;
  }
  // 退回商务文件
  return allFiles.find((f) => f.type === "commercial") || allFiles[0] || null;
}

/** 从必验内容提取关键词 */
function extractKeywords(content: string): string[] {
  // 拆分为多个关键词：去掉标点，按顿号/空格切分，取长度≥2 的
  return content
    .replace(/[（()）：:，,。.]/g, " ")
    .split(/[、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 20);
}

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
    id: `signature_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimension: "signature",
    name: `${bidder.name} - ${name}`,
    riskLevel,
    location,
    description,
    evidence: location.snippet,
    basis,
    remediation,
  };
}

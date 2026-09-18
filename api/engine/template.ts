// 模板残留检测模块（F3）
// 检测投标文件中未清理的模板痕迹：
// - 占位符（XXX/【待填】/{{}}/TBD/___）
// - 跨项目引用（指向不存在的章节，如"详见第71页第11章项目进度管理"）
// - 通用模板角色（运维项目中的"监理公司/咨询公司/施工单位"）
// - 模板提示句（"如有其他...可自行补充"、"（注：...）"）
import type { Bidder, BidderFile, Issue, UploadedFile } from "../types.js";
import { locateKeyword } from "./location.js";

/** 模板残留检测入口 */
export function runTemplateCheck(bidder: Bidder, procurement: UploadedFile): Issue[] {
  return [
    ...detectPlaceholder(bidder),
    ...detectCrossProjectReference(bidder),
    ...detectIrrelevantRole(bidder, procurement),
    ...detectTemplateHint(bidder),
  ];
}

// ============ 占位符检测 ============

const PLACEHOLDER_PATTERNS: { regex: RegExp; name: string }[] = [
  { regex: /XXX{2,}/gi, name: "XXX占位符" },
  { regex: /【[^】]*待[^】]*】/g, name: "待填占位符" },
  { regex: /\[\s*待填\s*\]/gi, name: "[待填]占位符" },
  { regex: /{{[^}]*}}/g, name: "{{}}占位符" },
  { regex: /_{3,}/g, name: "下划线占位符" },
  { regex: /\bTBD\b/gi, name: "TBD占位符" },
  { regex: /（[^（）]*XXX[^（）]*）/g, name: "含XXX的括号占位" },
];

function detectPlaceholder(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    const seen = new Set<string>();

    for (const p of PLACEHOLDER_PATTERNS) {
      const matches = text.match(p.regex) || [];
      if (matches.length === 0) continue;
      const sample = matches[0];
      if (seen.has(p.name)) continue;
      seen.add(p.name);

      issues.push(makeIssue(
        bidder,
        file,
        `${p.name}未替换`,
        `检测到 ${matches.length} 处${p.name}（示例："${sample.slice(0, 30)}"），属未完成段落`,
        "major",
        locateKeyword(file, sample.slice(0, 5)),
        `填入具体内容（如：具体数据类型、实际数值、真实名称），删除占位符`,
        "评分细则-方案完整性"
      ));
    }
  }
  return issues;
}

// ============ 跨项目引用检测 ============

/**
 * 检测"详见第X页第Y章"类引用，验证所指章节是否实际存在
 */
function detectCrossProjectReference(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    // 匹配"详见第X页第Y章XX"
    const refPattern = /详见[^\n。]{0,30}?第\s*(\d+)\s*页[^\n。]{0,30}?第\s*[一二三四五六七八九十\d]+\s*章\s*([^\n。，；]{2,30})/g;

    let m: RegExpExecArray | null;
    while ((m = refPattern.exec(text)) !== null) {
      const refChapter = m[2].trim();
      // 检查全文是否存在该章节标题
      const chapterExists = (file.sections || []).some(
        (s) => s.title.includes(refChapter) ||
               s.content.includes(`第${refChapter}`) ||
               new RegExp(refChapter).test(s.title)
      );
      // 也检查章节关键词是否在文本中其他位置出现
      const appears = text.includes(refChapter);
      if (!chapterExists && !appears) {
        issues.push(makeIssue(
          bidder,
          file,
          "跨项目模板引用残留",
          `引用"${m[0]}"指向不存在的章节"${refChapter}"，疑为其他项目模板残留`,
          "major",
          locateKeyword(file, refChapter.slice(0, 4)),
          `删除该引用句，或改为指向本文件真实章节`,
          "评分细则-方案针对性"
        ));
      }
    }
  }
  return issues;
}

// ============ 通用模板角色检测 ============

/** 默认不相关角色（运维项目场景） */
const DEFAULT_IRRELEVANT_ROLES = [
  "监理公司", "监理单位", "咨询监理",
  "施工单位", "总包单位", "总承包",
  "设计单位", "勘察单位",
];

function detectIrrelevantRole(bidder: Bidder, procurement: UploadedFile): Issue[] {
  const issues: Issue[] = [];
  // 判断项目类型：若采购文件含"运维/运行/保障/服务"，则项目为运维服务类
  const procText = procurement.text || "";
  const isOpsProject = /运维|运行保障|保障项目|技术服务|服务项目/.test(procText);

  if (!isOpsProject) return issues;

  const irrelevantRoles = DEFAULT_IRRELEVANT_ROLES;

  for (const file of bidder.files) {
    const text = file.text || "";
    for (const role of irrelevantRoles) {
      const idx = text.indexOf(role);
      if (idx === -1) continue;
      const count = text.split(role).length - 1;
      if (count >= 1) {
        issues.push(makeIssue(
          bidder,
          file,
          `模板角色残留-${role}`,
          `本项目为运维服务项目，无${role}，但投标文件出现 ${count} 处"${role}"表述，属通用模板痕迹`,
          "major",
          locateKeyword(file, role),
          `删除或替换为"原厂技术支持组/后台技术支撑队伍"等运维项目实际角色`,
          "评分细则-方案针对性"
        ));
      }
    }
  }
  return issues;
}

// ============ 模板提示句检测 ============

const TEMPLATE_HINT_PATTERNS: { regex: RegExp; name: string; remediation: string }[] = [
  {
    regex: /如有[^。\n]{0,15}?可自行补充[^。\n]{0,5}/g,
    name: "模板补充提示句",
    remediation: "删除模板提示句，或补充实际的增值承诺内容",
  },
  {
    regex: /（注[:：][^）]{5,80}）/g,
    name: "模板注释句",
    remediation: "删除模板注释括号内容",
  },
  {
    regex: /请在此处填写[^。\n]{2,30}/g,
    name: "填写提示句",
    remediation: "删除提示句并填入实际内容",
  },
  {
    regex: /（[^）]*示例[^）]*）/g,
    name: "示例占位",
    remediation: "替换为实际内容",
  },
];

function detectTemplateHint(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    for (const p of TEMPLATE_HINT_PATTERNS) {
      const matches = text.match(p.regex) || [];
      if (matches.length === 0) continue;
      const sample = matches[0].slice(0, 30);
      issues.push(makeIssue(
        bidder,
        file,
        p.name,
        `检测到 ${matches.length} 处${p.name}（示例："${sample}"）`,
        "minor",
        locateKeyword(file, sample.slice(0, 4)),
        p.remediation,
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
    id: `template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimension: "template",
    name: `${bidder.name} - ${name}`,
    riskLevel,
    location,
    description,
    evidence: location.snippet,
    basis,
    remediation,
  };
}

// 完整性对照表模块（F8）
// 基于采购文件"投标文件格式"清单，逐项检查投标文件是否提供
// 12 项标准格式：投标书/授权委托书/开标一览表/报价明细表/资格证明/中小企业声明/
//               人员安排表/负责人情况表/类似业绩一览表/服务方案/服务承诺/基本情况表
import type { Bidder, CompletenessItem, Issue, UploadedFile } from "../types.js";
import { locateKeyword } from "./location.js";

/** 标准投标文件格式清单 */
const FORMAT_LIST: { id: string; name: string; keywords: string[] }[] = [
  { id: "一", name: "投标书", keywords: ["投标书", "投标函", "投标声明"] },
  { id: "二", name: "法定代表人授权委托书", keywords: ["授权委托书", "法定代表人授权", "法人授权"] },
  { id: "三", name: "开标一览表", keywords: ["开标一览表", "开标记录表"] },
  { id: "四", name: "报价明细表", keywords: ["报价明细表", "分项报价表"] },
  { id: "五", name: "资格证明文件", keywords: ["资格证明", "声明函", "营业执照", "财务声明"] },
  { id: "六", name: "中小企业等声明", keywords: ["中小企业声明", "企业规模", "中型企业", "小型企业"] },
  { id: "七", name: "人员安排表", keywords: ["人员安排表", "服务人员表", "项目人员"] },
  { id: "八", name: "拟投入负责人情况表", keywords: ["负责人情况表", "项目负责人", "项目经历"] },
  { id: "九", name: "类似业绩一览表", keywords: ["类似业绩一览表", "业绩一览表", "类似业绩"] },
  { id: "十", name: "服务方案、服务措施", keywords: ["服务方案", "服务措施", "实施方案"] },
  { id: "十一", name: "服务承诺", keywords: ["服务承诺", "承诺函", "承诺书"] },
  { id: "十二", name: "投标人基本情况表", keywords: ["基本情况表", "投标人简介", "公司简介"] },
];

/** 完整性对照入口 */
export function runCompletenessCheck(
  bidder: Bidder,
  procurement: UploadedFile
): { items: CompletenessItem[]; issues: Issue[] } {
  const items: CompletenessItem[] = [];
  const issues: Issue[] = [];

  // 从采购文件提取"投标文件格式"清单（如采购文件已列出）
  // 若采购文件未明确，使用默认 12 项清单
  const formats = extractFormatsFromProcurement(procurement) || FORMAT_LIST;

  for (const fmt of formats) {
    // 在投标文件中检索关键词
    let found = false;
    let foundFile = "";
    for (const f of bidder.files) {
      const text = f.text || "";
      if (fmt.keywords.some((k) => text.includes(k))) {
        found = true;
        foundFile = f.name;
        break;
      }
    }

    const status: CompletenessItem["status"] = found ? "complete" : "missing";
    items.push({
      formatId: fmt.id,
      formatName: fmt.name,
      required: "required",
      fileName: foundFile || "(未提供)",
      status,
      remark: found ? "已提供" : "投标文件未检索到对应内容",
    });

    // 缺失项生成 Issue（critical 级，因缺失投标文件格式可能直接废标）
    if (!found) {
      issues.push(makeIssue(
        bidder,
        `缺失投标文件格式-${fmt.id}`,
        `投标文件未检索到格式${fmt.id}《${fmt.name}》内容（关键词：${fmt.keywords.join("、")}）`,
        "critical",
        { file: bidder.files[0]?.name || bidder.name },
        `补充提供《${fmt.name}》，按招标文件格式${fmt.id}要求填写`,
        `招标文件第六部分-投标文件格式${fmt.id}`
      ));
    }
  }

  return { items, issues };
}

/** 从采购文件提取格式清单（若采购文件明确列出） */
function extractFormatsFromProcurement(procurement: UploadedFile) {
  const text = procurement.text || "";
  // 检测采购文件是否包含"投标文件格式"章节
  const hasFormatSection = /投标文件格式|格式一|格式二/.test(text);
  if (!hasFormatSection) return null;

  // 简化策略：仍使用默认 12 项清单，但可按采购文件实际内容裁剪
  // 此处可扩展：解析采购文件中实际列出的格式编号
  const presentFormats = FORMAT_LIST.filter((f) =>
    text.includes(`格式${f.id}`) || text.includes(f.name)
  );
  return presentFormats.length > 0 ? presentFormats : FORMAT_LIST;
}

function makeIssue(
  bidder: Bidder,
  name: string,
  description: string,
  riskLevel: "critical" | "major" | "minor" | "info" | "highlight",
  location: import("../types.js").IssueLocation,
  remediation: string,
  basis: string
): Issue {
  return {
    id: `completeness_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimension: "completeness",
    name: `${bidder.name} - ${name}`,
    riskLevel,
    location,
    description,
    basis,
    remediation,
  };
}

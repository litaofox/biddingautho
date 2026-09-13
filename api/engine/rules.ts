// 审查项规则库 - 定义报名资格、承诺条款、技术偏离等审查项
import type { ReviewItem } from "../types.js";

/**
 * 通用审查项规则库（scope: common）
 * 适用于大多数招标项目，固定不变
 * 每个审查项包含：名称、类别、关键词组、要求描述
 * 关键词组用于在投标文件中检索匹配
 */
export const reviewRules: ReviewItem[] = [
  // ========== 报名资格 ==========
  {
    id: "license",
    name: "营业执照",
    category: "qualification",
    scope: "common",
    expectedText: "提供有效的营业执照，经营范围包含本项目相关内容",
    keywords: ["营业执照", "经营范围", "统一社会信用代码", "企业法人营业执照"],
  },
  {
    id: "govproc22",
    name: "政府采购法第二十二条",
    category: "qualification",
    scope: "common",
    expectedText: "符合政府采购法第二十二条规定（财务、税收社保、设备能力、无重大违法记录）",
    keywords: ["政府采购法", "第二十二条", "重大违法记录", "社会保障资金", "税收", "依法缴纳"],
  },
  {
    id: "cert",
    name: "资质证书",
    category: "qualification",
    scope: "common",
    expectedText: "具备相应的资质证书（如 ISO 认证、行业资质等）",
    keywords: ["资质证书", "ISO", "体系认证", "资质等级", "认证证书"],
  },
  {
    id: "performance",
    name: "业绩证明",
    category: "qualification",
    scope: "common",
    expectedText: "提供近三年类似项目业绩证明",
    keywords: ["业绩", "类似项目", "合同", "中标通知书", "竣工验收"],
  },
  {
    id: "finance",
    name: "财务状况",
    category: "qualification",
    scope: "common",
    expectedText: "提供近三年财务审计报告，财务状况良好",
    keywords: ["财务", "审计报告", "资产负债", "利润", "净资产"],
  },

  // ========== 承诺条款 ==========
  {
    id: "validity",
    name: "投标有效期",
    category: "commitment",
    scope: "common",
    expectedText: "投标有效期满足采购文件要求",
    keywords: ["投标有效期", "有效期", "日历天"],
  },
  {
    id: "authorization",
    name: "授权委托书",
    category: "commitment",
    scope: "common",
    expectedText: "提供法定代表人授权委托书",
    keywords: ["授权委托书", "法定代表人", "授权", "法人授权"],
  },
  {
    id: "bidLetter",
    name: "投标函",
    category: "commitment",
    scope: "common",
    expectedText: "提供投标函并按要求签署",
    keywords: ["投标函", "投标书", "投标声明"],
  },
  {
    id: "quality",
    name: "质量保证",
    category: "commitment",
    scope: "common",
    expectedText: "承诺质量保证期满足采购文件要求",
    keywords: ["质量保证", "保修期", "质量保修", "质保期", "缺陷责任期"],
  },
  {
    id: "service",
    name: "售后服务",
    category: "commitment",
    scope: "common",
    expectedText: "提供完善的售后服务方案",
    keywords: ["售后服务", "维保", "维修", "服务方案", "响应时间"],
  },
  {
    id: "breach",
    name: "违约责任",
    category: "commitment",
    scope: "common",
    expectedText: "明确违约责任及赔偿条款",
    keywords: ["违约", "赔偿", "违约责任", "违约金", "索赔"],
  },
  {
    id: "confidentiality",
    name: "保密承诺",
    category: "commitment",
    scope: "common",
    expectedText: "承诺对项目涉及的信息保密，签订保密协议",
    keywords: ["保密", "保密协议", "保密承诺", "保密义务", "信息安全"],
  },
  {
    id: "integrity",
    name: "廉洁承诺",
    category: "commitment",
    scope: "common",
    expectedText: "承诺遵守廉洁从业规定，不进行商业贿赂",
    keywords: ["廉洁", "廉政", "反腐", "商业贿赂", "廉洁承诺"],
  },
  {
    id: "ipr",
    name: "知识产权",
    category: "commitment",
    scope: "common",
    expectedText: "承诺不侵犯第三方知识产权，成果知识产权归属明确",
    keywords: ["知识产权", "专利", "著作权", "版权", "侵权"],
  },
  {
    id: "acceptance",
    name: "履约验收",
    category: "commitment",
    scope: "common",
    expectedText: "承诺配合履约验收工作",
    keywords: ["验收", "履约", "竣工验收", "验收标准"],
  },

  // ========== 技术偏离 ==========
  {
    id: "params",
    name: "技术参数响应",
    category: "technical",
    scope: "common",
    expectedText: "对采购文件技术参数逐条响应，无负偏离",
    keywords: ["技术参数", "参数响应", "技术响应", "偏离表", "技术规格"],
  },
  {
    id: "scheme",
    name: "方案完整性",
    category: "technical",
    scope: "common",
    expectedText: "提供完整的技术方案",
    keywords: ["技术方案", "实施方案", "服务方案", "进度计划"],
  },
  {
    id: "deviation",
    name: "偏离标注",
    category: "technical",
    scope: "common",
    expectedText: "如有偏离需明确标注并说明",
    keywords: ["偏离", "正偏离", "负偏离", "无偏离", "偏离说明"],
  },
];

/**
 * 同义词映射 - 用于模糊匹配
 */
export const synonymMap: Record<string, string[]> = {
  营业执照: ["营业执照", "企业法人执照", "统一社会信用代码证"],
  资质证书: ["资质证书", "资质", "建筑业企业资质"],
  业绩: ["业绩", "类似项目", "过往项目", "工程业绩"],
  财务: ["财务", "审计", "资产负债", "利润表"],
  投标有效期: ["投标有效期", "有效期", "投标文件有效期"],
  "90天": ["90天", "九十天", "三个月", "90日历天"],
  质量保证: ["质量保证", "保修期", "质保期", "质量保修", "缺陷责任期"],
  售后服务: ["售后服务", "维保", "维修服务", "售后"],
  违约: ["违约", "违约责任", "违约金", "赔偿责任"],
  技术参数: ["技术参数", "参数响应", "技术规格", "技术指标"],
  施工组织: ["施工组织", "施工方案", "技术方案", "组织设计"],
  偏离: ["偏离", "正偏离", "负偏离", "无偏离", "偏差"],
};

/**
 * 根据用户选择的审查项 ID 过滤规则
 * @param ids 用户选中的审查项 ID 列表
 * @param allRules 完整的审查项列表（通用+项目+自定义），不传则使用通用规则
 */
export function getRulesByIds(ids: string[], allRules?: ReviewItem[]): ReviewItem[] {
  const source = allRules && allRules.length > 0 ? allRules : reviewRules;
  if (ids.length === 0) return source;
  return source.filter((r) => ids.includes(r.id));
}

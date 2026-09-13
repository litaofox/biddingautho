// 项目特有审查项提取模块
// 从采购文件/项目需求文本中自动识别项目特有的审查要求
import type { ReviewItem } from "../types.js";

/**
 * 从采购文件和项目需求文本中提取项目特有审查项
 * 采用规则匹配（正则+关键词），无需 LLM
 */
export function extractProjectRules(
  procurementText: string,
  projectReqText?: string
): ReviewItem[] {
  const text = (procurementText || "") + "\n" + (projectReqText || "");
  if (!text.trim()) return [];

  const items: ReviewItem[] = [];
  const seenNames = new Set<string>();

  // 去重辅助：精确名称去重 + 包含关系去重（如"提供XX方案"与"XX方案"视为重复）
  const addItem = (item: ReviewItem) => {
    if (seenNames.has(item.name)) return;
    // 检查是否与已有项存在包含关系（去除常见前缀后比较核心内容）
    const coreName = item.name.replace(/^(提供|承诺|须|应|必须|应当)/, "");
    for (const existing of items) {
      const existingCore = existing.name.replace(/^(提供|承诺|须|应|必须|应当)/, "");
      if (coreName === existingCore) return;
      // 核心内容较短且被已有项包含，视为重复
      if (coreName.length >= 4 && existingCore.includes(coreName)) return;
      if (existingCore.length >= 4 && coreName.includes(existingCore)) return;
    }
    seenNames.add(item.name);
    items.push(item);
  };

  // ========== 1. 提取"XXX方案"类审查项 ==========
  // 匹配"XX服务方案"、"XX管理方案"、"XX运维方案"等
  const schemePattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:服务|管理|运维|实施|技术|保障|应急|安全|数据|集成|知识库|培训|风险|转移|支持){1,4}方案)/g;
  const schemeMatches = text.match(schemePattern) || [];
  schemeMatches.forEach((rawName) => {
    // 去掉常见前缀（投标人须提供、投标人应提供、须提供、应提供、必须提供等）
    let name = rawName.replace(/^(投标人|供应商|服务商|乙方)?(须|应|必须|应当|承诺)?提供/, "");
    if (name.length < 4 || name.length > 30) return;
    addItem({
      id: `proj_scheme_${items.length}`,
      name,
      category: "technical",
      scope: "project",
      expectedText: `提供完整的${name}`,
      keywords: [name, name.replace("方案", "")],
    });
  });

  // ========== 2. 提取带★标记的条款 ==========
  const starPattern = /★\s*([\u4e00-\u9fa5A-Za-z0-9]{2,30})/g;
  let starMatch;
  while ((starMatch = starPattern.exec(text)) !== null) {
    let name = starMatch[1].trim();
    // 去掉末尾的"要求"，避免与"承诺"组合成"XXX要求承诺"
    name = name.replace(/要求$/, "");
    if (name.length >= 2 && name.length <= 30) {
      addItem({
        id: `proj_star_${items.length}`,
        name: `${name}承诺`,
        category: "commitment",
        scope: "project",
        expectedText: `承诺满足${name}要求`,
        keywords: [name, `★${name}`],
      });
    }
  }

  // ========== 3. 提取响应时间类要求 ==========
  // 匹配"7×24小时"、"7*24小时"、"XX分钟内响应"等
  if (/7\s*[×xX*]\s*24/.test(text) || /24\s*小时/.test(text)) {
    addItem({
      id: `proj_7x24_${items.length}`,
      name: "7×24小时响应服务",
      category: "commitment",
      scope: "project",
      expectedText: "承诺提供7×24小时响应服务",
      keywords: ["7×24", "7*24", "7x24", "24小时", "全天候"],
    });
  }

  // 提取具体响应时间数字（前面不能是 × * x，避免匹配 7×24 中的 24）
  const responsePattern = /(?<![×xX*])(\d+)\s*(分钟|小时|秒)\s*(内)?(响应|到达|解决|处理|反馈)/g;
  let respMatch;
  while ((respMatch = responsePattern.exec(text)) !== null) {
    const time = respMatch[1];
    const unit = respMatch[2];
    const action = respMatch[4];
    const name = `${time}${unit}内${action}`;
    addItem({
      id: `proj_resp_${items.length}`,
      name,
      category: "commitment",
      scope: "project",
      expectedText: `承诺${time}${unit}内${action}`,
      keywords: [`${time}${unit}`, `${time} ${unit}`, action],
    });
  }

  // ========== 4. 提取人员配置要求 ==========
  // 匹配"不少于XX人"、"至少XX名"、"XX名驻场"等
  const staffPattern = /(不少于|至少|不低于)?\s*(\d+)\s*(名|人|位)\s*(驻场|远程|项目经理|技术人员|服务人员|工程师)?/g;
  let staffMatch;
  while ((staffMatch = staffPattern.exec(text)) !== null) {
    const num = staffMatch[2];
    const role = staffMatch[4] || "人员";
    const prefix = staffMatch[1] || "";
    const name = `${prefix}${num}名${role}配置`;
    addItem({
      id: `proj_staff_${items.length}`,
      name,
      category: "qualification",
      scope: "project",
      expectedText: `配置${prefix}${num}名${role}`,
      keywords: [`${num}名`, `${num}人`, role, "驻场", "人员配置"],
    });
  }

  // ========== 5. 提取"承诺/须/应/必须"类强制要求 ==========
  // 强制词前必须是边界（开头、标点、空格）或投标人/供应商等前缀，避免"供应链"中的"应"被误匹配
  const mandatoryPattern = /(?:^|[，。、；：\s])(?:投标人|供应商|服务商|乙方)?\s*(?:须|应|必须|应当|承诺)\s*([\u4e00-\u9fa5A-Za-z0-9]{4,30})/g;
  let mandMatch;
  let mandCount = 0;
  while ((mandMatch = mandatoryPattern.exec(text)) !== null && mandCount < 15) {
    let name = mandMatch[1].trim();
    // 清理末尾的标点
    name = name.replace(/[，。、；：,.]+$/, "");
    // 清理开头残留的强制词（如"承诺"、"须"、"应"、"必须"）
    name = name.replace(/^(承诺|须|应|必须|应当)\s*/, "");
    if (name.length >= 4 && name.length <= 30) {
      addItem({
        id: `proj_mand_${items.length}`,
        name,
        category: "commitment",
        scope: "project",
        expectedText: `承诺满足：${name}`,
        keywords: [name],
      });
      mandCount++;
    }
  }

  // ========== 6. 提取"不得/禁止"类否决条款 ==========
  const forbidPattern = /(?:不得|禁止|不允许)\s*([\u4e00-\u9fa5A-Za-z0-9]{4,25})/g;
  let forbidMatch;
  while ((forbidMatch = forbidPattern.exec(text)) !== null) {
    let name = forbidMatch[1].trim();
    name = name.replace(/[，。、；：,.]+$/, "");
    if (name.length >= 4 && name.length <= 25) {
      addItem({
        id: `proj_forbid_${items.length}`,
        name: `不得${name}`,
        category: "commitment",
        scope: "project",
        expectedText: `承诺不得${name}`,
        keywords: [`不得${name}`, `禁止${name}`],
      });
    }
  }

  // 限制项目特有审查项数量，避免过多
  return items.slice(0, 50);
}

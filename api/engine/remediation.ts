// 整改清单生成模块（F7）
// 将所有 Issue 按 P0/P1/P2 三级优先级分组，并生成整改方案：
// - P0（递交前必须完成）：废标风险、数据矛盾、必填空白、占位符未填
// - P1（强烈建议完成）：扣分项、模板残留、联系方式、自评表争议
// - P2（时间允许时优化）：错别字、编号、页脚、表述优化
import type { Issue, RemediationPlan, RiskLevel } from "../types.js";

/** 风险等级 → 默认优先级映射 */
const RISK_TO_PRIORITY: Record<RiskLevel, "P0" | "P1" | "P2"> = {
  critical: "P0",
  major: "P1",
  minor: "P2",
  info: "P2",
  highlight: "P2",
};

/** 整改清单生成入口 */
export function buildRemediationPlan(issues: Issue[]): RemediationPlan {
  // 排除合规亮点（不进入整改清单）
  const actionable = issues.filter((i) => i.riskLevel !== "highlight");

  const p0: Issue[] = [];
  const p1: Issue[] = [];
  const p2: Issue[] = [];
  const manualCheck: string[] = [];

  for (const issue of actionable) {
    const priority = issue.priority || RISK_TO_PRIORITY[issue.riskLevel];
    // 给每条 Issue 补充 priority 字段
    issue.priority = priority;

    if (priority === "P0") p0.push(issue);
    else if (priority === "P1") p1.push(issue);
    else p2.push(issue);

    // 含"人工核验"的描述收集到 manualCheck
    if (issue.description.includes("人工核验") || issue.remediation?.includes("人工核验")) {
      manualCheck.push(`${issue.name}：${issue.description}`);
    }
  }

  return { p0, p1, p2, manualCheck };
}

/** 自动补充整改方案（若 Issue 缺失） */
export function ensureRemediation(issue: Issue): Issue {
  if (issue.remediation) return issue;
  return {
    ...issue,
    remediation: generateDefaultRemediation(issue),
  };
}

/** 基于问题类型与维度生成默认整改方案 */
function generateDefaultRemediation(issue: Issue): string {
  if (issue.remediation) return issue.remediation;

  switch (issue.dimension) {
    case "consistency":
      return "调取原始合同/证件/凭证，以原件为准统一全文口径";
    case "structure":
      return "按招标文件格式要求重新整理表格/补充填写缺失字段";
    case "template":
      return "清理模板残留内容，填入实际项目数据";
    case "signature":
      return "上传前用'●'关键词全文检索终验，所有必签处逐一确认电子签章覆盖";
    case "textFlaw":
      return "修订文本错误，统一编号格式";
    case "qualification":
      return "补充提供缺失的资格证明材料";
    case "substantive":
      return "逐条对照★实质性条款，补全书面承诺并加盖公章";
    case "completeness":
      return "按招标文件格式清单补齐缺失文件";
    default:
      return "对照招标文件要求整改";
  }
}

/** 批量补充整改方案 */
export function ensureAllRemediation(issues: Issue[]): Issue[] {
  return issues.map(ensureRemediation);
}

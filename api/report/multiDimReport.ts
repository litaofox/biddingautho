// 多维审核报告生成模块（F10）
// 对齐参考报告的 HTML 结构与风险分级展示：
// 一、整体核查结论（风险总览 + 各类问题计数）
// 二、高危废标问题（critical 级 Issue）
// 三、评标扣分问题（major 级 Issue）
// 四、细节优化问题（minor 级 Issue）
// 五、合规亮点梳理（highlight 级 Issue）
// 六、最终整改清单（P0/P1/P2 + 整改方案）
// 七、待补充核查（人工核验项）
// 八、投标文件完整性对照表
import type {
  CompletenessItem,
  Issue,
  MultiDimReviewResult,
  RiskLevel,
  Task,
} from "../types.js";

interface MultiDimExportOptions {
  /** 整体结论 */
  summary?: boolean;
  /** 高危废标问题 */
  critical?: boolean;
  /** 评标扣分问题 */
  major?: boolean;
  /** 细节优化问题 */
  minor?: boolean;
  /** 合规亮点 */
  highlights?: boolean;
  /** 整改清单 */
  remediation?: boolean;
  /** 待补充核查 */
  manualCheck?: boolean;
  /** 完整性对照表 */
  completeness?: boolean;
}

const riskLabelMap: Record<RiskLevel, { label: string; color: string; bg: string }> = {
  critical: { label: "准高危", color: "#dc2626", bg: "#fef2f2" },
  major: { label: "扣分项", color: "#ea580c", bg: "#fff7ed" },
  minor: { label: "细节优化", color: "#ca8a04", bg: "#fefce8" },
  info: { label: "提示", color: "#2563eb", bg: "#eff6ff" },
  highlight: { label: "合规亮点", color: "#16a34a", bg: "#f0fdf4" },
};

const dimensionLabelMap: Record<string, string> = {
  qualification: "资格合规",
  substantive: "实质性条款",
  consistency: "数据一致性",
  structure: "结构规范",
  template: "模板残留",
  signature: "签字盖章",
  textFlaw: "文本瑕疵",
  highlight: "合规亮点",
  completeness: "完整性对照",
};

/** 生成多维审核 HTML 报告 */
export function generateMultiDimReport(
  task: Task,
  result: MultiDimReviewResult,
  options: MultiDimExportOptions
): string {
  const now = new Date().toLocaleString("zh-CN");
  const modeLabel = result.mode === "llm" ? "LLM 智能审核" : "本地规则审核";
  const modeColor = result.mode === "llm" ? "#7c3aed" : "#2563eb";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>投标文件全方位审核报告</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; background: #f6f7f9; color: #1f2937; padding: 24px; line-height: 1.75; }
  .wrap { max-width: 1080px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 40px 48px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
  h1 { font-size: 26px; border-bottom: 3px solid #1e40af; padding-bottom: 12px; color: #1e3a8a; }
  h2 { font-size: 20px; color: #fff; background: #1e40af; padding: 8px 14px; border-radius: 6px; margin-top: 40px; }
  h3 { font-size: 17px; color: #1e3a8a; margin-top: 28px; border-left: 4px solid #3b82f6; padding-left: 10px; }
  .meta { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px 20px; font-size: 14px; }
  .meta b { color: #1e40af; }
  .verdict { border-radius: 10px; padding: 18px 22px; font-size: 15px; margin: 20px 0; }
  .v-warn { background: #fffbeb; border: 1.5px solid #f59e0b; }
  .v-danger { background: #fef2f2; border: 1.5px solid #dc2626; }
  .v-ok { background: #f0fdf4; border: 1.5px solid #16a34a; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13.5px; }
  th { background: #1e40af; color: #fff; padding: 8px 10px; text-align: left; }
  td { border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .risk-h { color: #dc2626; font-weight: bold; white-space: nowrap; }
  .risk-m { color: #ea580c; font-weight: bold; white-space: nowrap; }
  .risk-l { color: #ca8a04; font-weight: bold; white-space: nowrap; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; margin-right: 6px; }
  .tag-b { background: #fee2e2; color: #b91c1c; }
  .tag-k { background: #ffedd5; color: #c2410c; }
  .tag-d { background: #fefce8; color: #a16207; }
  .tag-g { background: #dcfce7; color: #15803d; }
  .loc { color: #7c3aed; font-weight: 600; }
  .todo { background: #fefce8; border-left: 4px solid #eab308; padding: 10px 14px; border-radius: 0 6px 6px 0; margin: 10px 0; font-size: 14px; }
  ul { padding-left: 22px; } li { margin: 4px 0; }
  .footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 12.5px; color: #6b7280; }
  .mode-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; color: #fff; }
  @media print { body { background: #fff; padding: 0; } .wrap { box-shadow: none; } }
</style>
</head>
<body>
<div class="wrap">

<h1>投标文件全方位审核报告</h1>
<p style="text-align:center;margin:20px 0;">
  <span class="mode-badge" style="background:${modeColor}">${modeLabel}</span>
</p>

<div class="meta">
  <p><b>采购文件：</b>${task.procurement.name}　<b>投标公司数：</b>${result.bidders.length} 家</p>
  <p><b>投标人：</b>${result.bidders.join("、")}　<b>生成时间：</b>${now}</p>
</div>

${renderSummary(result, options)}
${renderCriticalIssues(result, options)}
${renderMajorIssues(result, options)}
${renderMinorIssues(result, options)}
${renderHighlights(result, options)}
${renderRemediation(result, options)}
${renderManualCheck(result, options)}
${renderCompleteness(result, options)}

<div class="footer">
  审核方法说明：本报告由多维审核引擎自动生成，覆盖数据一致性、结构规范性、模板残留、签字盖章、文本瑕疵、合规亮点、完整性对照等维度。所有问题判定均标注招标文件依据，未采信主观推断。图片类佐证材料（签章、证书、合同、截图）无法通过文本层核验，已列入"待补充核查"。<br>
  本报告仅供参考，最终结论以人工复核为准。
</div>

</div>
</body>
</html>`;
}

/** 一、整体核查结论 */
function renderSummary(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.summary === false) return "";
  const verdictClass =
    result.summary.overallRisk === "high" ? "v-danger" :
    result.summary.overallRisk === "medium" ? "v-warn" : "v-ok";
  return `
  <h2>一、整体核查结论</h2>
  <div class="verdict ${verdictClass}">
    <b>结论：${result.summary.conclusion}</b>
    <ul>
      <li><b>问题合计：</b>
        <span class="tag tag-b">准高危 ${result.summary.criticalCount}</span>
        <span class="tag tag-k">扣分项 ${result.summary.majorCount}</span>
        <span class="tag tag-d">细节优化 ${result.summary.minorCount}</span>
        <span class="tag tag-g">合规亮点 ${result.summary.highlightCount}</span>
      </li>
      <li><b>整体风险等级：</b>${result.summary.overallRisk === "high" ? "高" : result.summary.overallRisk === "medium" ? "中" : "低"}</li>
    </ul>
  </div>`;
}

/** 二、高危废标问题 */
function renderCriticalIssues(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.critical === false) return "";
  const issues = result.issues.filter((i) => i.riskLevel === "critical");
  if (issues.length === 0) return "";
  return `
  <h2>二、高危废标问题（一票否决风险项）</h2>
  ${issues.map((i, idx) => renderIssueBlock(i, idx + 1, "risk-h")).join("")}`;
}

/** 三、评标扣分问题 */
function renderMajorIssues(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.major === false) return "";
  const issues = result.issues.filter((i) => i.riskLevel === "major");
  if (issues.length === 0) return "";
  return `
  <h2>三、评标扣分问题（失分项）</h2>
  ${issues.map((i, idx) => renderIssueBlock(i, idx + 1, "risk-m")).join("")}`;
}

/** 四、细节优化问题 */
function renderMinorIssues(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.minor === false) return "";
  const issues = result.issues.filter((i) => i.riskLevel === "minor" || i.riskLevel === "info");
  if (issues.length === 0) return "";
  return `
  <h2>四、细节优化问题（提升项）</h2>
  <table>
    <tr><th style="width:4%">#</th><th style="width:30%">位置</th><th>问题及优化建议</th></tr>
    ${issues.map((i, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><span class="loc">${formatLocation(i)}</span></td>
        <td>
          <b>${i.name}</b>：${i.description}
          ${i.remediation ? `<br><b>整改：</b>${i.remediation}` : ""}
        </td>
      </tr>`).join("")}
  </table>`;
}

/** 五、合规亮点梳理 */
function renderHighlights(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.highlights === false) return "";
  if (result.highlights.length === 0) return "";
  return `
  <h2>五、合规亮点梳理（保留并强化）</h2>
  <div class="verdict v-ok">
    <ul>
      ${result.highlights.map((h) => `
        <li><b>${h.name}：</b>${h.description}</li>
      `).join("")}
    </ul>
  </div>`;
}

/** 六、最终整改清单 */
function renderRemediation(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.remediation === false) return "";
  const plan = result.remediationPlan;
  return `
  <h2>六、最终整改清单（按优先级执行）</h2>
  ${plan.p0.length > 0 ? `
    <h3>P0 — 递交前必须完成（否则有无效/失分风险）</h3>
    <ol>
      ${plan.p0.map((i) => `<li><b>${i.name}</b>：${i.description}${i.remediation ? `<br>　<b>整改：</b>${i.remediation}` : ""}</li>`).join("")}
    </ol>` : ""}
  ${plan.p1.length > 0 ? `
    <h3>P1 — 强烈建议完成（直接关系得分）</h3>
    <ol start="${plan.p0.length + 1}">
      ${plan.p1.map((i) => `<li><b>${i.name}</b>：${i.description}${i.remediation ? `<br>　<b>整改：</b>${i.remediation}` : ""}</li>`).join("")}
    </ol>` : ""}
  ${plan.p2.length > 0 ? `
    <h3>P2 — 时间允许时优化</h3>
    <ol start="${plan.p0.length + plan.p1.length + 1}">
      ${plan.p2.map((i) => `<li><b>${i.name}</b>：${i.description}</li>`).join("")}
    </ol>` : ""}`;
}

/** 七、待补充核查 */
function renderManualCheck(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.manualCheck === false) return "";
  if (result.remediationPlan.manualCheck.length === 0) return "";
  return `
  <h2>七、待补充核查（需人工核对扫描件/原件后确认）</h2>
  <div class="todo">
    <ul>
      ${result.remediationPlan.manualCheck.map((c) => `<li>${c}</li>`).join("")}
    </ul>
  </div>`;
}

/** 八、投标文件完整性对照表 */
function renderCompleteness(result: MultiDimReviewResult, options: MultiDimExportOptions): string {
  if (options.completeness === false) return "";
  if (result.completeness.length === 0) return "";
  const half = Math.ceil(result.completeness.length / 2);
  const left = result.completeness.slice(0, half);
  const right = result.completeness.slice(half);
  return `
  <h2>八、投标文件完整性对照</h2>
  <table>
    <tr><th>格式</th><th>文件</th><th>状态</th><th>格式</th><th>文件</th><th>状态</th></tr>
    ${left.map((l, idx) => {
      const r = right[idx];
      return `<tr>
        <td>${l.formatId}</td><td>${l.formatName}</td><td>${renderCompletenessStatus(l.status)}</td>
        <td>${r ? r.formatId : ""}</td><td>${r ? r.formatName : ""}</td><td>${r ? renderCompletenessStatus(r.status) : ""}</td>
      </tr>`;
    }).join("")}
  </table>`;
}

function renderCompletenessStatus(status: CompletenessItem["status"]): string {
  if (status === "complete") return "✓ 已提供";
  if (status === "partial") return "△ 部分提供";
  return "✗ 缺失";
}

/** 单条 Issue 详细区块（用于 critical/major） */
function renderIssueBlock(issue: Issue, idx: number, riskClass: string): string {
  const dim = dimensionLabelMap[issue.dimension] || issue.dimension;
  return `
  <h3>${idx}. ${issue.name} <span class="${riskClass}">${riskLabelMap[issue.riskLevel].label}</span></h3>
  <p><span class="${riskClass}">风险等级：${riskLabelMap[issue.riskLevel].label}</span>　<span class="loc">位置：${formatLocation(issue)}</span>　<span class="tag tag-d">${dim}</span></p>
  <p>${issue.description}</p>
  ${issue.evidence ? `<p><b>证据：</b>${issue.evidence}</p>` : ""}
  ${issue.basis ? `<p><b>违反依据：</b>${issue.basis}</p>` : ""}
  ${issue.remediation ? `<p><b>整改方案：</b>${issue.remediation}</p>` : ""}`;
}

/** 格式化位置字符串 */
function formatLocation(issue: Issue): string {
  const loc = issue.location;
  const parts: string[] = [loc.file];
  if (loc.chapter) parts.push(loc.chapter);
  if (loc.page) parts.push(`第${loc.page}页`);
  if (loc.tableId) parts.push(loc.tableId);
  if (loc.tableRow !== undefined) parts.push(`第${loc.tableRow}行`);
  return parts.join("・");
}

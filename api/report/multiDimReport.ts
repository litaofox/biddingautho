// 多维审核报告生成模块（F10）
// 章节结构：
// 一、整体核查结论（风险总览 + 各类问题计数 + 模拟总分）
// 二、投标文件完整性对照表（编号/文件名称/要求提交状态/实际提交状态/检查结果/备注）
// 三、评分索引与逐项打分（严格依据招标文件评分办法，评分依据可折叠展开）
// 四、高危废标问题（critical 级 Issue）
// 五、评标扣分问题（major 级 Issue）
// 六、细节优化问题（minor / info 级 Issue）
// 七、合规亮点梳理（highlight 级 Issue）
// 八、最终整改清单（P0/P1/P2 + 整改方案）
// 九、待补充核查（人工核验项，含系统事实校验存疑事项）
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

/** 章节动态编号：废标风险项存在时插入为第二章，其余章节顺延，保证编号连续 */
type SecKey =
  | "summary" | "rejection" | "completeness" | "scoring" | "critical"
  | "major" | "minor" | "highlights" | "remediation" | "manual";

function rejectionIssuesOf(result: MultiDimReviewResult): Issue[] {
  return (result.issues || []).filter((i) => i.riskLevel === "critical" && i.rejection);
}

function sectionNumbers(
  result: MultiDimReviewResult,
  options: MultiDimExportOptions
): Record<SecKey, number | undefined> {
  const nonRejCritical = (result.issues || []).filter((i) => i.riskLevel === "critical" && !i.rejection).length;
  const majorCnt = (result.issues || []).filter((i) => i.riskLevel === "major").length;
  const minorCnt = (result.issues || []).filter((i) => i.riskLevel === "minor" || i.riskLevel === "info").length;
  const presence: [SecKey, boolean][] = [
    ["summary", options.summary !== false],
    ["rejection", options.critical !== false && rejectionIssuesOf(result).length > 0],
    ["completeness", options.completeness !== false && (result.completeness || []).length > 0],
    ["critical", options.critical !== false && nonRejCritical > 0],
    ["major", options.major !== false && majorCnt > 0],
    ["minor", options.minor !== false && minorCnt > 0],
    ["highlights", options.highlights !== false && (result.highlights || []).length > 0],
    ["remediation", options.remediation !== false],
    ["manual", options.manualCheck !== false && (result.remediationPlan?.manualCheck || []).length > 0],
    // 模拟打分为可选增值内容，统一置于全部审查内容之后（末章）；无评分项时不渲染（避免出现空的占位章）
    ["scoring", (result.scoringIndex || []).length > 0],
  ];
  const out: Partial<Record<SecKey, number>> = {};
  let seq = 0;
  presence.forEach(([k, ok]) => {
    if (ok) out[k] = ++seq;
  });
  return out as Record<SecKey, number | undefined>;
}

/** 生成多维审核 HTML 报告 */
export function generateMultiDimReport(
  task: Task,
  result: MultiDimReviewResult,
  options: MultiDimExportOptions
): string {
  const now = new Date().toLocaleString("zh-CN");
  const modeLabel = result.mode === "llm" ? "LLM 智能审核" : "本地规则审核";
  const modeColor = result.mode === "llm" ? "#7c3aed" : "#2563eb";
  const sec = sectionNumbers(result, options);
  const rejNo = sec.rejection;

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
  /* 折叠/展开样式 */
  details { border: 1px solid #e5e7eb; border-radius: 8px; margin: 12px 0; overflow: hidden; }
  details > summary { list-style: none; cursor: pointer; padding: 12px 16px; background: #f8fafc; display: flex; align-items: center; gap: 8px; font-size: 14.5px; transition: background .15s; }
  details > summary:hover { background: #f1f5f9; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary::before { content: "▶"; font-size: 11px; color: #64748b; transition: transform .15s; flex-shrink: 0; }
  details[open] > summary::before { transform: rotate(90deg); }
  details .issue-body { padding: 12px 16px; border-top: 1px solid #e5e7eb; font-size: 14px; }
  details .issue-body p { margin: 6px 0; }
  summary .issue-title { flex: 1; }
  summary .issue-meta { font-size: 12.5px; color: #64748b; }
  /* 整改清单折叠 */
  .remed-item details { margin: 8px 0; border: 1px solid #fde68a; }
  .remed-item details > summary { background: #fffbeb; }
  .remed-item details > summary:hover { background: #fef3c7; }
  .score-table th { background: #047857; }
  .score-detail summary { background: #ecfdf5; }
  .score-detail summary:hover { background: #d1fae5; }
  .score-total { background: #ecfdf5 !important; font-weight: bold; }
  .score-total td { background: #ecfdf5 !important; }
  .score-badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; }
  .b-manual { background: #fef3c7; color: #92400e; }
  .b-fact { background: #dbeafe; color: #1d4ed8; }
  /* 废标项（暗红） */
  .tag-rj { background: #7f1d1d; color: #fff; font-weight: bold; }
  .h2-rejection { background: #7f1d1d !important; }
  .rejection-box { background: #7f1d1d; color: #fff; border-radius: 8px; padding: 10px 14px; font-weight: bold; margin: 10px 0; }
  .rejection-item { border: 1.5px solid #7f1d1d; background: #fef2f2; border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
  .rejection-item summary { background: #fee2e2 !important; }
  .rejection-item .risk-h { color: #7f1d1d; }
  .evidence-box { background:#f8fafc; border-left:3px solid #047857; padding:8px 12px; border-radius:0 6px 6px 0; font-size:13px; color:#334155; white-space:pre-wrap; margin:6px 0; }
  .c-required { color:#b91c1c; font-weight:600; }
  .c-optional { color:#6b7280; }
  .st-complete { color:#15803d; font-weight:600; white-space:nowrap; }
  .st-partial { color:#c2410c; font-weight:600; white-space:nowrap; }
  .st-missing { color:#b91c1c; font-weight:600; white-space:nowrap; }
  @media print { body { background: #fff; padding: 0; } .wrap { box-shadow: none; } details[open] > summary::before { content: "▼"; } }
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

${renderSummary(result, options, sec.summary, rejNo)}
${renderRejectionIssues(result, options, sec.rejection)}
${renderCompleteness(result, options, sec.completeness)}
${renderCriticalIssues(result, options, sec.critical)}
${renderMajorIssues(result, options, sec.major)}
${renderMinorIssues(result, options, sec.minor)}
${renderHighlights(result, options, sec.highlights)}
${renderRemediation(result, options, sec.remediation)}
${renderManualCheck(result, options, sec.manual)}
${renderScoringIndex(result, options, sec.scoring)}

<div class="footer">
  审核方法说明：本报告由多维审核引擎自动生成，覆盖资格合规、实质性条款（含采购要求逐条响应比对）、数据一致性、结构规范性、模板残留、签字盖章、文本瑕疵、完整性对照、评分标准逐项打分等维度。生成过程已注入审核基准日期并对模型输出执行系统事实校验（日期断言复核、证据原文溯源），存疑断言一律降级为"待人工核验"，未采信无原文支撑的主观推断。图片类佐证材料（签章、证书、合同、截图）无法通过文本层核验，已列入"待补充核查"。<br>
  评分为依据投标文件文本响应情况的模拟评估，分值与评分依据均关联招标文件评分条款及投标原文引用，<b>最终得分以评标委员会评审为准</b>。本报告仅供参考，最终结论以人工复核为准。
</div>

</div>
</body>
</html>`;
}

/** 一、整体核查结论 */
function renderSummary(
  result: MultiDimReviewResult,
  options: MultiDimExportOptions,
  no?: number,
  rejNo?: number
): string {
  if (options.summary === false) return "";
  const verdictClass =
    result.summary.overallRisk === "high" ? "v-danger" :
    result.summary.overallRisk === "medium" ? "v-warn" : "v-ok";
  const hasEstScore =
    typeof result.summary.estimatedScore === "number" &&
    typeof result.summary.estimatedFullScore === "number" &&
    (result.summary.estimatedFullScore || 0) > 0;
  const rejCount = rejectionIssuesOf(result).length;
  return `
  <h2>${no ?? 1}、整体核查结论</h2>
  <div class="verdict ${verdictClass}">
    <b>结论：${result.summary.conclusion}</b>
    ${rejCount > 0 ? `<p class="rejection-box">⚠ 检出 ${rejCount} 项废标风险：命中招标文件否决条款，按现行投标文件状态将被否决/废标${rejNo ? `（详见第${rejNo}章）` : ""}，必须在递交前完成整改并复核</p>` : ""}
    <ul>
      <li><b>问题合计：</b>
        <span class="tag tag-b">准高危 ${result.summary.criticalCount}</span>
        <span class="tag tag-k">扣分项 ${result.summary.majorCount}</span>
        <span class="tag tag-d">细节优化 ${result.summary.minorCount}</span>
        <span class="tag tag-g">合规亮点 ${result.summary.highlightCount}</span>
      </li>
      <li><b>整体风险等级：</b>${result.summary.overallRisk === "high" ? "高" : result.summary.overallRisk === "medium" ? "中" : "低"}</li>
      ${hasEstScore ? `<li><b>依据评分标准模拟总分：</b><span style="color:#047857;font-size:16px;font-weight:bold;">${result.summary.estimatedScore}</span> / ${result.summary.estimatedFullScore} 分（详见评分索引章，最终以评标委员会评审为准）</li>` : ""}
    </ul>
  </div>`;
}

/** 二、废标风险项（暗红分区，定性为废标，置于报告最前部） */
function renderRejectionIssues(
  result: MultiDimReviewResult,
  options: MultiDimExportOptions,
  no?: number
): string {
  if (options.critical === false) return "";
  const issues = rejectionIssuesOf(result);
  if (issues.length === 0 || !no) return "";
  return `
  <h2 class="h2-rejection">${no}、废标风险项（命中否决条款，按招标文件规定将被认定废标）</h2>
  <p style="font-size:13px;color:#7f1d1d;margin:8px 0;font-weight:bold;">
    以下问题命中招标文件/政府采购法定否决条款（如多处报价不一致、大小写金额不符、未实质性响应等），
    按招标文件"以大写金额为准""报价唯一性"等规定，评标委员会将认定投标无效/废标。必须在投标递交前逐项整改，并复核所有报价表原件。
  </p>
  ${issues.map((i, idx) => renderIssueBlock(i, idx + 1, "risk-h", true)).join("")}`;
}

/** 高危问题（准高危，非废标项；折叠/展开） */
function renderCriticalIssues(result: MultiDimReviewResult, options: MultiDimExportOptions, no?: number): string {
  if (options.critical === false) return "";
  const issues = result.issues.filter((i) => i.riskLevel === "critical" && !i.rejection);
  if (issues.length === 0) return "";
  return `
  <h2>${no}、高危问题（一票否决风险项）</h2>
  ${issues.map((i, idx) => renderIssueBlock(i, idx + 1, "risk-h")).join("")}`;
}

/** 评标扣分问题（折叠/展开） */
function renderMajorIssues(result: MultiDimReviewResult, options: MultiDimExportOptions, no?: number): string {
  if (options.major === false) return "";
  const issues = result.issues.filter((i) => i.riskLevel === "major");
  if (issues.length === 0) return "";
  return `
  <h2>${no}、评标扣分问题（失分项）</h2>
  ${issues.map((i, idx) => renderIssueBlock(i, idx + 1, "risk-m")).join("")}`;
}

/** 细节优化问题 */
function renderMinorIssues(result: MultiDimReviewResult, options: MultiDimExportOptions, no?: number): string {
  if (options.minor === false) return "";
  const issues = result.issues.filter((i) => i.riskLevel === "minor" || i.riskLevel === "info");
  if (issues.length === 0) return "";
  return `
  <h2>${no}、细节优化问题（提升项）</h2>
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

/** 合规亮点梳理 */
function renderHighlights(result: MultiDimReviewResult, options: MultiDimExportOptions, no?: number): string {
  if (options.highlights === false) return "";
  if (result.highlights.length === 0) return "";
  return `
  <h2>${no}、合规亮点梳理（保留并强化）</h2>
  <div class="verdict v-ok">
    <ul>
      ${result.highlights.map((h) => `
        <li><b>${h.name}：</b>${h.description}</li>
      `).join("")}
    </ul>
  </div>`;
}

/** 最终整改清单（仅显示标题，详情折叠展开，避免与问题内容重复） */
function renderRemediation(result: MultiDimReviewResult, options: MultiDimExportOptions, no?: number): string {
  if (options.remediation === false) return "";
  const plan = result.remediationPlan;
  return `
  <h2>${no}、最终整改清单（按优先级执行）</h2>
  <div class="remed-item">
  ${plan.p0.length > 0 ? `
    <h3>P0 — 递交前必须完成（否则有无效/失分风险）</h3>
    ${plan.p0.map((i) => renderRemedItem(i)).join("")}` : ""}
  ${plan.p1.length > 0 ? `
    <h3>P1 — 强烈建议完成（直接关系得分）</h3>
    ${plan.p1.map((i) => renderRemedItem(i)).join("")}` : ""}
  ${plan.p2.length > 0 ? `
    <h3>P2 — 时间允许时优化</h3>
    ${plan.p2.map((i) => renderRemedItem(i)).join("")}` : ""}
  </div>`;
}

/** 单条整改项：标题可点击展开详情 */
function renderRemedItem(i: { name: string; description: string; remediation?: string }): string {
  const hasDetail = i.description || i.remediation;
  if (!hasDetail) {
    return `<div class="remed-item" style="padding:8px 12px;margin:6px 0;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;"><b>${i.name}</b></div>`;
  }
  return `<details>
    <summary><span class="issue-title"><b>${i.name}</b></span><span class="issue-meta">点击展开详情</span></summary>
    <div class="issue-body">
      ${i.description ? `<p>${i.description}</p>` : ""}
      ${i.remediation ? `<p><b>整改方案：</b>${i.remediation}</p>` : ""}
    </div>
  </details>`;
}

/** 待补充核查 */
function renderManualCheck(result: MultiDimReviewResult, options: MultiDimExportOptions, no?: number): string {
  if (options.manualCheck === false) return "";
  if (result.remediationPlan.manualCheck.length === 0) return "";
  return `
  <h2>${no}、待补充核查（需人工核对扫描件/原件/事实存疑项后确认）</h2>
  <div class="todo">
    <ul>
      ${result.remediationPlan.manualCheck.map((c) => `<li>${c}</li>`).join("")}
    </ul>
  </div>`;
}

/** 投标文件完整性对照表（紧随整体结论，便于开篇查阅） */
function renderCompleteness(result: MultiDimReviewResult, options: MultiDimExportOptions, no?: number): string {
  if (options.completeness === false) return "";
  if (result.completeness.length === 0) return "";
  const missing = result.completeness.filter((c) => c.status === "missing").length;
  const partial = result.completeness.filter((c) => c.status === "partial").length;
  const complete = result.completeness.filter((c) => c.status === "complete").length;
  return `
  <h2>${no}、投标文件完整性对照</h2>
  <p style="font-size:13px;color:#6b7280;margin:8px 0;">
    以采购文件"投标文件格式/组成"要求为基准逐项对照：
    <span class="st-complete">完整 ${complete}</span> 项，
    <span class="st-partial">部分提供 ${partial}</span> 项，
    <span class="st-missing">缺失 ${missing}</span> 项。
  </p>
  <table>
    <tr>
      <th style="width:8%">编号</th>
      <th style="width:22%">文件名称</th>
      <th style="width:12%">要求提交状态</th>
      <th style="width:22%">实际提交状态</th>
      <th style="width:12%">完整性检查结果</th>
      <th style="width:24%">备注</th>
    </tr>
    ${result.completeness.map((c) => `
      <tr>
        <td>${escapeHtml(c.formatId || "—")}</td>
        <td><b>${escapeHtml(c.formatName)}</b></td>
        <td class="${c.required === "optional" ? "c-optional" : "c-required"}">${c.required === "optional" ? "按需提交" : "要求必交"}</td>
        <td>${c.status === "missing" ? '<span class="st-missing">未提交</span>' : escapeHtml(c.fileName || "已提交")}</td>
        <td>${renderCompletenessStatus(c.status)}</td>
        <td style="font-size:12.5px;color:#4b5563;">${escapeHtml(c.remark || "")}</td>
      </tr>`).join("")}
  </table>`;
}

function renderCompletenessStatus(status: CompletenessItem["status"]): string {
  if (status === "complete") return '<span class="st-complete">✓ 完整</span>';
  if (status === "partial") return '<span class="st-partial">△ 部分提供/内容空泛</span>';
  return '<span class="st-missing">✗ 缺失</span>';
}

/** 单条 Issue 详细区块（折叠/展开：标题行常驻，详情点击展开）；isRejection=true 时以废标项暗红展示 */
function renderIssueBlock(issue: Issue, idx: number, riskClass: string, isRejection = false): string {
  const dim = dimensionLabelMap[issue.dimension] || issue.dimension;
  const factBadge =
    issue.factFlag === "date-disputed"
      ? '<span class="score-badge b-fact">事实存疑·已转人工核验</span>'
      : issue.factFlag === "evidence-unverified"
      ? '<span class="score-badge b-fact">证据待核验</span>'
      : "";
  const levelBadge = isRejection
    ? '<span class="tag tag-rj">废标项</span>'
    : `<span class="${riskClass}">${riskLabelMap[issue.riskLevel].label}</span>`;
  return `
  <details${isRejection ? ' class="rejection-item"' : ""}>
    <summary>
      <span class="issue-title"><b>${idx}. ${issue.name}</b></span>
      <span class="issue-meta">
        ${levelBadge}
        　<span class="loc">${formatLocation(issue)}</span>
        　<span class="tag tag-d">${dim}</span>
        ${factBadge ? `　${factBadge}` : ""}
      </span>
    </summary>
    <div class="issue-body">
      <p>${issue.description}</p>
      ${issue.evidence ? `<p><b>证据：</b>${issue.evidence}</p>` : ""}
      ${issue.basis ? `<p><b>违反依据：</b>${issue.basis}</p>` : ""}
      ${issue.remediation ? `<p><b>整改方案：</b>${issue.remediation}</p>` : ""}
      ${isRejection ? `<p style="color:#7f1d1d;font-weight:bold;">※ 本项命中否决条款：按招标文件规定，投标文件将被认定为废标/无效投标，必须整改后方可递交。</p>` : ""}
    </div>
  </details>`;
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

/** 三、评分索引与逐项打分
 *  数据来源：招标文件评分办法原文抽取的结构化评分项（result.scoringIndex），
 *  每项含 LLM 依据投标原文作出的评分、引用位置（章节/页码/段落）、证据原文与评分说明。
 *  概览表常驻，逐项评分依据与详细说明折叠展开。
 */
function renderScoringIndex(
  result: MultiDimReviewResult,
  _options: MultiDimExportOptions,
  no?: number
): string {
  const entries = result.scoringIndex || [];
  // 本地规则模式不产出评分索引，隐藏本章；LLM 模式下即使抽取为空也保留章节并显式提示人工核查，避免章节缺位
  if (entries.length === 0) {
    if (result.mode !== "llm") return "";
    return `
  <h2>${no}、评分索引与逐项打分</h2>
  <div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:8px;padding:14px 18px;margin:12px 0;">
    <p style="margin:0 0 6px;color:#92400e;font-weight:bold;">⚠ 未能自动抽取到结构化评分项，本章未完成逐项打分</p>
    <p style="margin:0;font-size:13.5px;color:#78350f;">
      系统已尝试定位招标文件中的评标办法/评分标准章节（评分细则、评审因素及分值表等），但未能解析出可逐项打分的评分项，
      常见原因：评分办法位于扫描图片页、分值表为复杂表格或目录定位偏差。
      请人工打开招标文件查阅评分办法章节（通常标题含“评分标准/评分细则/评审因素”等），按原文分值表逐项对照投标文件评分；
      本事项已同步列入第九章“待人工核查事项”。重新上传文字版（非扫描件）招标文件后再次运行审核可自动完成本章。
    </p>
  </div>`;
  }

  const totalFull = entries.reduce((s, e) => s + e.fullScore, 0);
  const assessed = entries.filter((e) => e.assessment);
  const totalGot = assessed.reduce((s, e) => s + (e.assessment?.score || 0), 0);
  const scoreRate = totalFull > 0 ? Math.round((totalGot / totalFull) * 100) : 0;
  const manualCount = assessed.filter((e) => e.assessment?.needManualCheck).length;

  const overviewRows = entries
    .map((e, idx) => {
      const a = e.assessment;
      const score = a ? a.score : null;
      const rate = e.fullScore > 0 && score !== null ? Math.round((score / e.fullScore) * 100) : null;
      const color =
        score === null ? "#9ca3af" :
        rate === 100 ? "#16a34a" :
        (rate || 0) >= 60 ? "#ea580c" : "#dc2626";
      return `
      <tr>
        <td style="text-align:center;">${escapeHtml(e.code || String(idx + 1))}</td>
        <td><b>${escapeHtml(e.name)}</b><br><span style="font-size:12px;color:#6b7280;">${escapeHtml(e.category)}</span></td>
        <td style="text-align:center;">${e.weight}%</td>
        <td style="text-align:center;">${e.fullScore}</td>
        <td style="text-align:center;"><b style="color:${color}">${score === null ? "待评分" : score}</b></td>
        <td style="text-align:center;">${rate === null ? "—" : rate + "%"}</td>
        <td style="font-size:12.5px;">${a ? escapeHtml(a.bidChapter || "未定位章节") + (a.bidPage ? `（第${a.bidPage}页）` : "") : "—"}</td>
        <td style="text-align:center;">${a?.needManualCheck ? '<span class="score-badge b-manual">需人工复核</span>' : "—"}</td>
      </tr>`;
    })
    .join("");

  const detailBlocks = entries
    .map((e, idx) => {
      const a = e.assessment;
      const score = a ? a.score : null;
      const rate = e.fullScore > 0 && score !== null ? Math.round((score / e.fullScore) * 100) : null;
      const color =
        score === null ? "#9ca3af" :
        rate === 100 ? "#16a34a" :
        (rate || 0) >= 60 ? "#ea580c" : "#dc2626";
      return `
      <details class="score-detail">
        <summary>
          <span class="issue-title">
            <b>${escapeHtml(e.code || String(idx + 1))}．${escapeHtml(e.name)}</b>
            <span class="tag tag-g" style="margin-left:8px;">${escapeHtml(e.category)}</span>
          </span>
          <span class="issue-meta">
            权重 ${e.weight}%　满分 ${e.fullScore}　得分 <b style="color:${color}">${score === null ? "待评分" : score}</b>
            ${a?.needManualCheck ? '　<span class="score-badge b-manual">需人工复核</span>' : ""}
          </span>
        </summary>
        <div class="issue-body">
          <p><b>评分标准详细描述：</b>${escapeHtml(e.description || "（招标文件未提供描述，以评分细则原文为准）")}</p>
          <p><b>具体评分细则：</b>${escapeHtml(e.rules || "（未抽取到细则原文）")}</p>
          <p><b>招标文件对应条款：</b><span class="loc">${escapeHtml(e.sourceClause || "未注明出处")}</span></p>
          <p><b>投标文件精确引用：</b>${
            a
              ? `${escapeHtml(a.bidChapter || "未定位章节")}` +
                (a.bidPage ? `　·　第 ${a.bidPage} 页` : "") +
                (a.bidParagraph ? `　·　${escapeHtml(a.bidParagraph)}` : "")
              : "未完成打分"
          }</p>
          ${a?.criterionClause ? `<p><b>适用评分条款：</b>${escapeHtml(a.criterionClause)}</p>` : ""}
          ${a?.evidenceQuote ? `<p><b>投标文件引用原文（证据）：</b></p><div class="evidence-box">${escapeHtml(a.evidenceQuote)}</div>` : ""}
          <p><b>评分依据与详细评分说明：</b>${a ? escapeHtml(a.explanation || "（模型未给出说明）") : "—"}</p>
          ${a?.needManualCheck ? `<p style="color:#92400e;"><b>※ 该项证据或分值需人工复核后确认，当前得分不作为最终结论。</b></p>` : ""}
        </div>
      </details>`;
    })
    .join("");

  return `
  <h2>${no}、评分索引与逐项打分</h2>
  <p style="font-size:13px;color:#6b7280;margin:8px 0;">
    本表严格依据招标文件评分办法原文构建：评分项、分值与细则均从招标文本抽取，权重按分值占比由系统复核计算；
    逐项得分由模型对照投标文件原文响应情况评定，每项均附投标文件章节/页码/段落引用、证据原文及评分说明，点击各行可展开核查。
    ${manualCount > 0 ? `其中 <b>${manualCount}</b> 项标注需人工复核。` : ""}
    <b>模拟得分仅供投标准备参考，最终以评标委员会评审为准。</b>
  </p>
  <table class="score-table">
    <tr>
      <th style="width:7%">评分项编号</th>
      <th style="width:24%">评分标准详细描述</th>
      <th style="width:8%">权重占比</th>
      <th style="width:8%">满分</th>
      <th style="width:9%">评定得分</th>
      <th style="width:9%">得分率</th>
      <th style="width:25%">投标文件对应章节</th>
      <th style="width:10%">复核标记</th>
    </tr>
    ${overviewRows}
    <tr class="score-total">
      <td colspan="2" style="text-align:center;">合计（共 ${entries.length} 项）</td>
      <td style="text-align:center;">100%</td>
      <td style="text-align:center;">${totalFull}</td>
      <td style="text-align:center;color:#047857">${Math.round(totalGot * 10) / 10}</td>
      <td style="text-align:center;">${scoreRate}%</td>
      <td colspan="2">模拟评估总分 ${Math.round(totalGot * 10) / 10} / ${totalFull} 分</td>
    </tr>
  </table>
  <h3>逐项评分依据与详细说明（点击展开/折叠）</h3>
  ${detailBlocks}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

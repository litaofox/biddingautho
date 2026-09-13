// 报告生成模块 - 生成独立 HTML 报告（内联 CSS，离线可打开）
// 支持本地审核报告与 LLM 审核报告（含废标项、评分、分析过程）
import type { Task, UnifiedReviewResult, LLMReviewResult, RejectionItem } from "../types.js";

interface ExportOptions {
  complianceTable: boolean;
  comparisonDetails: boolean;
  evaluation: boolean;
  /** 废标项分析（仅 LLM 模式） */
  rejection?: boolean;
  /** 评分项与模拟打分（仅 LLM 模式） */
  scoring?: boolean;
  /** 分析过程日志（仅 LLM 模式） */
  analysisLog?: boolean;
}

const statusMap: Record<string, { label: string; color: string; bg: string }> = {
  pass: { label: "✓ 符合", color: "#16a34a", bg: "#f0fdf4" },
  warn: { label: "△ 偏离", color: "#d97706", bg: "#fffbeb" },
  fail: { label: "✗ 不符合", color: "#dc2626", bg: "#fef2f2" },
  none: { label: "○ 未响应", color: "#64748b", bg: "#f8fafc" },
};

const severityMap: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: "致命", color: "#dc2626", bg: "#fef2f2" },
  major: { label: "重大", color: "#ea580c", bg: "#fff7ed" },
  minor: { label: "一般", color: "#ca8a04", bg: "#fefce8" },
};

export function generateHtmlReport(task: Task, options: ExportOptions): string {
  const result = task.result;
  if (!result) return "";

  const now = new Date().toLocaleString("zh-CN");
  const modeLabel = result.mode === "llm" ? "LLM 智能审核" : "本地规则审核";
  const modeColor = result.mode === "llm" ? "#7c3aed" : "#2563eb";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>投标书符合性审查报告</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; background: #f8fafc; color: #1e293b; padding: 20px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h1 { font-size: 24px; text-align: center; color: #2563eb; margin-bottom: 8px; }
  .subtitle { text-align: center; color: #64748b; font-size: 13px; margin-bottom: 30px; }
  .mode-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; color: #fff; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #f8fafc; padding: 16px; border-radius: 6px; margin-bottom: 30px; }
  .info-item { font-size: 13px; }
  .info-label { color: #64748b; }
  h2 { font-size: 18px; color: #2563eb; border-left: 4px solid #2563eb; padding-left: 12px; margin: 28px 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: center; }
  th { background: #f1f5f9; font-weight: 600; color: #334155; }
  td.item { text-align: left; font-weight: 500; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
  .score-bar { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-top: 4px; }
  .score-fill { height: 100%; border-radius: 3px; }
  .detail-section { margin-top: 12px; }
  .detail-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px; }
  .detail-box { padding: 10px; border-radius: 6px; background: #f8fafc; border: 1px solid #e2e8f0; }
  .detail-label { font-size: 11px; color: #64748b; margin-bottom: 4px; }
  .detail-content { font-size: 13px; color: #334155; }
  .risk-list { list-style: none; }
  .risk-list li { padding: 8px 12px; background: #fffbeb; border-left: 3px solid #d97706; margin-bottom: 8px; font-size: 13px; border-radius: 0 4px 4px 0; }
  .conclusion-box { padding: 16px; border-radius: 6px; text-align: center; font-size: 16px; font-weight: 600; }
  .score-circle { font-size: 42px; font-weight: 700; color: #2563eb; text-align: center; }
  .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  .reject-row { background: #fef2f2; }
  .log-box { background: #0f172a; color: #94a3b8; padding: 16px; border-radius: 6px; font-family: "Consolas", monospace; font-size: 12px; line-height: 1.8; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  .scoring-total { font-weight: 700; background: #f1f5f9; }
  @media print { body { background: #fff; padding: 0; } .container { box-shadow: none; } }
</style>
</head>
<body>
<div class="container">
  <h1>投标书符合性审查报告</h1>
  <p class="subtitle">BID COMPLIANCE REVIEW REPORT</p>
  <p style="text-align:center;margin-bottom:20px;">
    <span class="mode-badge" style="background:${modeColor}">${modeLabel}</span>
  </p>

  <div class="info-grid">
    <div class="info-item"><span class="info-label">采购文件：</span>${task.procurement.name}</div>
    <div class="info-item"><span class="info-label">投标公司数：</span>${result.bidders.length} 家</div>
    <div class="info-item"><span class="info-label">审查项数：</span>${result.complianceTable.length} 项</div>
    <div class="info-item"><span class="info-label">生成时间：</span>${now}</div>
  </div>

  ${renderComplianceTable(result, options)}
  ${renderComparisonDetails(result, options)}
  ${renderRejectionSection(result, options)}
  ${renderScoringSection(result, options)}
  ${renderEvaluation(result, options)}
  ${renderAnalysisLog(result, options)}

  <div class="footer">
    本报告由投标书智能审查系统自动生成，仅供参考，最终结论以人工复核为准。
  </div>
</div>
</body>
</html>`;
}

/** 符合性检查表格 */
function renderComplianceTable(result: UnifiedReviewResult, options: ExportOptions): string {
  if (!options.complianceTable || result.complianceTable.length === 0) return "";
  return `
  <h2>一、符合性检查表格</h2>
  <table>
    <thead>
      <tr>
        <th>审查项</th>
        <th>类别</th>
        ${result.bidders.map((b) => `<th>${b}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${result.complianceTable
        .map(
          (row) => `
      <tr>
        <td class="item">${row.item}</td>
        <td>${row.category}</td>
        ${row.cells
          .map((cell) => {
            const s = statusMap[cell.status];
            return `<td>
              <span class="badge" style="color:${s.color};background:${s.bg}">${s.label}</span>
              <div class="score-bar"><div class="score-fill" style="width:${cell.score}%;background:${s.color}"></div></div>
              <span style="font-size:11px;color:#64748b">${cell.score}%</span>
            </td>`;
          })
          .join("")}
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

/** 比对详情 */
function renderComparisonDetails(result: UnifiedReviewResult, options: ExportOptions): string {
  if (!options.comparisonDetails || result.complianceTable.length === 0) return "";
  const body = result.complianceTable
    .map((row, rowIdx) =>
      row.cells
        .map((cell, bidIdx) => {
          if (cell.status === "pass") return "";
          return `
  <div class="detail-section">
    <h3 style="font-size:14px;color:#334155;margin-bottom:8px;">${row.item} - ${result.bidders[bidIdx]}</h3>
    <div class="detail-row">
      <div class="detail-box">
        <div class="detail-label">采购要求</div>
        <div class="detail-content">${row.expectedText}</div>
      </div>
      <div class="detail-box">
        <div class="detail-label">投标响应</div>
        <div class="detail-content">${cell.evidence || "未找到相关内容"}</div>
      </div>
    </div>
    ${cell.deviation ? `<div class="detail-box" style="border-color:#fcd34d;background:#fffbeb"><div class="detail-label" style="color:#d97706">偏离说明</div><div class="detail-content" style="color:#92400e">${cell.deviation}</div></div>` : ""}
  </div>`;
        })
        .join("")
    )
    .join("");
  return body ? `<h2>二、比对详情</h2>${body}` : "";
}

/** 废标项分析（仅 LLM 模式） */
function renderRejectionSection(result: UnifiedReviewResult, options: ExportOptions): string {
  if (result.mode !== "llm") return "";
  if (options.rejection === false) return "";
  const llmResult = result as LLMReviewResult;
  if (llmResult.rejection.items.length === 0) return "";

  const rows = llmResult.rejection.items.map((item) => {
    const sev = severityMap[item.severity] || severityMap.major;
    return `
    <tr>
      <td class="item">${item.name}</td>
      <td><span class="badge" style="color:${sev.color};background:${sev.bg}">${sev.label}</span></td>
      <td style="text-align:left">${item.description}</td>
      ${result.bidders
        .map((bidder) => {
          const r = llmResult.rejection.byBidder[bidder]?.find((x) => x.name === item.name);
          if (!r) return `<td>—</td>`;
          return `<td class="${r.triggered ? "reject-row" : ""}">
            <span class="badge" style="color:${r.triggered ? "#dc2626" : "#16a34a"};background:${r.triggered ? "#fef2f2" : "#f0fdf4"}">
              ${r.triggered ? "触发" : "未触发"}
            </span>
          </td>`;
        })
        .join("")}
    </tr>`;
  }).join("");

  return `
  <h2>三、废标项分析</h2>
  <table>
    <thead>
      <tr>
        <th>废标项</th>
        <th>严重程度</th>
        <th>废标条件</th>
        ${result.bidders.map((b) => `<th>${b}</th>`).join("")}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${renderRejectionDetails(llmResult)}`;
}

function renderRejectionDetails(result: LLMReviewResult): string {
  const details: string[] = [];
  for (const bidder of result.bidders) {
    const rejections = result.rejection.byBidder[bidder] || [];
    const triggered = rejections.filter((r) => r.triggered);
    if (triggered.length === 0) continue;
    details.push(`
    <div class="detail-section">
      <h3 style="font-size:14px;color:#dc2626;margin-bottom:8px;">${bidder} - 触发废标项明细</h3>
      ${triggered
        .map(
          (r) => `
      <div class="detail-box" style="border-color:#fca5a5;background:#fef2f2;margin-bottom:8px;">
        <div class="detail-label" style="color:#dc2626">${r.name}</div>
        <div class="detail-content" style="color:#991b1b"><strong>证据：</strong>${r.evidence || "无"}</div>
        <div class="detail-content" style="color:#991b1b;margin-top:4px;"><strong>理由：</strong>${r.reason || "无"}</div>
      </div>`
        )
        .join("")}
    </div>`);
  }
  return details.join("");
}

/** 评分项与模拟打分（仅 LLM 模式） */
function renderScoringSection(result: UnifiedReviewResult, options: ExportOptions): string {
  if (result.mode !== "llm") return "";
  if (options.scoring === false) return "";
  const llmResult = result as LLMReviewResult;
  if (llmResult.scoringItems.length === 0) return "";

  const rows = llmResult.scoringItems.map((item) => `
    <tr>
      <td class="item">${item.name}</td>
      <td>${item.category}</td>
      <td>${item.maxScore}</td>
      <td style="text-align:left">${item.requirement}</td>
      ${result.bidders
        .map((bidder) => {
          const bs = item.bidderScores.find((s) => s.bidder === bidder);
          const score = bs?.score || 0;
          const pct = Math.round((score / item.maxScore) * 100);
          const color = pct >= 80 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
          return `<td>
            <div style="font-weight:600;color:${color}">${score}/${item.maxScore}</div>
            <div class="score-bar"><div class="score-fill" style="width:${pct}%;background:${color}"></div></div>
          </td>`;
        })
        .join("")}
    </tr>`).join("");

  // 合计行
  const totalMax = llmResult.scoringItems.reduce((sum, i) => sum + i.maxScore, 0);
  const totalRow = `
    <tr class="scoring-total">
      <td>合计</td>
      <td colspan="3">满分 ${totalMax} 分</td>
      ${result.bidders
        .map((bidder) => {
          const total = llmResult.scoringItems.reduce(
            (sum, item) => sum + (item.bidderScores.find((s) => s.bidder === bidder)?.score || 0),
            0
          );
          return `<td>${total}/${totalMax}</td>`;
        })
        .join("")}
    </tr>`;

  return `
  <h2>四、评分项与模拟打分</h2>
  <table>
    <thead>
      <tr>
        <th>评分项</th>
        <th>类别</th>
        <th>满分</th>
        <th>评分标准</th>
        ${result.bidders.map((b) => `<th>${b}</th>`).join("")}
      </tr>
    </thead>
    <tbody>${rows}${totalRow}</tbody>
  </table>
  <p style="font-size:11px;color:#64748b;margin-top:8px;">※ 模拟打分由 AI 根据投标文件响应程度给出，仅供参考，最终以评标委员会打分为准</p>`;
}

/** 专业评价 */
function renderEvaluation(result: UnifiedReviewResult, options: ExportOptions): string {
  if (!options.evaluation) return "";
  const evalData = result.evaluation;
  const conclusionColor =
    evalData.conclusion === "推荐" ? "#f0fdf4" : evalData.conclusion === "有条件推荐" ? "#fffbeb" : "#fef2f2";
  const conclusionTextColor =
    evalData.conclusion === "推荐" ? "#16a34a" : evalData.conclusion === "有条件推荐" ? "#d97706" : "#dc2626";

  const summarySection =
    result.mode === "llm" && (result as LLMReviewResult).evaluation.summary
      ? `<div class="detail-box" style="margin-top:16px;border-color:#bfdbfe;background:#eff6ff;">
          <div class="detail-label" style="color:#2563eb">AI 评价摘要</div>
          <div class="detail-content" style="color:#1e40af">${(result as LLMReviewResult).evaluation.summary}</div>
        </div>`
      : "";

  return `
  <h2>${result.mode === "llm" ? "五" : "三"}、专业评价</h2>
  <div style="text-align:center;margin:20px 0;">
    <div class="score-circle">${evalData.score}</div>
    <div style="color:#64748b;font-size:13px;">综合评分 / 100</div>
  </div>

  ${
    evalData.risks.length > 0
      ? `
  <h3 style="font-size:15px;color:#d97706;margin:16px 0 10px;">风险提示</h3>
  <ul class="risk-list">
    ${evalData.risks.map((r) => `<li>${r}</li>`).join("")}
  </ul>`
      : ""
  }

  ${summarySection}

  <div class="conclusion-box" style="background:${conclusionColor};color:${conclusionTextColor}">
    建议结论：${evalData.conclusion}
  </div>`;
}

/** 分析过程日志（仅 LLM 模式） */
function renderAnalysisLog(result: UnifiedReviewResult, options: ExportOptions): string {
  if (result.mode !== "llm") return "";
  if (options.analysisLog === false) return "";
  const llmResult = result as LLMReviewResult;
  if (!llmResult.analysisLog || llmResult.analysisLog.length === 0) return "";
  return `
  <h2>六、分析过程日志</h2>
  <div class="log-box">${llmResult.analysisLog.join("\n")}</div>`;
}

// 前端 API 封装
import type {
  ReviewConfig, ReviewItem, ReviewItemSet, UnifiedReviewResult,
  MultiDimConfig, MultiDimReviewResult,
  Issue, RemediationPlan, CompletenessItem, AuditPlan,
} from "../types";

const BASE_URL = "/api";

// 上传文件并解析
export async function uploadFiles(data: {
  procurement: File;
  projectReq?: File;
  bidders: { name: string; files: { file: File; type: "technical" | "commercial" }[] }[];
}): Promise<{ sessionId: string; bidders: { id: string; name: string }[] }> {
  const formData = new FormData();
  formData.append("procurement", data.procurement);
  if (data.projectReq) {
    formData.append("projectReq", data.projectReq);
  }

  const bidderNames: string[] = [];
  const fileTypes: string[] = [];
  data.bidders.forEach((bidder) => {
    bidder.files.forEach((f) => {
      bidderNames.push(bidder.name);
      fileTypes.push(f.type);
      formData.append("bidderFiles", f.file);
    });
  });

  formData.append("bidders", JSON.stringify(bidderNames));
  formData.append("fileTypes", JSON.stringify(fileTypes));

  const res = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    body: formData,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json;
}

// 执行审查
export async function runReview(
  sessionId: string,
  config: ReviewConfig
): Promise<UnifiedReviewResult> {
  const res = await fetch(`${BASE_URL}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, config }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.result;
}

// 获取审查项列表
export async function getReviewItems(sessionId: string): Promise<ReviewItemSet> {
  const res = await fetch(`${BASE_URL}/review-items/${sessionId}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.reviewItems;
}

// 添加自定义审查项
export async function addCustomReviewItem(
  sessionId: string,
  data: { name: string; category: "qualification" | "commitment" | "technical"; keywords?: string[]; expectedText?: string }
): Promise<ReviewItemSet> {
  const res = await fetch(`${BASE_URL}/review-items/${sessionId}/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.reviewItems;
}

// 删除自定义审查项
export async function deleteCustomReviewItem(sessionId: string, itemId: string): Promise<ReviewItemSet> {
  const res = await fetch(`${BASE_URL}/review-items/${sessionId}/custom/${itemId}`, {
    method: "DELETE",
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.reviewItems;
}

// 使用 LLM 重新生成审查项
export async function regenerateReviewItems(
  sessionId: string,
  data: { provider: string; apiKey: string }
): Promise<{ reviewItems: ReviewItemSet; message: string }> {
  const res = await fetch(`${BASE_URL}/review-items/${sessionId}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return { reviewItems: json.reviewItems, message: json.message };
}

// 获取 LLM 模式状态
export async function getLLMMode(sessionId: string): Promise<{ llmMode: boolean; llmConfig: { provider: string } | null }> {
  const res = await fetch(`${BASE_URL}/review-items/${sessionId}/llm-mode`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return { llmMode: json.llmMode, llmConfig: json.llmConfig };
}

// 导出 HTML 报告
export async function exportReport(
  sessionId: string,
  options: {
    complianceTable: boolean;
    comparisonDetails: boolean;
    evaluation: boolean;
    rejection?: boolean;
    scoring?: boolean;
    analysisLog?: boolean;
  }
): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, options }),
  });
  if (!res.ok) throw new Error("导出失败");
  return res.blob();
}

// ========== 多维审核 API（F1-F10） ==========

// 执行多维审核
export async function runMultiDimReview(
  sessionId: string,
  config?: MultiDimConfig
): Promise<MultiDimReviewResult> {
  const res = await fetch(`${BASE_URL}/review2/multi-dim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, config }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.result;
}

// 获取多维审核问题列表（按风险等级分组）
export async function getMultiDimIssues(sessionId: string): Promise<{
  critical: Issue[];
  major: Issue[];
  minor: Issue[];
  highlights: Issue[];
  summary: MultiDimReviewResult["summary"];
}> {
  const res = await fetch(`${BASE_URL}/review2/issues/${sessionId}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return {
    critical: json.critical,
    major: json.major,
    minor: json.minor,
    highlights: json.highlights,
    summary: json.summary,
  };
}

// 获取整改清单
export async function getRemediationPlan(sessionId: string): Promise<{
  remediationPlan: RemediationPlan;
  completeness: CompletenessItem[];
  summary: MultiDimReviewResult["summary"];
  highlights: Issue[];
  issues: Issue[];
  bidders: string[];
  mode: string;
  procurement: string;
  createdAt: number;
  generatedAt: number;
}> {
  const res = await fetch(`${BASE_URL}/review2/remediation/${sessionId}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json;
}

// 导出多维审核 HTML 报告
export async function exportMultiDimReport(
  sessionId: string,
  options?: {
    summary?: boolean;
    critical?: boolean;
    major?: boolean;
    minor?: boolean;
    highlights?: boolean;
    remediation?: boolean;
    manualCheck?: boolean;
    completeness?: boolean;
  }
): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/review2/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, options: options || {} }),
  });
  if (!res.ok) throw new Error("多维报告导出失败");
  return res.blob();
}

// ========== LLM 全方位审核（两阶段） ==========

// 阶段一：根据采购文件+需求动态生成审核清单
export async function generateAuditPlan(
  sessionId: string,
  data: { provider: string; apiKey: string }
): Promise<{ plan: AuditPlan; message: string }> {
  const res = await fetch(`${BASE_URL}/audit/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, ...data }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return { plan: json.plan, message: json.message };
}

// 阶段一·确认：保存用户勾选/编辑后的审核清单
export async function confirmAuditPlan(
  sessionId: string,
  plan: AuditPlan
): Promise<{ plan: AuditPlan; enabledCount: number }> {
  const res = await fetch(`${BASE_URL}/audit/plan/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, plan }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return { plan: json.plan, enabledCount: json.enabledCount };
}

// 阶段二：依据确认后的清单执行 LLM 全方位审查
export async function runLlmAudit(sessionId: string): Promise<MultiDimReviewResult> {
  const res = await fetch(`${BASE_URL}/audit/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.result;
}

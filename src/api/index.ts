// 前端 API 封装
import type { ReviewConfig, ReviewItem, ReviewItemSet, UnifiedReviewResult } from "../types";

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

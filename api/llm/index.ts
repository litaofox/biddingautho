// LLM 增强模块 - 统一适配层
// 支持 OpenAI / 百度千帆 / 智谱 GLM / 通义千问 / 本地兼容模型
import type {
  ReviewConfig, ReviewItem, RejectionItem, ScoringItem,
  AuditPlan, AuditCheckpoint, Issue, IssueDimension, RiskLevel,
  CompletenessItem, ProcurementRequirement, ProjectMeta,
  BidScoringItem, ScoringAssessment,
} from "../types.js";
import {
  EXTRACT_REVIEW_DIMENSIONS_PROMPT,
  RETRIEVE_EVIDENCE_PROMPT,
  JUDGE_COMPLIANCE_PROMPT,
  JUDGE_REJECTION_PROMPT,
  JUDGE_SCORING_PROMPT,
  EVALUATE_PROMPT,
} from "../llmEngine/prompts.js";
import {
  GENERATE_AUDIT_PLAN_PROMPT,
  AUDIT_BATCH_PROMPT,
  AUDIT_COMPLETENESS_PROMPT,
  AUDIT_REQUIREMENTS_PROMPT,
  EXTRACT_SCORING_ITEMS_PROMPT,
  SCORE_BID_PROMPT,
  buildAuditContext,
} from "../llmEngine/auditPrompts.js";
import {
  buildPlanDigest,
  buildScoringDigest,
  buildFormatDigest,
} from "../llmEngine/procurementDigest.js";

/**
 * 文本脱敏：在发送到外部 LLM 前替换敏感身份信息
 * 仅脱敏身份类信息（身份证、银行账号、手机号等），保留金额、日期、天数、百分比等业务数值，
 * 以确保 LLM 能进行限价比较、有效期判断等数值型判定。
 * 投标报价在开标后即为公开信息，不属于敏感数据。
 */
export function sanitizeText(text: string): string {
  if (!text) return text;
  let result = text;

  // 1. 统一社会信用代码：18位，必须包含至少一个大写字母（排除纯数字）
  result = result.replace(/(?<![A-Za-z0-9])(?=[0-9A-Z]{18}(?![A-Za-z0-9]))(?=.*[A-Z])[0-9A-Z]{18}/g, "[统一社会信用代码]");

  // 2. 身份证号：18位（17位数字+数字/X）或15位纯数字
  result = result.replace(/(?<![A-Za-z0-9])\d{17}[\dXx](?![A-Za-z0-9])/g, "[身份证号]");
  result = result.replace(/(?<![A-Za-z0-9])\d{15}(?![A-Za-z0-9])/g, "[身份证号]");

  // 3. 银行账号：连续16-19位纯数字（排除被上述规则匹配的情况）
  result = result.replace(/(?<![A-Za-z0-9])\d{16,19}(?![A-Za-z0-9])/g, "[银行账号]");

  // 4. 座机号：区号-号码（必须有分隔符，避免匹配手机号）
  result = result.replace(/(?<![A-Za-z0-9])\d{3,4}-\d{7,8}(?![A-Za-z0-9])/g, "[座机号]");
  // 座机号（无横线）：0开头，共11-12位
  result = result.replace(/(?<![A-Za-z0-9])0\d{10,11}(?![A-Za-z0-9])/g, "[座机号]");

  // 5. 手机号：11位数字，1开头
  result = result.replace(/(?<![A-Za-z0-9])1[3-9]\d{9}(?![A-Za-z0-9])/g, "[手机号]");

  // 6. 邮箱
  result = result.replace(/[\w.-]+@[\w.-]+\.\w+/g, "[邮箱]");

  // 7. 资质证书编号
  result = result.replace(/(证书编号|证书号)[:：]?\s*[A-Za-z0-9-]+/g, "$1:[证书编号]");

  // 注意：金额、日期、天数、百分比、数量等业务数值不脱敏，
  // 以确保 LLM 能进行限价比较、有效期判断、评分计算等数值型判定。

  return result;
}

/**
 * LLM 服务配置
 */
export interface LLMConfig {
  enabled: boolean;
  provider: "openai" | "qianfan" | "glm" | "qianwen" | "local";
  apiKey: string;
  scope: string[]; // 增强范围: clauseExtract, semanticMatch, deviation, evaluation
}

/**
 * LLM 调用结果
 */
export interface LLMResponse {
  content: string;
  raw?: unknown;
}

/**
 * 抽象 LLM 客户端接口
 */
export interface LLMClient {
  chat(messages: { role: "system" | "user" | "assistant"; content: string }[]): Promise<LLMResponse>;
}

/**
 * 创建 LLM 客户端
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  switch (config.provider) {
    case "openai":
      return new OpenAIClient(config);
    case "qianfan":
      return new QianfanClient(config);
    case "glm":
      return new GLMClient(config);
    case "qianwen":
      return new QianwenClient(config);
    case "local":
      return new LocalClient(config);
    default:
      return new OpenAIClient(config);
  }
}

/**
 * OpenAI 兼容客户端
 */
class OpenAIClient implements LLMClient {
  private apiKey: string;
  private baseURL = "https://api.openai.com/v1";
  private model = "gpt-3.5-turbo";

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
  }

  async chat(messages: { role: string; content: string }[]): Promise<LLMResponse> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "LLM 请求失败");
    return { content: data.choices[0].message.content, raw: data };
  }
}

/**
 * 百度千帆客户端
 */
class QianfanClient implements LLMClient {
  private apiKey: string;
  private baseURL = "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop";

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
  }

  async chat(messages: { role: string; content: string }[]): Promise<LLMResponse> {
    // 千帆需要先获取 access_token，这里简化为直接使用 API Key
    // 实际使用时需要根据百度文档获取 token
    const res = await fetch(`${this.baseURL}/chat/completions?access_token=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature: 0.3 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_msg || "LLM 请求失败");
    return { content: data.result, raw: data };
  }
}

/**
 * 智谱 GLM 客户端
 */
class GLMClient implements LLMClient {
  private apiKey: string;
  private baseURL = "https://open.bigmodel.cn/api/paas/v4";
  private model = "glm-4";

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
  }

  async chat(messages: { role: string; content: string }[]): Promise<LLMResponse> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.3 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "LLM 请求失败");
    return { content: data.choices[0].message.content, raw: data };
  }
}

/**
 * 通义千问（DashScope 兼容模式）客户端
 * 使用 OpenAI 兼容接口，通过 DashScope API 调用千问大模型
 */
class QianwenClient implements LLMClient {
  private apiKey: string;
  private baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  private model = "qwen-plus";

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
  }

  async chat(messages: { role: string; content: string }[]): Promise<LLMResponse> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "通义千问请求失败");
    return { content: data.choices[0].message.content, raw: data };
  }
}

/**
 * 本地兼容模型客户端（如 Ollama / vLLM / LM Studio 等）
 */
class LocalClient implements LLMClient {
  private baseURL: string;
  private model: string;

  constructor(config: LLMConfig) {
    // 本地模型默认连接 Ollama 或 OpenAI 兼容端点
    this.baseURL = process.env.LLM_LOCAL_URL || "http://localhost:11434/v1";
    this.model = process.env.LLM_LOCAL_MODEL || "qwen2";
    // apiKey 字段可留空，本地模型通常不需要
    void config.apiKey;
  }

  async chat(messages: { role: string; content: string }[]): Promise<LLMResponse> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.3 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "LLM 请求失败");
    return { content: data.choices[0].message.content, raw: data };
  }
}

/**
 * LLM 增强功能集合
 */
export class LLMAugmenter {
  private client: LLMClient;
  private scope: string[];
  private needSanitize: boolean; // 是否需要脱敏（外部模型需要，本地模型不需要）

  constructor(config: LLMConfig) {
    this.client = createLLMClient(config);
    this.scope = config.scope;
    // 本地模型数据不出内网，无需脱敏；外部模型必须脱敏
    this.needSanitize = config.provider !== "local";
  }

  /** 检查某功能是否在增强范围内 */
  has(feature: string): boolean {
    return this.scope.includes(feature);
  }

  /**
   * 从采购文件文本中生成结构化审查项
   * LLM 分析采购文件后返回 JSON 格式的审查项列表
   */
  async generateReviewItems(
    procurementText: string,
    projectReqText?: string
  ): Promise<ReviewItem[]> {
    const combinedText = (procurementText || "") + "\n" + (projectReqText || "");
    if (!combinedText.trim()) return [];

    const systemPrompt = `你是招标文件分析专家。请从以下采购文件和项目需求文本中提取审查项，用于对投标文件进行符合性审查。

要求：
1. 提取所有关键的资格要求、商务条款承诺、技术要求
2. 每个审查项必须包含：name（名称）、category（类别：qualification/commitment/technical）、expectedText（期望投标文件满足的具体描述）、keywords（用于检索匹配的关键词数组，2-5个）
3. 审查项名称要简洁明确，不要包含"投标人须提供"等冗余前缀
4. 返回纯 JSON 数组格式，不要包含任何其他文字

输出格式示例：
[{"name":"营业执照","category":"qualification","expectedText":"提供有效的营业执照","keywords":["营业执照","营业执照","经营范围"]},{"name":"7×24小时响应服务","category":"commitment","expectedText":"承诺提供7×24小时响应服务","keywords":["7×24","24小时","响应"]}]`;

    const content = await this.callLLM(
      systemPrompt,
      combinedText.slice(0, 8000)
    );

    if (!content) return [];

    try {
      // 尝试从返回内容中提取 JSON 数组
      let jsonStr = content.trim();
      // 处理可能的 markdown 代码块包裹
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((item: any) => item.name && item.category)
        .slice(0, 50)
        .map((item: any, idx: number) => ({
          id: `llm_item_${idx}_${Date.now()}`,
          name: String(item.name).slice(0, 50),
          category: (["qualification", "commitment", "technical"].includes(item.category)
            ? item.category
            : "commitment") as ReviewItem["category"],
          scope: "project" as const,
          keywords: Array.isArray(item.keywords)
            ? item.keywords.map((k: string) => String(k)).slice(0, 8)
            : [String(item.name)],
          expectedText: String(item.expectedText || item.name).slice(0, 200),
        }));
    } catch {
      console.warn("[LLM] generateReviewItems: JSON parse failed");
      return [];
    }
  }

  /**
   * 条款抽取：从采购文件中抽取关键审查条款
   */
  async extractClauses(procurementText: string): Promise<string> {
    if (!this.has("clauseExtract")) return "";
    return this.callLLM(
      "你是招标文件分析专家。请从以下采购文件中抽取关键资格要求、商务条款和技术要求，每条一行。",
      procurementText.slice(0, 8000)
    );
  }

  /**
   * 语义比对：比对投标响应与采购要求的语义匹配度
   */
  async semanticMatch(expected: string, actual: string): Promise<{ score: number; deviation: string }> {
    if (!this.has("semanticMatch")) return { score: -1, deviation: "" };
    const content = await this.callLLM(
      "你是投标书审查专家。请比对采购要求与投标响应的语义匹配度，返回 JSON：{\"score\":0-100,\"deviation\":\"偏离说明或空字符串\"}",
      `采购要求：${expected}\n投标响应：${actual}`
    );
    try {
      const parsed = JSON.parse(content);
      return { score: parsed.score, deviation: parsed.deviation || "" };
    } catch {
      return { score: -1, deviation: "" };
    }
  }

  /**
   * 偏离总结：总结所有偏离项
   */
  async summarizeDeviations(deviations: { item: string; bidder: string; deviation: string }[]): Promise<string> {
    if (!this.has("deviation") || deviations.length === 0) return "";
    const input = deviations.map((d) => `- ${d.bidder} / ${d.item}: ${d.deviation}`).join("\n");
    return this.callLLM(
      "你是投标书审查专家。请总结以下偏离项，给出关键风险点和建议。",
      input
    );
  }

  /**
   * 专业评价：对整体审查结果给出专业评价
   */
  async evaluate(summary: string): Promise<{ score: number; risks: string[]; conclusion: string }> {
    if (!this.has("evaluation")) return { score: -1, risks: [], conclusion: "" };
    const content = await this.callLLM(
      "你是投标书评审专家。请根据审查摘要给出专业评价，返回 JSON：{\"score\":0-100,\"risks\":[\"风险1\",\"风险2\"],\"conclusion\":\"推荐/有条件推荐/不推荐\"}",
      summary
    );
    try {
      const parsed = JSON.parse(content);
      return {
        score: parsed.score,
        risks: parsed.risks || [],
        conclusion: parsed.conclusion || "",
      };
    } catch {
      return { score: -1, risks: [], conclusion: "" };
    }
  }

  // ========== LLM 审核模块专用方法 ==========

  /**
   * 从采购文件中提取审查维度：审查项 + 废标项 + 评分项
   */
  async extractReviewDimensions(
    procurementText: string,
    projectReqText?: string
  ): Promise<{ reviewItems: ReviewItem[]; rejectionItems: RejectionItem[]; scoringItems: ScoringItem[] }> {
    const combinedText = (procurementText || "") + "\n" + (projectReqText || "");
    if (!combinedText.trim()) return { reviewItems: [], rejectionItems: [], scoringItems: [] };

    const content = await this.callLLM(
      EXTRACT_REVIEW_DIMENSIONS_PROMPT,
      combinedText.slice(0, 30000)
    );

    if (!content) return { reviewItems: [], rejectionItems: [], scoringItems: [] };

    try {
      const parsed = this.parseJSON(content);
      const reviewItems: ReviewItem[] = (parsed.reviewItems || [])
        .filter((item: any) => item.name && item.category)
        .slice(0, 80)
        .map((item: any, idx: number) => ({
          id: `llm_item_${idx}_${Date.now()}`,
          name: String(item.name).slice(0, 60),
          category: (["qualification", "commitment", "technical"].includes(item.category)
            ? item.category
            : "commitment") as ReviewItem["category"],
          scope: "project" as const,
          keywords: Array.isArray(item.keywords)
            ? item.keywords.map((k: string) => String(k)).slice(0, 8)
            : [String(item.name)],
          expectedText: String(item.expectedText || item.name).slice(0, 200),
        }));

      const rejectionItems: RejectionItem[] = (parsed.rejectionItems || [])
        .filter((item: any) => item.name)
        .slice(0, 30)
        .map((item: any) => ({
          name: String(item.name).slice(0, 80),
          description: String(item.description || item.name).slice(0, 300),
          severity: (["critical", "major", "minor"].includes(item.severity)
            ? item.severity
            : "major") as RejectionItem["severity"],
          triggered: false,
          evidence: "",
          reason: "",
        }));

      const scoringItems: ScoringItem[] = (parsed.scoringItems || [])
        .filter((item: any) => item.name)
        .slice(0, 30)
        .map((item: any) => ({
          name: String(item.name).slice(0, 80),
          maxScore: Number(item.maxScore) || 10,
          category: String(item.category || "技术").slice(0, 20),
          requirement: String(item.requirement || item.name).slice(0, 400),
          bidderScores: [],
        }));

      return { reviewItems, rejectionItems, scoringItems };
    } catch (err) {
      console.warn("[LLM] extractReviewDimensions: JSON parse failed");
      return { reviewItems: [], rejectionItems: [], scoringItems: [] };
    }
  }

  /**
   * 将长文本切分为带重叠的片段
   */
  private chunkText(text: string, chunkSize = 6000, overlap = 400): string[] {
    if (!text) return [];
    if (text.length <= chunkSize) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      if (end >= text.length) break;
      start = end - overlap;
    }
    return chunks;
  }

  /**
   * 本地关键词预筛选：用审查项的 keywords 在片段中匹配，返回命中的候选片段
   * 若 keywords 为空或无命中，返回全部片段（降级）
   */
  private prefilterChunks(keywords: string[], chunks: string[]): number[] {
    if (!keywords || keywords.length === 0) {
      return chunks.map((_, i) => i);
    }
    const hits = new Set<number>();
    const lowerChunks = chunks.map((c) => c.toLowerCase());
    for (let i = 0; i < chunks.length; i++) {
      for (const kw of keywords) {
        if (!kw) continue;
        if (lowerChunks[i].includes(kw.toLowerCase())) {
          hits.add(i);
          // 扩展相邻片段，避免重叠区被截断
          if (i > 0) hits.add(i - 1);
          if (i < chunks.length - 1) hits.add(i + 1);
          break;
        }
      }
    }
    // 若预筛选无命中，返回全部片段作为降级
    return hits.size > 0 ? Array.from(hits).sort((a, b) => a - b) : chunks.map((_, i) => i);
  }

  /**
   * 阶段1：批量检索证据（本地预筛选 + 小批量 LLM 检索 + 并行）
   * @param items 审查项列表 [{name, desc, keywords}]
   * @param bidText 投标文件全文
   * @returns Map<itemName, evidenceText[]>
   */
  private async retrieveEvidenceBatch(
    items: { name: string; desc: string; keywords: string[] }[],
    bidText: string
  ): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    items.forEach((it) => (result[it.name] = []));

    if (items.length === 0 || !bidText.trim()) return result;

    const chunks = this.chunkText(bidText);

    // 对每个项做本地预筛选，得到候选片段
    const itemsWithCandidates = items.map((it) => ({
      ...it,
      candidateIndices: this.prefilterChunks(it.keywords, chunks),
    }));

    // 小批量分组：每组 3 个项
    const batchSize = 3;
    const batches: typeof itemsWithCandidates[] = [];
    for (let i = 0; i < itemsWithCandidates.length; i += batchSize) {
      batches.push(itemsWithCandidates.slice(i, i + batchSize));
    }

    // 并行处理所有批次（限制并发数为 3，避免触发 API 限流）
    const concurrency = 3;
    const processBatch = async (batch: typeof itemsWithCandidates) => {
      // 收集本批次所有项的候选片段（去重）
      const candidateIdxSet = new Set<number>();
      batch.forEach((it) => it.candidateIndices.forEach((idx) => candidateIdxSet.add(idx)));
      const candidateIndices = Array.from(candidateIdxSet).sort((a, b) => a - b);

      // 若候选片段过多（>10），只取前 10 个，避免超出上下文
      const limitedIndices = candidateIndices.slice(0, 10);
      const candidateChunks = limitedIndices.map((idx) => chunks[idx]);

      const itemsDesc = batch
        .map((it, idx) => `${idx + 1}. ${it.name}（要求：${it.desc}）`)
        .join("\n");
      const chunksDesc = candidateChunks
        .map((c, idx) => `【片段${limitedIndices[idx] + 1}】\n${c}`)
        .join("\n\n");

      const content = await this.callLLM(
        RETRIEVE_EVIDENCE_PROMPT,
        `审查项清单：\n${itemsDesc}\n\n投标文件片段：\n${chunksDesc}`
      );

      if (!content) return;

      try {
        const parsed = this.parseJSON(content);
        if (!Array.isArray(parsed)) return;

        // 按索引对齐：第 i 个结果对应第 i 个审查项
        batch.forEach((it, idx) => {
          const evList = parsed[idx];
          if (Array.isArray(evList)) {
            for (const ev of evList) {
              const text = String(ev || "").trim();
              if (text && !result[it.name].includes(text)) {
                result[it.name].push(text);
              }
            }
          }
        });
      } catch {
        // 单个批次解析失败不影响其他批次
      }
    };

    // 并发控制：分批并行执行
    for (let i = 0; i < batches.length; i += concurrency) {
      const slice = batches.slice(i, i + concurrency);
      await Promise.all(slice.map((b) => processBatch(b)));
    }

    return result;
  }

  /**
   * 对单个投标人的全部审查项进行符合性判定（两阶段：批量检索→逐项判定）
   */
  async judgeCompliance(
    reviewItems: ReviewItem[],
    bidText: string
  ): Promise<{ name: string; score: number; status: string; evidence: string; deviation: string }[]> {
    if (reviewItems.length === 0 || !bidText.trim()) return [];

    // 阶段1：批量检索证据（本地预筛选 + 小批量 + 并行）
    const evidenceMap = await this.retrieveEvidenceBatch(
      reviewItems.map((it) => ({ name: it.name, desc: it.expectedText, keywords: it.keywords || [] })),
      bidText
    );

    const results: { name: string; score: number; status: string; evidence: string; deviation: string }[] = [];
    for (const item of reviewItems) {
      const evidenceList = evidenceMap[item.name] || [];
      console.log(`[LLM] 符合性检索[${item.name}]: 找到 ${evidenceList.length} 条证据`);

      // 降级：若检索无证据，直接取投标文件前 10000 字符送判定，避免全部 none
      const evidenceText =
        evidenceList.length > 0
          ? evidenceList.join("\n")
          : bidText.slice(0, 10000);

      // 阶段2：基于证据逐项判定
      const content = await this.callLLM(
        JUDGE_COMPLIANCE_PROMPT,
        `审查项：${item.name}\n要求：${item.expectedText}\n\n投标文件内容：\n${evidenceText}`
      );

      if (!content) {
        results.push({ name: item.name, score: 0, status: "none", evidence: "", deviation: "" });
        continue;
      }

      try {
        const parsed = this.parseJSON(content);
        results.push({
          name: String(parsed.name || item.name),
          score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
          status: ["pass", "warn", "fail", "none"].includes(parsed.status)
            ? parsed.status
            : "none",
          evidence: String(parsed.evidence || "").slice(0, 200),
          deviation: String(parsed.deviation || "").slice(0, 300),
        });
      } catch {
        results.push({ name: item.name, score: 0, status: "none", evidence: "", deviation: "" });
      }
    }

    return results;
  }

  /**
   * 对单个投标人进行废标项判定（两阶段：批量检索→逐项判定，含数值比较）
   */
  async judgeRejection(
    rejectionItems: RejectionItem[],
    bidText: string
  ): Promise<{ name: string; triggered: boolean; evidence: string; reason: string }[]> {
    if (rejectionItems.length === 0 || !bidText.trim()) return [];

    // 阶段1：批量检索证据
    // 废标项无 keywords 字段，用 name 拆分关键词做预筛选
    const evidenceMap = await this.retrieveEvidenceBatch(
      rejectionItems.map((it) => ({
        name: it.name,
        desc: it.description,
        keywords: it.name.split(/[，,、\s]+/).filter((w) => w.length >= 2),
      })),
      bidText
    );

    const results: { name: string; triggered: boolean; evidence: string; reason: string }[] = [];
    for (const item of rejectionItems) {
      const evidenceList = evidenceMap[item.name] || [];

      // 降级：若检索无证据，直接取投标文件前 10000 字符送判定
      const evidenceText =
        evidenceList.length > 0
          ? evidenceList.join("\n")
          : bidText.slice(0, 10000);

      // 阶段2：基于证据逐项判定
      const content = await this.callLLM(
        JUDGE_REJECTION_PROMPT,
        `废标项：${item.name}\n废标条件：${item.description}\n\n投标文件内容：\n${evidenceText}`
      );

      if (!content) {
        results.push({ name: item.name, triggered: false, evidence: "", reason: "" });
        continue;
      }

      try {
        const parsed = this.parseJSON(content);
        results.push({
          name: String(parsed.name || item.name),
          triggered: Boolean(parsed.triggered),
          evidence: String(parsed.evidence || "").slice(0, 300),
          reason: String(parsed.reason || "").slice(0, 300),
        });
      } catch {
        results.push({ name: item.name, triggered: false, evidence: "", reason: "" });
      }
    }

    return results;
  }

  /**
   * 对单个投标人进行评分项打分（两阶段：批量检索→逐项打分）
   */
  async judgeScoring(
    scoringItems: ScoringItem[],
    bidText: string
  ): Promise<{ name: string; score: number; reason: string; evidence: string }[]> {
    if (scoringItems.length === 0 || !bidText.trim()) return [];

    // 阶段1：批量检索证据
    // 评分项无 keywords 字段，用 name 拆分关键词做预筛选
    const evidenceMap = await this.retrieveEvidenceBatch(
      scoringItems.map((it) => ({
        name: it.name,
        desc: it.requirement,
        keywords: it.name.split(/[，,、\s]+/).filter((w) => w.length >= 2),
      })),
      bidText
    );

    const results: { name: string; score: number; reason: string; evidence: string }[] = [];
    for (const item of scoringItems) {
      const evidenceList = evidenceMap[item.name] || [];

      // 降级：若检索无证据，直接取投标文件前 10000 字符送判定
      const evidenceText =
        evidenceList.length > 0
          ? evidenceList.join("\n")
          : bidText.slice(0, 10000);

      // 阶段2：基于证据逐项打分
      const content = await this.callLLM(
        JUDGE_SCORING_PROMPT,
        `评分项：${item.name}\n满分：${item.maxScore}分\n评分标准：${item.requirement}\n\n投标文件内容：\n${evidenceText}`
      );

      if (!content) {
        results.push({ name: item.name, score: 0, reason: "", evidence: "" });
        continue;
      }

      try {
        const parsed = this.parseJSON(content);
        results.push({
          name: String(parsed.name || item.name),
          score: Math.max(0, Math.min(item.maxScore, Number(parsed.score) || 0)),
          reason: String(parsed.reason || "").slice(0, 300),
          evidence: String(parsed.evidence || "").slice(0, 300),
        });
      } catch {
        results.push({ name: item.name, score: 0, reason: "", evidence: "" });
      }
    }

    return results;
  }

  /**
   * 综合评价：基于所有投标人的审核结果生成评价
   */
  async evaluateLLMReview(summary: string): Promise<{ score: number; risks: string[]; conclusion: string; summary: string }> {
    const content = await this.callLLM(EVALUATE_PROMPT, summary);
    if (!content) return { score: 0, risks: [], conclusion: "", summary: "" };
    try {
      const parsed = this.parseJSON(content);
      return {
        score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
        risks: Array.isArray(parsed.risks) ? parsed.risks.map((r: string) => String(r)).slice(0, 10) : [],
        conclusion: String(parsed.conclusion || ""),
        summary: String(parsed.summary || "").slice(0, 500),
      };
    } catch {
      return { score: 0, risks: [], conclusion: "", summary: "" };
    }
  }

  // ========== 全方位审核（九大维度，两阶段） ==========

  /**
   * 阶段一：根据采购文件 + 项目需求生成动态审核清单 + 采购要求逐条清单
   * 返回 null 表示 LLM 未返回可解析结果
   */
  async generateAuditPlan(
    procurementText: string,
    projectReqText?: string
  ): Promise<AuditPlan | null> {
    // 章节感知摘要：避免盲截前 3 万字丢失中后部的服务要求/评分办法/格式清单
    const digest = buildPlanDigest(procurementText || "", 30000);
    const combined = digest + "\n" + (projectReqText || "").slice(0, 8000);
    if (!combined.trim()) return null;

    const content = await this.callLLM(
      buildAuditContext() + "\n\n" + GENERATE_AUDIT_PLAN_PROMPT,
      combined
    );
    if (!content) return null;

    try {
      const parsed = this.parseJSON(content);
      const rawMeta = (parsed && parsed.meta) || {};
      const meta: ProjectMeta = {
        projectName: String(rawMeta.projectName || "未命名项目").slice(0, 120),
        projectCode: rawMeta.projectCode ? String(rawMeta.projectCode).slice(0, 80) : undefined,
        purchaser: rawMeta.purchaser ? String(rawMeta.purchaser).slice(0, 80) : undefined,
        agency: rawMeta.agency ? String(rawMeta.agency).slice(0, 80) : undefined,
        evalMethod: rawMeta.evalMethod ? String(rawMeta.evalMethod).slice(0, 80) : undefined,
        budget: rawMeta.budget ? String(rawMeta.budget).slice(0, 120) : undefined,
        bidDeadline: rawMeta.bidDeadline ? String(rawMeta.bidDeadline).slice(0, 80) : undefined,
        starClauses: Array.isArray(rawMeta.starClauses)
          ? rawMeta.starClauses.map((s: unknown) => String(s)).filter(Boolean).slice(0, 15)
          : [],
      };

      const rawList: any[] = Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [];
      const ts = Date.now();
      const checkpoints: AuditCheckpoint[] = rawList
        .filter((c) => c && c.name && c.requirement && AUDIT_DIMENSIONS.has(c.dimension))
        .slice(0, 60)
        .map((c, idx) => ({
          id: `cp_${idx}_${ts}`,
          dimension: c.dimension as IssueDimension,
          name: String(c.name).slice(0, 60),
          requirement: String(c.requirement).slice(0, 400),
          basis: c.basis ? String(c.basis).slice(0, 200) : undefined,
          riskLevel: ["critical", "major", "minor"].includes(c.riskLevel)
            ? (c.riskLevel as "critical" | "major" | "minor")
            : "minor",
          enabled: true,
        }));

      if (checkpoints.length === 0) return null;

      // 采购要求逐条清单（用于后续"要求-响应"全覆盖比对）
      const rawReqs: any[] = Array.isArray(parsed.requirements) ? parsed.requirements : [];
      const requirements: ProcurementRequirement[] = rawReqs
        .filter((r) => r && r.content)
        .slice(0, 50)
        .map((r, idx) => ({
          id: `req_${idx}_${ts}`,
          category: r.category ? String(r.category).slice(0, 40) : "采购要求",
          content: String(r.content).slice(0, 400),
          mandatory: Boolean(r.mandatory),
          sourceClause: r.sourceClause ? String(r.sourceClause).slice(0, 160) : "",
        }));

      return { meta, checkpoints, requirements, generatedAt: ts };
    } catch (err) {
      console.warn("[LLM] generateAuditPlan: JSON parse failed", err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * 阶段二：对单个维度的一组审核要点做证据检索 + 判定，返回该维度 Issue[]
   * @param dimension 当前维度（强制覆盖 LLM 返回的 dimension，防止跑偏）
   * @param checkpoints 该维度下启用的审核要点
   * @param bidText 该投标人商务+技术合并全文
   */
  async auditDimensionBatch(
    dimension: IssueDimension,
    checkpoints: AuditCheckpoint[],
    bidText: string,
    meta?: ProjectMeta | null
  ): Promise<Issue[]> {
    if (checkpoints.length === 0 || !bidText.trim()) return [];

    // 1. 证据检索（复用私有方法：本地预筛选 + 小批量 LLM 检索）
    const evidenceMap = await this.retrieveEvidenceBatch(
      checkpoints.map((cp) => ({
        name: cp.name,
        desc: `${cp.requirement}${cp.basis ? `（依据：${cp.basis}）` : ""}`,
        keywords: extractAuditKeywords(cp.name, cp.requirement, dimension),
      })),
      bidText
    );

    // 2. 聚合要点 + 证据
    let anyEvidence = false;
    const brief = checkpoints
      .map((cp, i) => `${i + 1}. [${cp.riskLevel}] ${cp.name}\n   判定标准：${cp.requirement}${cp.basis ? `\n   依据：${cp.basis}` : ""}`)
      .join("\n");

    const evidenceParts = checkpoints.map((cp) => {
      const ev = evidenceMap[cp.name] || [];
      if (ev.length > 0) anyEvidence = true;
      const text = ev.length > 0 ? ev.map((e) => "· " + e).join("\n") : "（未检索到直接证据）";
      return `【要点】${cp.name}\n${text.slice(0, 1500)}`;
    });

    let evidenceText = evidenceParts.join("\n\n").slice(0, 16000);
    if (!anyEvidence) {
      evidenceText += `\n\n【兜底材料：投标文件前 12000 字符】\n${bidText.slice(0, 12000)}`;
    }

    const userMsg =
      `${buildAuditContext(meta)}\n\n` +
      `本批审核维度：${dimension}\n\n` +
      `招标审核要点：\n${brief}\n\n` +
      `投标文件证据片段：\n${evidenceText}`;

    const content = await this.callLLM(AUDIT_BATCH_PROMPT, userMsg);
    if (!content) return [];

    try {
      const arr = this.parseJSON(content);
      if (!Array.isArray(arr)) return [];
      const ts = Date.now();
      return arr
        .filter((x: any) => x && (x.name || x.description))
        .slice(0, 40)
        .map((x: any, idx: number) => normalizeIssue(x, dimension, idx, ts));
    } catch (err) {
      console.warn(`[LLM] auditDimensionBatch[${dimension}] parse failed`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * 补充：投标文件格式完整性对照 + 待人工核验清单
   *
   * 关键：
   * 1. 投标文件可能很长，先提取全部章节标题作为"目录索引"前置，避免截断导致误判缺失；
   * 2. 采购文件的实际格式清单（formatDigest）由调用方章节感知抽取后传入，对照以采购文件为准。
   */
  async auditCompleteness(
    bidText: string,
    formatDigest?: string,
    meta?: ProjectMeta | null
  ): Promise<{ completeness: CompletenessItem[]; manualCheck: string[] }> {
    if (!bidText.trim()) return { completeness: [], manualCheck: [] };

    // 提取所有章节标题行，作为目录索引前置
    const headings = extractHeadings(bidText);
    const catalog = headings.length > 0
      ? `【投标文件章节目录】\n${headings.join("\n")}\n【目录结束】\n\n`
      : "";
    const procurementList = formatDigest
      ? `【采购文件规定的投标文件格式/组成清单（原文摘录）】\n${formatDigest}\n【清单结束】\n\n`
      : `【采购文件规定的投标文件格式/组成清单】\n（未抽取到独立格式章节，请依据投标文件目录可见材料核查）\n\n`;
    const fullInput =
      `${buildAuditContext(meta)}\n\n` +
      procurementList +
      catalog +
      bidText;

    const content = await this.callLLM(AUDIT_COMPLETENESS_PROMPT, fullInput.slice(0, 24000));
    if (!content) return { completeness: [], manualCheck: [] };
    try {
      const parsed = this.parseJSON(content);
      const rawList: any[] = Array.isArray(parsed.completeness) ? parsed.completeness : [];
      const completeness: CompletenessItem[] = rawList
        .filter((c) => c && c.formatName)
        .slice(0, 30)
        .map((c) => ({
          formatId: String(c.formatId || "").slice(0, 10),
          formatName: String(c.formatName).slice(0, 60),
          required: c.required === "optional" ? "optional" : "required",
          fileName: c.fileName ? String(c.fileName).slice(0, 120) : "",
          status: ["complete", "partial", "missing"].includes(c.status) ? c.status : "partial",
          remark: c.remark ? String(c.remark).slice(0, 200) : undefined,
        }));
      const manualCheck: string[] = Array.isArray(parsed.manualCheck)
        ? parsed.manualCheck.map((s: unknown) => String(s)).filter(Boolean).slice(0, 20)
        : [];
      return { completeness, manualCheck };
    } catch (err) {
      console.warn("[LLM] auditCompleteness parse failed", err instanceof Error ? err.message : err);
      return { completeness: [], manualCheck: [] };
    }
  }

  /**
   * 采购要求逐条覆盖比对（治理"服务承诺等要求存在但未被审查出来"的漏检问题）
   * 对 plan.requirements 逐条检索投标证据，仅输出未响应/空泛响应/弱响应问题
   */
  async auditRequirementsCoverage(
    requirements: ProcurementRequirement[],
    bidText: string,
    meta?: ProjectMeta | null
  ): Promise<Issue[]> {
    const reqs = (requirements || []).filter((r) => r.content.trim());
    if (reqs.length === 0 || !bidText.trim()) return [];

    // 分批，每批 6 条要求，先做证据检索
    const BATCH = 6;
    const all: Issue[] = [];
    const ts = Date.now();

    for (let i = 0; i < reqs.length; i += BATCH) {
      const batch = reqs.slice(i, i + BATCH);
      const evidenceMap = await this.retrieveEvidenceBatch(
        batch.map((r) => ({
          name: r.content.slice(0, 30),
          desc: `${r.category}：${r.content}${r.mandatory ? "（强制性要求）" : ""}`,
          keywords: extractRequirementKeywords(r),
        })),
        bidText
      );

      const brief = batch
        .map((r, j) => `${j + 1}. [${r.mandatory ? "强制" : "一般"}][${r.category}] ${r.content}（出处：${r.sourceClause || "未注明"}）`)
        .join("\n");
      const evidenceText = batch
        .map((r) => {
          const ev = evidenceMap[r.content.slice(0, 30)] || [];
          return `【要求】${r.content}\n${ev.length > 0 ? ev.map((e) => "· " + e).join("\n").slice(0, 1400) : "（未检索到直接证据）"}`;
        })
        .join("\n\n")
        .slice(0, 14000);

      const userMsg =
        `${buildAuditContext(meta)}\n\n` +
        `采购要求清单：\n${brief}\n\n` +
        `投标文件证据片段：\n${evidenceText}`;

      const content = await this.callLLM(AUDIT_REQUIREMENTS_PROMPT, userMsg);
      if (!content) continue;
      try {
        const arr = this.parseJSON(content);
        if (!Array.isArray(arr)) continue;
        arr
          .filter((x: any) => x && (x.name || x.description))
          .slice(0, BATCH)
          .forEach((x: any, idx: number) => {
            all.push(normalizeIssue(x, "substantive", i + idx, ts + i + idx));
          });
      } catch (err) {
        console.warn("[LLM] auditRequirementsCoverage parse failed", err instanceof Error ? err.message : err);
      }
    }

    return all.slice(0, 40);
  }

  /**
   * 从招标文件评分办法抽取结构化评分项（严格忠于原文）
   * 权重在服务端按分值复核重算，避免模型算术错误
   */
  async extractScoringItems(
    procurementText: string,
    projectReqText?: string
  ): Promise<{ items: BidScoringItem[]; totalScore: number }> {
    if (!procurementText || !procurementText.trim()) return { items: [], totalScore: 0 };

    // 第一次：评分章节感知摘要（14k）；为空则第二次扩大窗口（24k）重试，覆盖评分办法位于中后段的情况
    const digests = [
      buildScoringDigest(procurementText, 14000),
      buildScoringDigest(procurementText, 24000),
    ];
    const extra = (projectReqText || "").slice(0, 4000);

    let parsed: any = null;
    for (let attempt = 0; attempt < digests.length; attempt++) {
      const digest = digests[attempt];
      const combined = digest + "\n" + extra;
      if (!combined.trim()) continue;
      const content = await this.callLLM(
        buildAuditContext() + "\n\n" + EXTRACT_SCORING_ITEMS_PROMPT,
        combined
      );
      if (!content) continue;
      try {
        parsed = this.parseJSON(content);
        const list: any[] = Array.isArray(parsed.items) ? parsed.items : [];
        if (list.length > 0) break; // 抽到评分项即停止重试
        console.warn(`[LLM] extractScoringItems 第${attempt + 1}次尝试返回 0 项（digest ${digest.length} 字）`);
      } catch (err) {
        console.warn(
          `[LLM] extractScoringItems 第${attempt + 1}次 JSON 解析失败`,
          err instanceof Error ? err.message : err
        );
      }
    }

    if (!parsed) return { items: [], totalScore: 0 };
    try {
      const rawList: any[] = Array.isArray(parsed.items) ? parsed.items : [];
      const ts = Date.now();
      const items: BidScoringItem[] = rawList
        .filter((x) => x && x.name && Number.isFinite(Number(x.fullScore)) && Number(x.fullScore) > 0)
        .slice(0, 40)
        .map((x, idx) => ({
          id: `score_${idx}_${ts}`,
          code: x.code ? String(x.code).slice(0, 20) : String(idx + 1),
          name: String(x.name).slice(0, 80),
          category: x.category ? String(x.category).slice(0, 30) : "评分项",
          description: String(x.description || "").slice(0, 500),
          fullScore: Math.round(Number(x.fullScore) * 10) / 10,
          weight: Number(x.weight) || 0,
          rules: String(x.rules || "").slice(0, 800),
          sourceClause: x.sourceClause ? String(x.sourceClause).slice(0, 160) : "",
        }));

      // 服务端复核权重：优先用评分项分值合计，其次模型给的总分
      const sumScore = items.reduce((s, x) => s + x.fullScore, 0);
      const base = sumScore > 0 ? sumScore : Number(parsed.totalScore) || 0;
      if (base > 0) {
        items.forEach((x) => {
          x.weight = Math.round((x.fullScore / base) * 1000) / 10;
        });
      }
      console.log(`[LLM] 评分项抽取成功：${items.length} 项，总分 ${base || "未知"}`);
      return { items, totalScore: base };
    } catch (err) {
      console.warn("[LLM] extractScoringItems 结果映射失败", err instanceof Error ? err.message : err);
      return { items: [], totalScore: 0 };
    }
  }

  /**
   * 依据评分项对投标文件逐项打分（证据检索 + LLM 引用原文打分，结果可追溯）
   */
  async scoreBidItems(
    items: BidScoringItem[],
    bidText: string,
    meta?: ProjectMeta | null
  ): Promise<ScoringAssessment[]> {
    if (items.length === 0 || !bidText.trim()) return [];

    const BATCH = 3;
    const out: ScoringAssessment[] = [];

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const evidenceMap = await this.retrieveEvidenceBatch(
        batch.map((it) => ({
          name: it.name,
          desc: `${it.description} ${it.rules}`,
          keywords: extractScoringKeywords(it),
        })),
        bidText
      );

      const brief = batch
        .map((it, j) => `${j + 1}. 编号 ${it.code}｜[${it.category}] ${it.name}（满分 ${it.fullScore} 分）\n   评分标准：${it.description}\n   评分细则：${it.rules}\n   招标出处：${it.sourceClause || "未注明"}`)
        .join("\n\n");
      const evidenceText = batch
        .map((it) => {
          const ev = evidenceMap[it.name] || [];
          return `【评分项 ${it.code}】${it.name}\n${ev.length > 0 ? ev.map((e) => "· " + e).join("\n").slice(0, 2000) : "（未检索到直接证据）"}`;
        })
        .join("\n\n")
        .slice(0, 16000);

      const userMsg =
        `${buildAuditContext(meta)}\n\n` +
        `评分项与评分细则：\n${brief}\n\n` +
        `投标文件证据片段：\n${evidenceText}`;

      const content = await this.callLLM(SCORE_BID_PROMPT, userMsg);
      if (!content) continue;
      try {
        const arr = this.parseJSON(content);
        if (!Array.isArray(arr)) continue;
        batch.forEach((it, idx) => {
          const found =
            arr.find((x: any) => String(x.code) === String(it.code)) || arr[idx] || null;
          if (!found) return;
          const rawScore = Number(found.score);
          const score = Number.isFinite(rawScore)
            ? Math.min(it.fullScore, Math.max(0, Math.round(rawScore * 10) / 10))
            : 0;
          out.push({
            itemId: it.id,
            score,
            maxScore: it.fullScore,
            bidChapter: found.bidChapter ? String(found.bidChapter).slice(0, 120) : "",
            bidPage: Number.isInteger(Number(found.bidPage)) ? Number(found.bidPage) : undefined,
            bidParagraph: found.bidParagraph ? String(found.bidParagraph).slice(0, 160) : "",
            criterionClause: found.criterionClause ? String(found.criterionClause).slice(0, 400) : "",
            evidenceQuote: found.evidenceQuote ? String(found.evidenceQuote).slice(0, 300) : "",
            explanation: found.explanation ? String(found.explanation).slice(0, 500) : "",
            needManualCheck: Boolean(found.needManualCheck),
          });
        });
      } catch (err) {
        console.warn("[LLM] scoreBidItems parse failed", err instanceof Error ? err.message : err);
      }
    }

    return out;
  }

  /**
   * 从 LLM 返回内容中解析 JSON（兼容 markdown 代码块包裹）
   */
  private parseJSON(content: string): any {
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    return JSON.parse(jsonStr);
  }

  private async callLLM(system: string, user: string): Promise<string> {
    try {
      // 外部模型发送前必须脱敏
      const safeUser = this.needSanitize ? sanitizeText(user) : user;
      const res = await this.client.chat([
        { role: "system", content: system },
        { role: "user", content: safeUser },
      ]);
      return res.content;
    } catch (err) {
      console.warn("[LLM] call failed:", err instanceof Error ? err.message : err);
      return "";
    }
  }
}

/**
 * 从 ReviewConfig 构建 LLMConfig
 */
export function buildLLMConfig(config: ReviewConfig): LLMConfig | null {
  if (!config.llm?.enabled) return null;
  return {
    enabled: true,
    provider: config.llm.provider as LLMConfig["provider"],
    apiKey: config.llm.apiKey,
    scope: config.llm.scope,
  };
}

// ========== 全方位审核辅助常量与函数 ==========

const AUDIT_DIMENSIONS = new Set<IssueDimension>([
  "qualification", "substantive", "consistency", "structure", "template",
  "signature", "textFlaw", "highlight", "completeness",
]);

const VALID_RISK_LEVELS: RiskLevel[] = ["critical", "major", "minor", "info", "highlight"];

/** 各维度的补充检索关键词，提升证据预筛选阶段的召回率 */
const DIM_KEYWORDS: Record<IssueDimension, string[]> = {
  qualification: ["营业执照", "资质", "资格", "财务", "税收", "社保", "违法", "信用", "声明", "认证"],
  substantive: ["★", "●", "必须", "无效", "否决", "有效期", "报价", "预算", "承诺", "盖章", "联合体", "备选"],
  consistency: ["业绩", "金额", "时间", "人员", "证书", "年限", "报价", "合计", "数量", "矛盾", "一致"],
  structure: ["序号", "列", "页码", "索引", "明细", "合计", "分项", "签字", "日期", "联系", "手机"],
  template: ["XXX", "xxx", "详见", "模板", "监理", "施工", "咨询", "自行补充", "待填", "占位"],
  signature: ["●", "签字", "盖章", "公章", "签名", "签章", "授权", "法定代表人"],
  textFlaw: ["编号", "页脚", "正本", "应答", "对答", "断句", "图", "表"],
  highlight: ["正偏离", "优于", "分钟", "小时", "全覆盖", "社保", "满分", "增值", "演练", "承诺"],
  completeness: ["投标书", "授权委托书", "开标一览表", "报价明细表", "资格证明", "声明", "人员安排", "负责人", "业绩", "服务方案", "服务承诺", "基本情况", "索引"],
};

/** 从要点名称+要求中提取证据预筛关键词（中文按停顿切短语，叠加维度词典） */
function extractAuditKeywords(name: string, requirement: string, dimension: IssueDimension): string[] {
  const raw = `${name} ${requirement} ${(DIM_KEYWORDS[dimension] || []).join(" ")}`;
  const parts = raw
    .split(/[，。；：、,.;:（）()\[\]【】\s/／|""''""'']+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 16);
  const set = new Set<string>();
  parts.forEach((p) => set.add(p));
  (DIM_KEYWORDS[dimension] || []).forEach((k) => set.add(k));
  return Array.from(set).slice(0, 24);
}

/** 从采购要求中提取证据预筛关键词（类别词 + 要求中的短语切分） */
function extractRequirementKeywords(r: ProcurementRequirement): string[] {
  const categoryHints: Record<string, string[]> = {
    服务: ["服务", "响应", "到场", "驻场", "时限", "承诺", "保障", "应急", "巡检"],
    商务: ["报价", "付款", "有效期", "承诺", "保证金", "发票", "合同"],
    技术: ["方案", "技术", "系统", "设备", "功能", "指标", "部署", "安全"],
    人员: ["人员", "资质", "证书", "职称", "资历", "配备", "驻场"],
    质保: ["质保", "保修", "售后", "维护", "免费", "年限"],
    培训: ["培训", "授课", "教材", "考核"],
    验收: ["验收", "标准", "交付", "成果"],
  };
  const hintWords = Object.entries(categoryHints)
    .filter(([k]) => r.category.includes(k) || r.content.includes(k))
    .flatMap(([, v]) => v);
  const phrases = `${r.category} ${r.content}`
    .split(/[，。；：、,.;:（）()\[\]【】\s/／|""''""'']+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 14);
  return Array.from(new Set([...hintWords, ...phrases])).slice(0, 22);
}

/** 从评分项中提取证据预筛关键词（评分项名 + 描述/细则短语） */
function extractScoringKeywords(it: BidScoringItem): string[] {
  const phrases = `${it.category} ${it.name} ${it.description}`
    .split(/[，。；：、,.;:（）()\[\]【】\s/／|""''""'']+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 14);
  return Array.from(new Set([it.name, it.category, ...phrases])).slice(0, 20);
}

/**
 * 从投标文件全文中提取所有章节标题行，作为完整性检查的目录索引
 * 匹配：第X章、一、二、（一）、1. 2. 等编号开头的行
 */
function extractHeadings(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const headings: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length > 80) continue;
    // 第X章/第X条/第X部分
    if (/^第[一二三四五六七八九十百千\d]+[章节条部分款]/.test(line)) {
      headings.push(line);
      continue;
    }
    // 一、二、三、（中文数字+顿号）
    if (/^[一二三四五六七八九十]+、/.test(line)) {
      headings.push(line);
      continue;
    }
    // （一）（二）中文括号数字
    if (/^[（(][一二三四五六七八九十]+[）)]/.test(line)) {
      headings.push(line);
      continue;
    }
    // 1. 2. 3. 阿拉伯数字+点
    if (/^\d+[.、]/.test(line)) {
      headings.push(line);
      continue;
    }
  }
  // 去重保序
  return Array.from(new Set(headings));
}

function toPositiveIntOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** 将 LLM 返回的单个问题规范化为 Issue（强制对齐维度，补齐 id/位置） */
function normalizeIssue(x: any, dimension: IssueDimension, idx: number, ts: number): Issue {
  let riskLevel: RiskLevel = VALID_RISK_LEVELS.includes(x.riskLevel) ? (x.riskLevel as RiskLevel) : "minor";
  // 亮点维度的产出一律标记为 highlight
  if (dimension === "highlight") riskLevel = "highlight";

  const loc = x.location || {};
  return {
    id: `llm_issue_${dimension}_${idx}_${ts}`,
    dimension,
    name: String(x.name || "未命名问题").slice(0, 80),
    riskLevel,
    location: {
      file: loc.file ? String(loc.file).slice(0, 60) : "投标文件",
      chapter: loc.chapter ? String(loc.chapter).slice(0, 80) : undefined,
      page: toPositiveIntOrUndefined(loc.page),
      tableId: loc.tableId ? String(loc.tableId).slice(0, 30) : undefined,
      tableRow: toPositiveIntOrUndefined(loc.tableRow),
      snippet: loc.snippet ? String(loc.snippet).slice(0, 80) : undefined,
    },
    description: String(x.description || "").slice(0, 600),
    evidence: x.evidence ? String(x.evidence).slice(0, 400) : undefined,
    basis: x.basis ? String(x.basis).slice(0, 200) : undefined,
    remediation: x.remediation ? String(x.remediation).slice(0, 300) : undefined,
  };
}

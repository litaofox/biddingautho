// LLM 增强模块 - 统一适配层
// 支持 OpenAI / 百度千帆 / 智谱 GLM / 通义千问 / 本地兼容模型
import type { ReviewConfig, ReviewItem, RejectionItem, ScoringItem } from "../types.js";
import {
  EXTRACT_REVIEW_DIMENSIONS_PROMPT,
  RETRIEVE_EVIDENCE_PROMPT,
  JUDGE_COMPLIANCE_PROMPT,
  JUDGE_REJECTION_PROMPT,
  JUDGE_SCORING_PROMPT,
  EVALUATE_PROMPT,
} from "../llmEngine/prompts.js";

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

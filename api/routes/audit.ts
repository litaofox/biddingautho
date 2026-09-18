// LLM 全方位审核路由（两阶段）
// POST /api/audit/plan          生成动态审核清单
// POST /api/audit/plan/confirm  保存用户确认/编辑后的清单
// POST /api/audit/run           依据确认清单执行 LLM 审查，产出 MultiDimReviewResult
import { Router, type Request, type Response } from "express";
import { LLMAugmenter, type LLMConfig } from "../llm/index.js";
import { generateAuditPlan, runLlmAudit } from "../llmEngine/auditEngine.js";
import { getTask, updateTask } from "../store/memory.js";
import type {
  AuditCheckpoint,
  AuditPlan,
  IssueDimension,
  ProjectMeta,
} from "../types.js";

const router = Router();

const VALID_PROVIDERS = ["openai", "qianfan", "glm", "qianwen", "local"];
const VALID_DIMENSIONS = new Set<IssueDimension>([
  "qualification", "substantive", "consistency", "structure", "template",
  "signature", "textFlaw", "highlight", "completeness",
]);
const VALID_RISK = ["critical", "major", "minor"];

/** 构造 LLMAugmenter（scope 对全方位审核方法不做限制，脱敏由 provider 决定） */
function createAugmenter(provider: string, apiKey: string): LLMAugmenter {
  return new LLMAugmenter({
    enabled: true,
    provider: provider as LLMConfig["provider"],
    apiKey: apiKey || "",
    scope: ["audit"],
  });
}

function validateProvider(provider: unknown, apiKey: unknown): string | null {
  const p = String(provider || "");
  if (!VALID_PROVIDERS.includes(p)) return "请指定有效的 LLM 服务商";
  if (p !== "local" && !apiKey) return "使用外部大模型请填写 API Key";
  return null;
}

/**
 * POST /api/audit/plan
 * body: { sessionId, provider, apiKey }
 * 大模型读取采购文件+需求，动态生成审核清单（不立即审查）
 */
router.post("/plan", async (req: Request, res: Response) => {
  try {
    const { sessionId, provider, apiKey } = req.body as {
      sessionId: string;
      provider: string;
      apiKey: string;
    };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.procurement) {
      return res.status(400).json({ success: false, error: "缺少采购文件" });
    }
    const providerError = validateProvider(provider, apiKey);
    if (providerError) {
      return res.status(400).json({ success: false, error: providerError });
    }

    const augmenter = createAugmenter(provider, apiKey);
    const plan = await generateAuditPlan(augmenter, task);

    // 暂存清单与 LLM 配置，等待用户确认
    updateTask(sessionId, {
      auditPlan: plan,
      auditLlmConfig: { provider, apiKey: apiKey || "", scope: ["audit"] },
    });

    res.json({
      success: true,
      plan,
      message: `已根据本项目采购文件生成 ${plan.checkpoints.length} 条审核要点，请确认或调整后开始 AI 审查`,
    });
  } catch (err) {
    console.error("[audit/plan] error:", err);
    const msg = err instanceof Error ? err.message : "审核清单生成失败";
    res.status(500).json({ success: false, error: msg });
  }
});

/** 清洗前端回传的项目元信息 */
function normalizeMeta(raw: any, fallback: ProjectMeta): ProjectMeta {
  if (!raw || !raw.projectName) return fallback;
  return {
    projectName: String(raw.projectName).slice(0, 120),
    projectCode: raw.projectCode ? String(raw.projectCode).slice(0, 80) : undefined,
    purchaser: raw.purchaser ? String(raw.purchaser).slice(0, 80) : undefined,
    agency: raw.agency ? String(raw.agency).slice(0, 80) : undefined,
    evalMethod: raw.evalMethod ? String(raw.evalMethod).slice(0, 80) : undefined,
    budget: raw.budget ? String(raw.budget).slice(0, 120) : undefined,
    bidDeadline: raw.bidDeadline ? String(raw.bidDeadline).slice(0, 80) : undefined,
    starClauses: Array.isArray(raw.starClauses)
      ? raw.starClauses.map((s: unknown) => String(s)).filter(Boolean).slice(0, 15)
      : fallback.starClauses,
  };
}

/**
 * POST /api/audit/plan/confirm
 * body: { sessionId, plan }
 * 保存用户勾选/编辑后的审核清单
 */
router.post("/plan/confirm", (req: Request, res: Response) => {
  try {
    const { sessionId, plan: rawPlan } = req.body as { sessionId: string; plan: any };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.auditPlan) {
      return res.status(400).json({ success: false, error: "尚未生成审核清单" });
    }

    const rawCheckpoints: any[] = Array.isArray(rawPlan?.checkpoints) ? rawPlan.checkpoints : [];
    const ts = Date.now();
    const checkpoints: AuditCheckpoint[] = rawCheckpoints
      .filter((c) => c && c.name && c.requirement && VALID_DIMENSIONS.has(c.dimension))
      .slice(0, 80)
      .map((c, idx) => ({
        id: c.id ? String(c.id) : `cp_c_${idx}_${ts}`,
        dimension: c.dimension as IssueDimension,
        name: String(c.name).slice(0, 60),
        requirement: String(c.requirement).slice(0, 400),
        basis: c.basis ? String(c.basis).slice(0, 200) : undefined,
        riskLevel: VALID_RISK.includes(c.riskLevel) ? c.riskLevel : "minor",
        enabled: c.enabled !== false,
      }));

    if (checkpoints.length === 0) {
      return res.status(400).json({ success: false, error: "审核清单中没有有效的审查要点" });
    }

    const confirmedPlan: AuditPlan = {
      meta: normalizeMeta(rawPlan?.meta, task.auditPlan.meta),
      checkpoints,
      generatedAt: task.auditPlan.generatedAt,
    };

    updateTask(sessionId, { auditPlan: confirmedPlan });
    res.json({
      success: true,
      plan: confirmedPlan,
      enabledCount: checkpoints.filter((c) => c.enabled).length,
    });
  } catch (err) {
    console.error("[audit/plan/confirm] error:", err);
    res.status(500).json({ success: false, error: "保存审核清单失败" });
  }
});

/**
 * POST /api/audit/run
 * body: { sessionId }
 * 依据已确认清单执行 LLM 全方位审查，结果写入 task.multiDimResult
 */
router.post("/run", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body as { sessionId: string };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.auditPlan) {
      return res.status(400).json({ success: false, error: "尚未生成并确认审核清单" });
    }
    if (!task.auditLlmConfig) {
      return res.status(400).json({ success: false, error: "缺少大模型配置，请重新生成审核清单" });
    }

    const augmenter = createAugmenter(
      task.auditLlmConfig.provider,
      task.auditLlmConfig.apiKey
    );

    const result = await runLlmAudit(augmenter, task);

    updateTask(sessionId, {
      multiDimResult: result,
      reviewMode: "llm",
    });

    res.json({ success: true, result });
  } catch (err) {
    console.error("[audit/run] error:", err);
    const msg = err instanceof Error ? err.message : "AI 审查失败";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;

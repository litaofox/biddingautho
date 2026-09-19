// LLM 全方位审核路由
// POST /api/audit/plan          生成动态审核清单
// POST /api/audit/plan/confirm  保存用户确认/编辑后的清单
// POST /api/audit/run           依据确认清单执行 LLM 审查，产出 MultiDimReviewResult
// POST /api/audit/auto          一键全自动审核（生成清单→自动确认→审查），进度写入 task
// GET  /api/audit/progress/:sid 查询审核进度
import { Router, type Request, type Response } from "express";
import { LLMAugmenter, type LLMConfig } from "../llm/index.js";
import { generateAuditPlan, runLlmAudit } from "../llmEngine/auditEngine.js";
import { getTask, updateTask } from "../store/memory.js";
import type {
  AuditCheckpoint,
  AuditPlan,
  AuditProgress,
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

/**
 * GET /api/audit/progress/:sessionId
 * 查询一键审核执行进度
 */
router.get("/progress/:sessionId", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }
  res.json({ success: true, progress: task.auditProgress || null });
});

/**
 * POST /api/audit/auto
 * body: { sessionId, provider, apiKey }
 * 一键全自动审核：生成清单 → 全部要点自动确认 → 逐维度 LLM 审查 → 结果落库
 * 接口立即响应，执行过程异步进行，前端通过 /progress 轮询进度
 */
router.post("/auto", async (req: Request, res: Response) => {
  try {
    const { sessionId, provider, apiKey, simulateScoring } = req.body as {
      sessionId: string;
      provider: string;
      apiKey: string;
      simulateScoring?: boolean;
    };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    const providerError = validateProvider(provider, apiKey);
    if (providerError) {
      return res.status(400).json({ success: false, error: providerError });
    }
    if (task.auditProgress?.status === "running") {
      return res.status(409).json({ success: false, error: "审核正在进行中，请勿重复提交" });
    }

    // 立即响应，后台异步执行
    res.json({ success: true, message: "已开始全自动审核" });

    // 模拟打分功能总开关（暂时下线；恢复时改回 true 即可，引擎与展示层代码均保留）
    const SIMULATE_SCORING_ENABLED = false;
    const doSimulateScoring = SIMULATE_SCORING_ENABLED && simulateScoring !== false;
    const steps = [
      { key: "parse", label: "文件解析", status: "done" as const },
      { key: "plan", label: "AI 生成审核清单", status: "active" as const },
      { key: "audit", label: "逐维度合规性检查与内容比对", status: "pending" as const },
      { key: "requirements", label: "采购要求逐条响应比对", status: "pending" as const },
      ...(doSimulateScoring
        ? [{ key: "scoring", label: "评分标准解析与逐项打分", status: "pending" as const }]
        : []),
      { key: "completeness", label: "完整性对照检查", status: "pending" as const },
      { key: "remediation", label: "生成整改清单与审核结论", status: "pending" as const },
      { key: "done", label: "审核完成", status: "pending" as const },
    ];

    const writeProgress = (
      percent: number,
      stage: string,
      message: string,
      status: AuditProgress["status"],
      extra?: Partial<AuditProgress>
    ) => {
      const stepKeys = steps.map((s) => s.key);
      const idx = stepKeys.indexOf(stage);
      const curSteps = steps.map((s, i) => ({
        ...s,
        status:
          i < idx ? ("done" as const) : i === idx ? ("active" as const) : ("pending" as const),
      }));
      // 完成态：全部 done
      if (status === "done") {
        curSteps.forEach((s) => (s.status = "done"));
      }
      updateTask(sessionId, {
        auditProgress: {
          status,
          percent,
          stage,
          message,
          steps: curSteps,
          updatedAt: Date.now(),
          ...extra,
        },
      });
    };

    (async () => {
      try {
        const augmenter = createAugmenter(provider, apiKey);
        updateTask(sessionId, {
          auditLlmConfig: {
            provider,
            apiKey: apiKey || "",
            scope: ["audit"],
            simulateScoring: doSimulateScoring,
          },
        });

    // 阶段一：生成审核清单（0 ~ 25%）
    writeProgress(5, "plan", "AI 正在阅读采购文件，梳理审核要点…", "running");
    const plan = await generateAuditPlan(augmenter, getTask(sessionId)!);
    plan.checkpoints.forEach((c) => (c.enabled = true)); // 自动确认全部要点
    updateTask(sessionId, { auditPlan: plan });
    writeProgress(
      25,
      "audit",
      `已生成 ${plan.checkpoints.length} 个审核要点，开始逐项审查投标文件…`,
      "running"
    );

        // 阶段二：逐维度审查（30 ~ 96%，含完整性与整改）
        const latestTask = getTask(sessionId)!;
        const result = await runLlmAudit(augmenter, latestTask, (percent, stage, message) => {
          const stageKey =
            stage.startsWith("dim_") || stage === "scoreplan"
              ? "audit"
              : stage === "requirements"
              ? "requirements"
              : stage === "scoring"
              ? "scoring"
              : stage === "completeness"
              ? "completeness"
              : "remediation";
          writeProgress(percent, stageKey, message, "running");
        });

        updateTask(sessionId, {
          multiDimResult: result,
          reviewMode: "llm",
        });

        writeProgress(100, "done", "审核全部完成，正在为您整理结果…", "done");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI 审核失败";
        console.error("[audit/auto] error:", err);
        const cur = getTask(sessionId)?.auditProgress;
        updateTask(sessionId, {
          auditProgress: {
            status: "error",
            percent: cur?.percent || 0,
            stage: cur?.stage || "unknown",
            message: "审核失败",
            steps: cur?.steps || steps,
            error: msg,
            updatedAt: Date.now(),
          },
        });
      }
    })();
  } catch (err) {
    console.error("[audit/auto] error:", err);
    const msg = err instanceof Error ? err.message : "启动审核失败";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;

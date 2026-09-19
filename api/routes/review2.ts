// 多维审核 API 路由（F1-F10 升级版）
// 与现有 bidding.ts 路由并存，提供更全面的审核能力
import { Router, type Request, type Response } from "express";
import type { MultiDimConfig } from "../engine/orchestrator.js";
import { runMultiDimReview } from "../engine/orchestrator.js";
import { generateMultiDimReport } from "../report/multiDimReport.js";
import { getTask, updateTask } from "../store/memory.js";

const router = Router();

interface MultiDimExportOptions {
  summary?: boolean;
  critical?: boolean;
  major?: boolean;
  minor?: boolean;
  highlights?: boolean;
  remediation?: boolean;
  manualCheck?: boolean;
  completeness?: boolean;
}

/**
 * POST /api/review2/multi-dim
 * 执行多维审核（F1-F8 八大维度）
 */
router.post("/multi-dim", async (req: Request, res: Response) => {
  try {
    const { sessionId, config } = req.body as {
      sessionId: string;
      config?: MultiDimConfig;
    };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.procurement) {
      return res.status(400).json({ success: false, error: "缺少采购文件，无法执行多维审核" });
    }
    if (task.bidders.length === 0) {
      return res.status(400).json({ success: false, error: "没有投标文件" });
    }

    const result = await runMultiDimReview(task.bidders, task.procurement, config);
    updateTask(sessionId, { multiDimResult: result });

    res.json({ success: true, result });
  } catch (err) {
    console.error("[multi-dim review] error:", err);
    const msg = err instanceof Error ? err.message : "多维审核失败";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/review2/issues/:sessionId
 * 获取多维审核问题列表（按风险等级分组）
 */
router.get("/issues/:sessionId", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }
  if (!task.multiDimResult) {
    return res.status(400).json({ success: false, error: "尚未执行多维审核" });
  }
  const r = task.multiDimResult;
  res.json({
    success: true,
    critical: r.issues.filter((i) => i.riskLevel === "critical"),
    major: r.issues.filter((i) => i.riskLevel === "major"),
    minor: r.issues.filter((i) => i.riskLevel === "minor" || i.riskLevel === "info"),
    highlights: r.highlights,
    summary: r.summary,
  });
});

/**
 * GET /api/review2/remediation/:sessionId
 * 获取整改清单（P0/P1/P2 + 待人工核验项）
 */
router.get("/remediation/:sessionId", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }
  if (!task.multiDimResult) {
    return res.status(400).json({ success: false, error: "尚未执行多维审核" });
  }
  res.json({
    success: true,
    remediationPlan: task.multiDimResult.remediationPlan,
  completeness: task.multiDimResult.completeness,
  summary: task.multiDimResult.summary,
  highlights: task.multiDimResult.highlights,
  issues: task.multiDimResult.issues,
  bidders: task.multiDimResult.bidders,
  scoringIndex: task.multiDimResult.scoringIndex,
  mode: task.multiDimResult.mode,
  procurement: task.procurement.name,
  createdAt: task.createdAt,
  generatedAt: Date.now(),
  } as const);
});

/**
 * POST /api/review2/multi-dim/auto
 * 一键本地检查：接口立即响应，后台执行规则引擎多维审核，进度写入 task.auditProgress
 * 前端统一通过 GET /api/audit/progress/:sessionId 轮询
 */
router.post("/multi-dim/auto", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body as { sessionId: string };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.procurement) {
      return res.status(400).json({ success: false, error: "缺少采购文件，无法执行多维审核" });
    }
    if (task.bidders.length === 0) {
      return res.status(400).json({ success: false, error: "没有投标文件" });
    }
    if (task.auditProgress?.status === "running") {
      return res.status(409).json({ success: false, error: "审核正在进行中，请勿重复提交" });
    }

    res.json({ success: true, message: "已开始本地检查" });

    const steps = [
      { key: "parse", label: "文件解析", status: "done" as const },
      { key: "audit", label: "规则引擎逐项合规检查", status: "active" as const },
      { key: "completeness", label: "完整性对照检查", status: "pending" as const },
      { key: "remediation", label: "生成整改清单与审核结论", status: "pending" as const },
      { key: "done", label: "检查完成", status: "pending" as const },
    ];
    const stepOf = (stage: string, status: "active" | "done") =>
      steps.map((s, i) => {
        const idx = steps.findIndex((x) => x.key === stage);
        return { ...s, status: i < idx ? "done" : i === idx ? status : ("pending" as const) };
      });

    (async () => {
      try {
        updateTask(sessionId, {
          auditProgress: {
            status: "running",
            percent: 15,
            stage: "audit",
            message: "规则引擎正在逐项检查资格、实质性条款、签章、数据一致性…",
            steps: stepOf("audit", "active"),
            updatedAt: Date.now(),
          },
        });

        const result = await runMultiDimReview(task.bidders, task.procurement, { mode: "local" });
        updateTask(sessionId, { multiDimResult: result, reviewMode: "local" });

        updateTask(sessionId, {
          auditProgress: {
            status: "done",
            percent: 100,
            stage: "done",
            message: "本地检查全部完成，正在为您整理结果…",
            steps: steps.map((s) => ({ ...s, status: "done" as const })),
            updatedAt: Date.now(),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "本地检查失败";
        console.error("[multi-dim auto] error:", err);
        const cur = getTask(sessionId)?.auditProgress;
        updateTask(sessionId, {
          auditProgress: {
            status: "error",
            percent: cur?.percent || 0,
            stage: cur?.stage || "unknown",
            message: "检查失败",
            steps: cur?.steps || steps,
            error: msg,
            updatedAt: Date.now(),
          },
        });
      }
    })();
  } catch (err) {
    console.error("[multi-dim auto] error:", err);
    const msg = err instanceof Error ? err.message : "启动本地检查失败";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * POST /api/review2/export
 * 导出多维审核 HTML 报告
 */
router.post("/export", (req: Request, res: Response) => {
  try {
    const { sessionId, options } = req.body as {
      sessionId: string;
      options: MultiDimExportOptions;
    };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.multiDimResult) {
      return res.status(400).json({ success: false, error: "尚未执行多维审核" });
    }

    const defaultOptions: MultiDimExportOptions = {
      summary: true,
      critical: true,
      major: true,
      minor: true,
      highlights: true,
      remediation: true,
      manualCheck: true,
      completeness: true,
    };
    const opts = { ...defaultOptions, ...options };

    const html = generateMultiDimReport(task, task.multiDimResult, opts);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const filename = encodeURIComponent("投标文件全方位审核报告.html");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.send(html);
  } catch (err) {
    console.error("[multi-dim export] error:", err);
    res.status(500).json({ success: false, error: "多维报告生成失败" });
  }
});

export default router;

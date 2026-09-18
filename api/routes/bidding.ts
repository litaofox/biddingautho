// 投标书审查 API 路由
import { Router, type Request, type Response } from "express";
import multer from "multer";
import type { Bidder, ReviewConfig, ReviewItem, ReviewItemSet } from "../types.js";
import { createTask, getTask, updateTask } from "../store/memory.js";
import { parseDocx, generateId } from "../parsers/word.js";
import { runReview } from "../engine/index.js";
import { generateHtmlReport } from "../report/index.js";
import { reviewRules } from "../engine/rules.js";
import { extractProjectRules } from "../engine/projectRules.js";
import { LLMAugmenter } from "../llm/index.js";

const router = Router();

// 内存存储上传文件（multer memoryStorage）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

/**
 * 检查文件是否为支持的格式（.pdf / .doc / .docx）
 */
function isSupportedDoc(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".pdf") || lower.endsWith(".docx") || lower.endsWith(".doc");
}

/**
 * 修正中文文件名编码
 * multer 默认用 latin1 解析 Content-Disposition 中的文件名，
 * 中文会乱码，需从 latin1 转回 UTF-8
 */
function decodeFilename(name: string): string {
  try {
    // 检测是否是乱码（latin1 解析中文会产生高字节字符）
    // 先尝试 latin1 -> utf8，如果结果包含替换字符则用原名
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    if (!decoded.includes("\uFFFD")) {
      return decoded;
    }
    return name;
  } catch {
    return name;
  }
}

/**
 * POST /api/upload - 上传采购文件和投标文件
 */
router.post("/upload", (req: Request, res: Response) => {
  // 手动调用 multer 以捕获其错误
  upload.fields([
    { name: "procurement", maxCount: 1 },
    { name: "projectReq", maxCount: 1 },
    { name: "bidderFiles", maxCount: 10 },
  ])(req, res, (multerErr) => {
    if (multerErr) {
      console.error("[upload] multer error:", multerErr);
      if ((multerErr as { code?: string }).code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ success: false, error: "文件大小超过 100MB 限制" });
      }
      return res.status(400).json({ success: false, error: "文件上传失败: " + (multerErr as Error).message });
    }

    handleUpload(req, res);
  });
});

async function handleUpload(req: Request, res: Response) {
  try {
    const files = req.files as {
      procurement?: Express.Multer.File[];
      projectReq?: Express.Multer.File[];
      bidderFiles?: Express.Multer.File[];
    };

    if (!files.procurement || files.procurement.length === 0) {
      return res.status(400).json({ success: false, error: "缺少采购文件" });
    }

    // 修正中文文件名编码（multer 默认 latin1）
    const procurementName = decodeFilename(files.procurement[0].originalname);

    // 检查采购文件格式
    if (!isSupportedDoc(procurementName)) {
      return res.status(400).json({ success: false, error: "采购文件仅支持 .pdf、.doc 或 .docx 格式" });
    }

    // 检查项目需求文件格式
    let projectReqName = "";
    if (files.projectReq && files.projectReq.length > 0) {
      projectReqName = decodeFilename(files.projectReq[0].originalname);
      if (!isSupportedDoc(projectReqName)) {
        return res.status(400).json({ success: false, error: "项目需求文件仅支持 .pdf、.doc 或 .docx 格式" });
      }
    }

    // 检查投标文件格式
    const bidderFiles = files.bidderFiles || [];
    for (const f of bidderFiles) {
      const fn = decodeFilename(f.originalname);
      if (!isSupportedDoc(fn)) {
        return res.status(400).json({ success: false, error: `投标文件 ${fn} 仅支持 .pdf、.doc 或 .docx 格式` });
      }
    }

    const sessionId = generateId();
    const task = createTask(sessionId);

    // 解析采购文件
    const procurement = await parseDocx(
      files.procurement[0].buffer,
      procurementName
    );

    // 解析项目需求（可选）
    let projectRequirements;
    if (files.projectReq && files.projectReq.length > 0) {
      projectRequirements = await parseDocx(
        files.projectReq[0].buffer,
        projectReqName
      );
    }

    // 解析投标文件
    let bidderNames: string[] = [];
    let fileTypes: string[] = [];
    try {
      bidderNames = JSON.parse(req.body.bidders || "[]");
      fileTypes = JSON.parse(req.body.fileTypes || "[]");
    } catch {
      return res.status(400).json({ success: false, error: "投标公司数据格式错误" });
    }

    // 并行解析所有投标文件（修正中文文件名编码）
    const parsedFiles = await Promise.all(
      bidderFiles.map((file) => parseDocx(file.buffer, decodeFilename(file.originalname)))
    );

    // 按公司名称分组文件
    const bidderMap = new Map<string, Bidder>();
    bidderFiles.forEach((file, idx) => {
      const name = bidderNames[idx] || `公司${idx + 1}`;
      const type = (fileTypes[idx] || "technical") as "technical" | "commercial";

      if (!bidderMap.has(name)) {
        bidderMap.set(name, {
          id: generateId(),
          name,
          files: [],
        });
      }
      bidderMap.get(name)!.files.push({
        type,
        name: parsedFiles[idx].name,
        size: parsedFiles[idx].size,
        text: parsedFiles[idx].text,
        sections: parsedFiles[idx].sections,
      });
    });

    const bidders = Array.from(bidderMap.values());

    // 从采购文件和项目需求中提取项目特有审查项
    const projectItems = extractProjectRules(
      procurement.text,
      projectRequirements?.text
    );

    // 组装三层审查项集合
    const reviewItemSet: ReviewItemSet = {
      common: reviewRules, // 通用规则
      project: projectItems, // 项目特有规则（自动提取）
      custom: [], // 用户自定义（初始为空）
    };

    updateTask(sessionId, {
      procurement,
      projectRequirements,
      bidders,
      reviewItems: reviewItemSet,
    });

    res.json({
      success: true,
      sessionId,
      procurement: { name: procurement.name, size: procurement.size },
      projectRequirements: projectRequirements
        ? { name: projectRequirements.name, size: projectRequirements.size }
        : null,
      bidders: bidders.map((b) => ({
        id: b.id,
        name: b.name,
        files: b.files.map((f) => ({ type: f.type, name: f.name, size: f.size })),
      })),
      reviewItems: reviewItemSet,
    });
  } catch (err) {
    console.error("[upload] error:", err);
    const msg = err instanceof Error ? err.message : "未知错误";
    if (msg.includes("Word 转换失败")) {
      return res.status(400).json({
        success: false,
        error: ".doc 文件转换失败，请在 Word 中将文件另存为 .docx 后再上传。错误: " + msg,
      });
    }
    if (msg.includes("Could not find main document part") || msg.includes("file")) {
      return res.status(400).json({ success: false, error: "文件格式无效，请确认是有效的 Word 文件" });
    }
    res.status(500).json({ success: false, error: "文件解析失败: " + msg });
  }
}

/**
 * POST /api/review - 执行符合性审查（支持双模式）
 */
router.post("/review", async (req: Request, res: Response) => {
  try {
    const { sessionId, config } = req.body as { sessionId: string; config: ReviewConfig };
    const task = getTask(sessionId);

    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }

    if (task.bidders.length === 0) {
      return res.status(400).json({ success: false, error: "没有投标文件" });
    }

    // 合并三层审查项（通用 + 项目特有 + 用户自定义）
    const allRules: ReviewItem[] = task.reviewItems
      ? [...task.reviewItems.common, ...task.reviewItems.project, ...task.reviewItems.custom]
      : [];

    // 如果处于 LLM 模式，自动注入 LLM 配置，确保后续审查统一使用 LLM
    let reviewConfig = config;
    if (task.llmMode && task.llmConfig) {
      reviewConfig = {
        ...config,
        llm: {
          enabled: true,
          provider: task.llmConfig.provider,
          apiKey: task.llmConfig.apiKey,
          scope: task.llmConfig.scope,
        },
      };
    }

    // LLM 审核模式需要传入采购文件文本（从任务中读取，不经网络传输）
    if (reviewConfig.mode === "llm") {
      (reviewConfig as any).procurementText = task.procurement?.text || "";
      (reviewConfig as any).projectReqText = task.projectRequirements?.text;
    }

    const result = await runReview(task.bidders, reviewConfig, allRules);
    updateTask(sessionId, { config: reviewConfig, result, reviewMode: reviewConfig.mode || "local" });

    res.json({ success: true, result });
  } catch (err) {
    console.error("[review] error:", err);
    res.status(500).json({ success: false, error: "审查失败" });
  }
});

/**
 * GET /api/result/:sessionId - 获取审查结果
 */
router.get("/result/:sessionId", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }
  res.json({
    success: true,
    result: task.result,
  });
});

/**
 * POST /api/export - 导出 HTML 报告
 */
router.post("/export", (req: Request, res: Response) => {
  try {
    const { sessionId, options } = req.body as {
      sessionId: string;
      options: {
        complianceTable: boolean;
        comparisonDetails: boolean;
        evaluation: boolean;
        rejection?: boolean;
        scoring?: boolean;
        analysisLog?: boolean;
      };
    };
    const task = getTask(sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.result) {
      return res.status(400).json({ success: false, error: "尚未执行审查" });
    }

    const html = generateHtmlReport(task, options);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const filename = encodeURIComponent("审查报告.html");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.send(html);
  } catch (err) {
    console.error("[export] error:", err);
    res.status(500).json({ success: false, error: "报告生成失败" });
  }
});

/**
 * GET /api/review-items/:sessionId - 获取当前会话的审查项列表（三层）
 */
router.get("/review-items/:sessionId", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }
  res.json({
    success: true,
    reviewItems: task.reviewItems || { common: reviewRules, project: [], custom: [] },
  });
});

/**
 * POST /api/review-items/:sessionId/custom - 添加用户自定义审查项
 */
router.post("/review-items/:sessionId/custom", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }

  const { name, category, keywords, expectedText } = req.body as {
    name: string;
    category: "qualification" | "commitment" | "technical";
    keywords?: string[];
    expectedText?: string;
  };

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: "审查项名称不能为空" });
  }

  const newItem: ReviewItem = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    category: category || "commitment",
    scope: "custom",
    keywords: keywords && keywords.length > 0 ? keywords : [name.trim()],
    expectedText: expectedText || name.trim(),
  };

  if (!task.reviewItems) {
    task.reviewItems = { common: reviewRules, project: [], custom: [] };
  }
  task.reviewItems.custom.push(newItem);

  res.json({ success: true, item: newItem, reviewItems: task.reviewItems });
});

/**
 * DELETE /api/review-items/:sessionId/custom/:itemId - 删除用户自定义审查项
 */
router.delete("/review-items/:sessionId/custom/:itemId", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task || !task.reviewItems) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }

  const idx = task.reviewItems.custom.findIndex((i) => i.id === req.params.itemId);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: "自定义审查项不存在" });
  }

  task.reviewItems.custom.splice(idx, 1);
  res.json({ success: true, reviewItems: task.reviewItems });
});

/**
 * POST /api/review-items/:sessionId/regenerate - 使用 LLM 重新生成项目特有审查项
 * 触发后进入 LLM 模式，后续所有审查操作统一使用 LLM
 */
router.post("/review-items/:sessionId/regenerate", async (req: Request, res: Response) => {
  try {
    const task = getTask(req.params.sessionId);
    if (!task) {
      return res.status(404).json({ success: false, error: "会话不存在或已过期" });
    }
    if (!task.procurement) {
      return res.status(400).json({ success: false, error: "缺少采购文件，无法重新生成" });
    }

    const { provider, apiKey } = req.body as { provider: string; apiKey: string };

    if (!provider) {
      return res.status(400).json({ success: false, error: "请指定 LLM 服务商" });
    }
    if (provider !== "local" && !apiKey) {
      return res.status(400).json({ success: false, error: "请填写 API Key" });
    }

    // 构建 LLM 配置
    const llmScope = ["clauseExtract", "semanticMatch", "deviation", "evaluation"];
    const augmenter = new LLMAugmenter({
      enabled: true,
      provider: provider as "openai" | "qianfan" | "glm" | "qianwen" | "local",
      apiKey: apiKey || "",
      scope: llmScope,
    });

    // 调用 LLM 生成审查项
    const llmItems = await augmenter.generateReviewItems(
      task.procurement.text,
      task.projectRequirements?.text
    );

    // 如果 LLM 生成失败，回退到规则引擎提取
    const projectItems = llmItems.length > 0
      ? llmItems
      : extractProjectRules(task.procurement.text, task.projectRequirements?.text);

    // 更新会话：替换项目特有审查项，标记 LLM 模式
    if (!task.reviewItems) {
      task.reviewItems = { common: reviewRules, project: [], custom: [] };
    }
    task.reviewItems.project = projectItems;
    task.llmMode = true;
    task.llmConfig = { provider, apiKey: apiKey || "", scope: llmScope };

    res.json({
      success: true,
      reviewItems: task.reviewItems,
      llmMode: true,
      generatedBy: llmItems.length > 0 ? "llm" : "rules",
      message: llmItems.length > 0
        ? `LLM 成功生成 ${llmItems.length} 项审查项，后续审查将统一使用 LLM`
        : "LLM 生成失败，已回退到规则引擎提取",
    });
  } catch (err) {
    console.error("[regenerate] error:", err);
    const msg = err instanceof Error ? err.message : "重新生成失败";
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /api/review-items/:sessionId/llm-mode - 获取当前 LLM 模式状态
 */
router.get("/review-items/:sessionId/llm-mode", (req: Request, res: Response) => {
  const task = getTask(req.params.sessionId);
  if (!task) {
    return res.status(404).json({ success: false, error: "会话不存在或已过期" });
  }
  res.json({
    success: true,
    llmMode: task.llmMode || false,
    llmConfig: task.llmConfig || null,
  });
});

export default router;

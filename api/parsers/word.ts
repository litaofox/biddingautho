// 文档解析模块（Word + PDF）
import mammoth from "mammoth";
import type { Section, UploadedFile } from "../types.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ocrImage, formatOcrText } from "./ocr.js";

/**
 * HTML 实体解码表
 */
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&#34;": '"',
  "&ldquo;": '"', "&rdquo;": '"', "&lsquo;": "'", "&rsquo;": "'",
  "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&[a-zA-Z#0-9]+;/g, (m) => HTML_ENTITIES[m] || m);
}

/**
 * 将单个表格的 HTML 内部内容转换为结构化纯文本
 * 每行格式：| 单元格1 | 单元格2 | ...
 * 单元格内的换行（<br> / 换行符）替换为 " / "，避免列错位
 */
function tableToStructuredText(tableInner: string): string {
  const rows: string[] = [];
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tableInner)) !== null) {
    const rowInner = trMatch[1];
    const cells: string[] = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
      let cellText = cellMatch[1];
      // 单元格内换行统一替换为 " / "，保留同一单元格的多行内容
      cellText = cellText.replace(/<br\s*\/?>/gi, " / ");
      cellText = cellText.replace(/\r?\n/g, " / ");
      // 去掉单元格内其他 HTML 标签
      cellText = cellText.replace(/<[^>]+>/g, "");
      cellText = decodeHtmlEntities(cellText);
      // 合并连续的分隔符和多余空白
      cellText = cellText.replace(/(?:\s*\/\s*)+/g, " / ");
      cellText = cellText.replace(/[ \t]+/g, " ").trim();
      cells.push(cellText);
    }
    if (cells.length > 0) {
      rows.push("| " + cells.join(" | ") + " |");
    }
  }
  return rows.join("\n");
}

/**
 * 将 mammoth 输出的 HTML 转换为结构化纯文本
 * 核心改进：
 * 1. 表格保留行列结构（| 列 | 列 |），单元格内换行用 " / " 替代
 * 2. 图片的 OCR 文字（存于 alt 属性）提取为 [图片内容：...]，插入文本流
 * 3. 非表格部分去除 HTML 标签，保留段落换行
 */
function htmlToStructuredText(html: string): string {
  // 1. 提取所有 <table>，转换为结构化文本并占位
  let processed = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableInner) => {
    const tableText = tableToStructuredText(tableInner);
    return `\n【表格】\n${tableText}\n【表格结束】\n`;
  });

  // 2. 提取 <img alt="OCR文字">，把 OCR 结果插入文本流
  processed = processed.replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, (_match, alt) => {
    const text = decodeHtmlEntities(String(alt || "")).trim();
    return text ? `\n${formatOcrText(text)}\n` : "";
  });
  // 没有 alt 的 img 直接移除
  processed = processed.replace(/<img\b[^>]*>/gi, "");

  // 3. 非表格部分：块级标签转换行，再去掉所有标签
  processed = processed.replace(/<br\s*\/?>/gi, "\n");
  processed = processed.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  processed = processed.replace(/<[^>]+>/g, "");

  // 4. 解码实体 + 清理空白
  processed = decodeHtmlEntities(processed);
  processed = processed.replace(/[ \t]+\n/g, "\n");
  processed = processed.replace(/\n{3,}/g, "\n\n");

  return processed.trim();
}

/**
 * 判断是否为 .doc 文件（非 .docx）
 */
function isDocFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".doc") && !fileName.toLowerCase().endsWith(".docx");
}

/**
 * 判断是否为 .pdf 文件
 */
function isPdfFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf");
}

/**
 * 解析 PDF 文件，提取纯文本 + 图片 OCR 文字
 * 1. pdf-parse 提取文本层（含简易表格结构还原）
 * 2. pdfjs-dist 提取嵌入图片，用 OCR 识别截图内容（如信用查询截图）
 *    将 OCR 文字以 [图片内容：...] 形式拼接到文本流
 */
async function parsePdf(buffer: Buffer, fileName: string): Promise<{ text: string }> {
  const createRequire = (await import("module")).createRequire;
  const require = createRequire(import.meta.url);
  const pdfParse = require("pdf-parse/lib/pdf-parse.js");
  const data = await pdfParse(buffer, { max: 0 });
  let text = (data && data.text) || "";
  text = normalizePdfTables(text);

  // 提取 PDF 中的嵌入图片并 OCR
  try {
    const imageTexts = await extractPdfImagesAndOcr(buffer);
    if (imageTexts.length > 0) {
      text += "\n\n【PDF 图片内容】\n" + imageTexts.map(formatOcrText).join("\n");
    }
  } catch (err) {
    console.warn("[PDF] 图片提取/OCR 失败，跳过:", err instanceof Error ? err.message : err);
  }

  return { text };
}

/**
 * 用 pdfjs-dist 提取 PDF 中所有嵌入图片，逐张 OCR，返回识别文字数组
 */
async function extractPdfImagesAndOcr(pdfBuffer: Buffer): Promise<string[]> {
  // Node.js 环境需使用 pdfjs-dist 的 legacy 构建
  const pdfjs: typeof import("pdfjs-dist") = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const texts: string[] = [];
  const seen = new Set<string>();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const operatorList = await page.getOperatorList();
    const fnArray = operatorList.fnArray;
    const argsArray = operatorList.argsArray;

    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      // 图片绘制操作：paintImageXObject / paintJpegXObject / paintInlineImageXObject
      if (
        fn === pdfjs.OPS.paintImageXObject ||
        fn === pdfjs.OPS.paintJpegXObject ||
        fn === pdfjs.OPS.paintInlineImageXObject
      ) {
        const objName = argsArray[i][0];
        try {
          const img = (page.objs as any).get(objName);
          if (!img || !img.data || !img.width || !img.height) continue;
          // 去重：相同尺寸+数据长度的图片只识别一次
          const key = `${img.width}x${img.height}-${img.data.length}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // 构造 ImageData 兼容对象传给 tesseract
          const imageData = {
            data: new Uint8ClampedArray(img.data),
            width: img.width,
            height: img.height,
          };
          const ocrText = await ocrImage(imageData as any);
          if (ocrText) texts.push(ocrText);
        } catch {
          // 单个图片提取失败不影响其他
        }
      }
    }
  }
  await pdf.destroy();
  return texts;
}

/**
 * 简易 PDF 表格还原：
 * 将一行中 2 个及以上制表符 / 3 个及以上连续空格视为列分隔符，
 * 统一替换为 " | "，帮助 LLM 识别列结构。
 */
function normalizePdfTables(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      // 制表符分隔 → " | "
      if (line.includes("\t")) {
        const parts = line.split("\t").map((s) => s.trim()).filter((s) => s.length > 0);
        if (parts.length >= 2) return "| " + parts.join(" | ") + " |";
      }
      // 3 个及以上连续空格分隔 → " | "
      const multiSpace = / {3,}/;
      if (multiSpace.test(line)) {
        const parts = line.split(multiSpace).map((s) => s.trim()).filter((s) => s.length > 0);
        if (parts.length >= 2) return "| " + parts.join(" | ") + " |";
      }
      return line;
    })
    .join("\n");
}

/**
 * 通过 Microsoft Word COM 将 .doc 转换为 .docx
 * 仅在 Windows 且已安装 Word 时可用
 */
async function convertDocToDocx(docBuffer: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const tmpDir = tmpdir();
  const inputPath = join(tmpDir, `bidding_${id}.doc`);
  const outputPath = join(tmpDir, `bidding_${id}.docx`);

  // 写入临时 .doc 文件
  await fs.writeFile(inputPath, docBuffer);

  // 构造 PowerShell 脚本：使用 Word COM 转换
  // wdFormatXMLDocument = 12 (docx 格式)
  // 注意：用分号分隔语句，确保单行执行时不会解析错误
  const inputEsc = inputPath.replace(/'/g, "''");
  const outputEsc = outputPath.replace(/'/g, "''");
  const psScript = `$ErrorActionPreference = 'Stop'; $word = New-Object -ComObject Word.Application; $word.Visible = $false; $word.DisplayAlerts = 0; try { $doc = $word.Documents.Open('${inputEsc}', $false, $true); $doc.SaveAs([ref]'${outputEsc}', [ref]12); $doc.Close($false) } finally { $word.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null }`;

  try {
    await new Promise<void>((resolve, reject) => {
      exec(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"')}"`,
        { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`Word 转换失败: ${stderr || err.message}`));
          } else {
            resolve();
          }
        }
      );
    });

    const docxBuf = await fs.readFile(outputPath);
    return docxBuf;
  } finally {
    // 清理临时文件
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
}

/**
 * 解析文档文件（.pdf / .doc / .docx），提取纯文本并按章节结构化
 * - .pdf：直接由 pdf-parse 提取文本层
 * - .doc：通过 Microsoft Word COM 转换为 .docx 后再解析
 * - .docx：mammoth 直接提取
 */
export async function parseDocx(buffer: Buffer, fileName: string): Promise<UploadedFile> {
  let parseBuffer = buffer;
  let displayName = fileName;
  let rawText = "";

  // PDF 分支
  if (isPdfFile(fileName)) {
    const pdfResult = await parsePdf(buffer, fileName);
    rawText = pdfResult.text;
  } else {
    // .doc 文件先转换为 .docx
    if (isDocFile(fileName)) {
      parseBuffer = await convertDocToDocx(buffer);
      // 将显示名改为 .docx 扩展名，避免后续逻辑误判
      displayName = fileName.replace(/\.doc$/i, ".docx");
    }

    // 使用 mammoth 转换为 HTML，再由 htmlToStructuredText 保留表格结构
    // convertImage 拦截文档中的图片，用 OCR 识别文字并写入 alt 属性，
    // htmlToStructuredText 会把 alt 提取为 [图片内容：...] 插入文本流
    const result = await mammoth.convertToHtml(
      { buffer: parseBuffer },
      {
        convertImage: mammoth.images.imgElement((image) => {
          return image.read().then(async (imageBuffer: Buffer) => {
            const ocrText = await ocrImage(imageBuffer);
            // alt 存 OCR 文字，src 用占位（后续会被剥离）
            return { src: "image-placeholder", alt: ocrText };
          });
        }),
      }
    );
    rawText = htmlToStructuredText(result.value);
  }

  // 按章节结构化
  const sections = structureByHeadings(rawText);

  // 文件大小格式化（使用原始文件大小）
  const size = formatFileSize(buffer.length);

  return {
    name: displayName,
    size,
    text: rawText,
    sections,
  };
}

/**
 * 将纯文本按标题行切分为章节
 * 简单策略：识别以"第X章/第X条/一、二、"等开头的行作为标题
 */
function structureByHeadings(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentContent.length) currentContent.push("");
      continue;
    }

    // 判断是否为标题行
    const level = detectHeadingLevel(trimmed);
    if (level > 0) {
      // 保存前一个章节
      if (currentSection) {
        currentSection.content = currentContent.join("\n").trim();
        sections.push(currentSection);
      }
      currentSection = {
        level,
        title: trimmed,
        content: "",
      };
      currentContent = [];
    } else {
      currentContent.push(trimmed);
    }
  }

  // 保存最后一个章节
  if (currentSection) {
    currentSection.content = currentContent.join("\n").trim();
    sections.push(currentSection);
  }

  // 如果没有识别到任何章节，把全文作为一个章节
  if (sections.length === 0) {
    sections.push({ level: 1, title: "全文", content: text.trim() });
  }

  return sections;
}

/**
 * 检测标题级别
 * 第X章/第X条 -> level 1
 * 一、二、三、 -> level 1
 * （一）（二） -> level 2
 * 1. 2. 3. -> level 2
 * 1.1 1.2 -> level 3
 */
function detectHeadingLevel(line: string): number {
  // 第X章/第X条/第X部分
  if (/^第[一二三四五六七八九十百千\d]+[章节条部分款]/.test(line)) return 1;
  // 一、二、三、（中文数字+顿号）
  if (/^[一二三四五六七八九十]+、/.test(line)) return 1;
  // （一）（二）中文括号数字
  if (/^[（(][一二三四五六七八九十]+[）)]/.test(line)) return 2;
  // 1. 2. 3. 阿拉伯数字+点
  if (/^\d+[.、]/.test(line)) return 2;
  // 1.1 1.1.1 多级编号
  if (/^\d+\.\d+/.test(line)) return 3;
  return 0;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function generateId(): string {
  return randomUUID();
}

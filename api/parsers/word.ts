// Word 文件解析模块
import mammoth from "mammoth";
import type { Section, UploadedFile } from "../types.js";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * 判断是否为 .doc 文件（非 .docx）
 */
function isDocFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".doc") && !fileName.toLowerCase().endsWith(".docx");
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
 * 解析 Word 文件（.doc 或 .docx），提取纯文本并按章节结构化
 * .doc 文件会自动通过 Microsoft Word COM 转换为 .docx 后再解析
 */
export async function parseDocx(buffer: Buffer, fileName: string): Promise<UploadedFile> {
  let parseBuffer = buffer;
  let displayName = fileName;

  // .doc 文件先转换为 .docx
  if (isDocFile(fileName)) {
    parseBuffer = await convertDocToDocx(buffer);
    // 将显示名改为 .docx 扩展名，避免后续逻辑误判
    displayName = fileName.replace(/\.doc$/i, ".docx");
  }

  // 使用 mammoth 提取纯文本
  const result = await mammoth.extractRawText({ buffer: parseBuffer });
  const rawText = result.value;

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

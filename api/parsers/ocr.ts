// OCR 图片文字识别模块
// 使用 tesseract.js 识别文档中的截图/图片内容（中文+英文）
// 将识别到的文字拼接到文本流中，让 LLM 能核验截图内容

import { createWorker, type Worker } from "tesseract.js";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, copyFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";

let workerPromise: Promise<Worker> | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 准备本地语言数据：将 node_modules 中的 .traineddata.gz 复制到扁平缓存目录
 * tesseract.js 要求 langPath 下直接存在 ${lang}.traineddata.gz 文件
 */
function prepareLangData(): string {
  const cacheDir = join(tmpdir(), "tesseract-cache");
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

  const langs = ["chi_sim", "eng"];
  for (const lang of langs) {
    const src = join(__dirname, "..", "..", "node_modules", "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`);
    const dst = join(cacheDir, `${lang}.traineddata.gz`);
    if (!existsSync(dst) && existsSync(src)) {
      copyFileSync(src, dst);
    }
  }
  return cacheDir;
}

/**
 * 获取（懒加载）共享的 OCR Worker，加载中文+英文语言包
 *
 * 关键配置：
 * - langPath: 指向本地缓存目录（已复制 .traineddata.gz），避免 CDN 网络问题
 * - cachePath: 显式指定临时目录，避免默认 "." 路径问题
 * - cacheMethod: 'none' 跳过缓存检查，直接从 langPath 读取本地 .gz 文件
 * - gzip: true 读取 .traineddata.gz 格式
 * - errorHandler: 必须设置，否则 worker 报错时会 throw 导致整个 Node 进程崩溃
 */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const langPath = prepareLangData();
      const worker = await createWorker(["chi_sim", "eng"], undefined, {
        langPath,
        cachePath: langPath,
        cacheMethod: "none",
        gzip: true,
        errorHandler: (err) => {
          console.warn("[OCR] worker 内部错误:", err);
        },
      });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      console.error("[OCR] worker 初始化失败:", err);
      throw err;
    });
  }
  return workerPromise;
}

/**
 * 对图片做 OCR，返回识别到的文字
 * @param image 图片二进制（Buffer）或 ImageData 兼容对象（{ data, width, height }）
 * @returns 识别到的纯文本，失败返回空字符串
 */
export async function ocrImage(image: Buffer | ImageData): Promise<string> {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image as any);
    const text = (data.text || "").trim();
    return text;
  } catch (err) {
    console.warn("[OCR] 识别失败:", err instanceof Error ? err.message : err);
    return "";
  }
}

/**
 * 批量识别图片，返回文字数组（与输入顺序对齐）
 */
export async function ocrImages(buffers: Buffer[]): Promise<string[]> {
  if (buffers.length === 0) return [];
  const results: string[] = [];
  for (const buf of buffers) {
    results.push(await ocrImage(buf));
  }
  return results;
}

/**
 * 将 OCR 文字格式化为可插入文本流的标记
 * 例如：[截图内容：查询时间 2026-09-14 网址 xxx 主体 xxx 无不良记录]
 */
export function formatOcrText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return `[图片内容：${clean}]`;
}

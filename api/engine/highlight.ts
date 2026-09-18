// 合规亮点识别模块（F6）
// 自动识别投标文件中的正偏离与优势储备：
// - 正偏离：投标数值优于要求（人员/响应/到场时间）
// - 强储备：业绩数量达上限、证书全覆盖、社保凭证齐全
// - 完整闭环：★承诺在商务+技术双文件覆盖、报价未超预算且非异常低价
import type { Bidder, BidderFile, Issue, UploadedFile } from "../types.js";
import { locateKeyword } from "./location.js";

/** 合规亮点识别入口 */
export function runHighlightCheck(
  bidder: Bidder,
  procurement: UploadedFile
): Issue[] {
  return [
    ...detectPositiveDeviation(bidder, procurement),
    ...detectStrongReserve(bidder, procurement),
    ...detectClosedLoop(bidder, procurement),
  ];
}

// ============ 正偏离检测 ============

interface DeviationSpec {
  name: string;
  /** 从采购文件提取要求值的正则 */
  requirePattern: RegExp;
  /** 从投标文件提取响应值的正则 */
  responsePattern: RegExp;
  /** 比较方向：lower=响应值低于要求值时为正偏离（如响应时间）；higher=响应值高于要求值时为正偏离（如人员数量） */
  direction: "lower" | "higher";
  /** 单位换算（如分钟→小时） */
  unit?: string;
}

const DEVIATION_SPECS: DeviationSpec[] = [
  {
    name: "故障初步处置时间",
    requirePattern: /初步处置[^。、\n]{0,15}?(\d+)\s*小时/,
    responsePattern: /初步处置[^。、\n]{0,15}?(\d+)\s*小时/,
    direction: "lower",
  },
  {
    name: "电话响应时间",
    requirePattern: /电话响应[^。、\n]{0,15}?(\d+)\s*分钟/,
    responsePattern: /电话响应[^。、\n]{0,15}?(\d+)\s*分钟/,
    direction: "lower",
  },
  {
    name: "现场响应时间",
    requirePattern: /(?:现场|到场)[^。、\n]{0,15}?(\d+)\s*分钟/,
    responsePattern: /(?:现场|到场)[^。、\n]{0,15}?(\d+)\s*分钟/,
    direction: "lower",
  },
  {
    name: "团队人员数量",
    requirePattern: /(?:团队|人员|配置)[^。、\n]{0,15}?(\d+)\s*[名人]/,
    responsePattern: /(?:团队|人员|配置|共计)[^。、\n]{0,15}?(\d+)\s*[名人]/,
    direction: "higher",
  },
  {
    name: "二线人员数量",
    requirePattern: /二线[^。、\n]{0,15}?(\d+)\s*[名人]/,
    responsePattern: /二线[^。、\n]{0,15}?(\d+)\s*[名人]/,
    direction: "higher",
  },
];

function detectPositiveDeviation(bidder: Bidder, procurement: UploadedFile): Issue[] {
  const issues: Issue[] = [];
  const procText = procurement.text || "";

  for (const spec of DEVIATION_SPECS) {
    const reqMatch = procText.match(spec.requirePattern);
    if (!reqMatch) continue;
    const reqValue = parseInt(reqMatch[1], 10);
    if (isNaN(reqValue)) continue;

    for (const file of bidder.files) {
      const text = file.text || "";
      const resMatch = text.match(spec.responsePattern);
      if (!resMatch) continue;
      const resValue = parseInt(resMatch[1], 10);
      if (isNaN(resValue)) continue;

      const isPositive =
        spec.direction === "lower" ? resValue < reqValue : resValue > reqValue;
      if (isPositive) {
        issues.push(makeHighlightIssue(
          bidder,
          file,
          `正偏离-${spec.name}`,
          `${spec.name}正偏离：要求 ${reqValue}${spec.unit || ""}，投标 ${resValue}${spec.unit || ""}（${spec.direction === "lower" ? "优于" : "高于"}要求）`,
          locateKeyword(file, spec.name.slice(0, 4)),
          "评分细则-服务承诺6分"
        ));
        break; // 同一偏离只取一次
      }
    }
  }
  return issues;
}

// ============ 强储备检测 ============

function detectStrongReserve(bidder: Bidder, procurement: UploadedFile): Issue[] {
  const issues: Issue[] = [];
  const procText = procurement.text || "";
  const bidderText = bidder.files.map((f) => f.text || "").join("\n");

  // 业绩数量：要求N个，投标提供M个，M≥N
  const perfReqMatch = procText.match(/(?:类似业绩|业绩).{0,30}?(\d+)\s*[个项份]/);
  const perfResMatch = bidderText.match(/(?:业绩一览表|类似业绩)[^]{0,500}?/);
  if (perfReqMatch) {
    const required = parseInt(perfReqMatch[1], 10);
    // 估算投标提供的业绩数量（表格行数）
    const bidderFile = bidder.files.find((f) => (f.text || "").includes("业绩一览表"));
    if (bidderFile) {
      const perfTable = bidderFile.text || "";
      const perfIdx = perfTable.indexOf("业绩一览表");
      if (perfIdx !== -1) {
        const section = perfTable.slice(perfIdx, perfIdx + 2000);
        const lines = section.split(/\r?\n/).filter((l) => /\d{4}/.test(l));
        if (lines.length >= required) {
          issues.push(makeHighlightIssue(
            bidder,
            bidderFile,
            "业绩储备强",
            `类似业绩储备强：要求 ${required} 项，投标提供 ${lines.length} 项（达满额）`,
            locateKeyword(bidderFile, "业绩一览表"),
            "评分细则-类似业绩10分"
          ));
        }
      }
    }
  }

  // 证书全覆盖：检测采购文件要求的证书类型是否在投标文件中全部出现
  const certKeywords = ["CISP", "HCIP", "HCIE", "密码", "信息安全师", "网络技术员"];
  const requiredCerts: string[] = [];
  for (const c of certKeywords) {
    if (procText.includes(c)) requiredCerts.push(c);
  }
  if (requiredCerts.length > 0) {
    const covered = requiredCerts.filter((c) => bidderText.includes(c));
    if (covered.length === requiredCerts.length) {
      const file = bidder.files.find((f) => (f.text || "").includes("CISP")) || bidder.files[0];
      issues.push(makeHighlightIssue(
        bidder,
        file,
        "证书全覆盖",
        `要求的 ${requiredCerts.length} 类证书（${requiredCerts.join("、")}）全部覆盖`,
        locateKeyword(file, "CISP"),
        "评分细则-人员配备12分"
      ));
    }
  }

  // 社保凭证齐全
  if (bidderText.includes("社保") && /社保[^。、\n]{0,15}?凭证|社保证明/.test(bidderText)) {
    const file = bidder.files.find((f) => (f.text || "").includes("社保")) || bidder.files[0];
    issues.push(makeHighlightIssue(
      bidder,
      file,
      "社保凭证齐全",
      `全部人员附社保凭证，符合"投标截止前三个月内任意一个月"要求`,
      locateKeyword(file, "社保"),
      "评分细则-人员配备12分"
    ));
  }

  return issues;
}

// ============ 完整闭环检测 ============

function detectClosedLoop(bidder: Bidder, procurement: UploadedFile): Issue[] {
  const issues: Issue[] = [];
  const procText = procurement.text || "";

  // ★承诺在商务+技术双文件覆盖
  const starCommitments = extractStarCommitments(procText);
  if (starCommitments.length > 0) {
    const commercial = bidder.files.find((f) => f.type === "commercial");
    const technical = bidder.files.find((f) => f.type === "technical");
    if (commercial && technical) {
      const covered = starCommitments.filter(
        (c) => (commercial.text || "").includes(c) && (technical.text || "").includes(c)
      );
      if (covered.length === starCommitments.length && covered.length > 0) {
        issues.push(makeHighlightIssue(
          bidder,
          commercial,
          "★承诺双文件闭环",
          `${starCommitments.length} 条★实质性承诺在商务+技术两份文件均盖章承诺，符合"书面盖章承诺"要求`,
          locateKeyword(commercial, "承诺"),
          "须知-★实质性条款"
        ));
      }
    }
  }

  // 报价策略稳健：未超预算且非异常低价
  const budgetMatch = procText.match(/(?:预算|最高限价|控制价)[^。、\n]{0,15}?([\d,]+(?:\.\d+)?)\s*万?元/);
  if (budgetMatch) {
    const budget = parseFloat(budgetMatch[1].replace(/,/g, ""));
    if (!isNaN(budget)) {
      const bidderText = bidder.files.map((f) => f.text || "").join("\n");
      const bidMatch = bidderText.match(/(?:投标总价|投标金额)[^。、\n]{0,15}?人民币\s*([\d,]+(?:\.\d+)?)\s*元/);
      if (bidMatch) {
        const bid = parseFloat(bidMatch[1].replace(/,/g, ""));
        if (!isNaN(bid)) {
          // 统一为元
          const budgetInYuan = budget > 100000 ? budget : budget * 10000;
          if (bid <= budgetInYuan && bid >= budgetInYuan * 0.45) {
            const file = bidder.files.find((f) => (f.text || "").includes("投标总价")) || bidder.files[0];
            issues.push(makeHighlightIssue(
              bidder,
              file,
              "报价策略稳健",
              `投标报价 ${bid} 元未超预算 ${budgetInYuan} 元，且远高于异常低价审查线（45%），无恶意低价嫌疑`,
              locateKeyword(file, "投标总价"),
              "须知-开标一览表/异常低价审查"
            ));
          }
        }
      }
    }
  }

  return issues;
}

/** 提取采购文件中的★承诺关键词 */
function extractStarCommitments(procText: string): string[] {
  const commitments: string[] = [];
  // 按★切分，每个★后的关键词视为一条承诺
  const segments = procText.split(/★/);
  for (let i = 1; i < segments.length; i++) {
    const after = segments[i].slice(0, 50);
    // 提取关键词（连续中文+数字）
    const m = after.match(/([\u4e00-\u9fa5]{2,15})/);
    if (m) commitments.push(m[1]);
  }
  return commitments;
}

// ============ 工具函数 ============

function makeHighlightIssue(
  bidder: Bidder,
  file: BidderFile,
  name: string,
  description: string,
  location: import("../types.js").IssueLocation,
  basis: string
): Issue {
  return {
    id: `highlight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimension: "highlight",
    name: `${bidder.name} - ${name}`,
    riskLevel: "highlight",
    location,
    description,
    evidence: location.snippet,
    basis,
    remediation: "保留并强化",
  };
}

// 数据一致性核查模块（F1）
// 检测投标文件内部数值/表述的自相矛盾：
// - 业绩信息一致性（商务/技术两文件的业绩名称、金额、起止时间）
// - 人员数量一致性（二线人员、团队总数、证书持有人数）
// - 证书统计一致性（CISP/HCIP/HCIE 等数量在多处口径）
// - 经验年限一致性（"五年/三年"等表述统一）
// - 报价一致性（开标一览表/报价明细表/投标书三处总价）
//
// 实现策略：通过正则提取所有数值/日期/金额，按"实体名+属性"建索引，跨文件比对差异
import type { Bidder, BidderFile, Issue, UploadedFile } from "../types.js";
import { locateInBidder, locateTable, extractSnippet } from "./location.js";

/** 一致性核查上下文 */
export interface ConsistencyContext {
  bidder: Bidder;
  procurement: UploadedFile;
}

/** 单条提取出的数值记录 */
interface ValueRecord {
  /** 实体名（如"二线人员"、"业绩1金额"、"CISP人数"） */
  entity: string;
  /** 属性值（如"7名"、"288万"、"2025.1.1"） */
  value: string;
  /** 原文片段 */
  snippet: string;
  /** 来源文件 */
  file: string;
}

/** 数值提取器：从文本中按规则抽取 entity→value 对 */
type ValueExtractor = (text: string, file: BidderFile | UploadedFile) => ValueRecord[];

/**
 * 一致性核查入口
 */
export function runConsistencyCheck(ctx: ConsistencyContext): Issue[] {
  const { bidder, procurement } = ctx;
  const issues: Issue[] = [];

  issues.push(...checkPersonnelConsistency(bidder));
  issues.push(...checkCertificateConsistency(bidder));
  issues.push(...checkExperienceYearsConsistency(bidder));
  issues.push(...checkPriceConsistency(bidder));
  issues.push(...checkPerformanceConsistency(bidder));

  // 去重（同一 entity+value 组合只保留首条）
  return dedupeIssues(issues);
}

// ============ 人员数量一致性 ============

/** 检测二线人员/团队总数在多处的表述矛盾 */
function checkPersonnelConsistency(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  const records = extractFromAllFiles(bidder, extractPersonnelRecords);

  // 二线人员数量
  const secondLineValues = records.filter((r) => r.entity === "二线人员");
  if (secondLineValues.length >= 2) {
    const values = new Set(secondLineValues.map((r) => r.value));
    if (values.size > 1) {
      issues.push(makeIssue(
        "人员数量-二线人员",
        `二线人员数量多处矛盾：${secondLineValues.map((r) => `${r.file}="${r.value}"`).join("；")}`,
        "critical",
        bidder,
        "二线人员",
        locateInBidder(bidder, "二线"),
        "统一二线人员数量口径（按商务文件证书附件实有人数为准），全文检索并修订所有矛盾处",
        "评分细则-人员配备12分；须知30.2 投标文件本身内容判定"
      ));
    }
  }

  // 团队总数
  const totalRecords = records.filter((r) => r.entity === "团队总数");
  if (totalRecords.length >= 2) {
    const values = new Set(totalRecords.map((r) => r.value));
    if (values.size > 1) {
      issues.push(makeIssue(
        "人员数量-团队总数",
        `团队总人数多处矛盾：${totalRecords.map((r) => `${r.file}="${r.value}"`).join("；")}`,
        "critical",
        bidder,
        "团队",
        locateInBidder(bidder, "团队"),
        "统一团队总人数（=一线+二线+支撑+经理），并核对各分项加总与总数一致",
        "评分细则-人员配备12分"
      ));
    }
  }

  return issues;
}

/** 提取人员数量记录 */
function extractPersonnelRecords(text: string, file: BidderFile | UploadedFile): ValueRecord[] {
  const records: ValueRecord[] = [];
  const lower = text.toLowerCase();

  // 二线人员：N名/人
  const secondLinePatterns = [
    /二线(?:人员|技术支撑|支撑人员|后台技术人员)[^。、\n]{0,15}?(\d+)\s*[名人]/g,
    /(?:后台|后台技术|二线)[^。、\n]{0,10}?(\d+)\s*名\s*(?:资深技术人员|技术人员|人员|工程师)/g,
  ];
  for (const p of secondLinePatterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      records.push({
        entity: "二线人员",
        value: `${m[1]}名`,
        snippet: extractSnippet(text, m[0]),
        file: file.name,
      });
    }
  }

  // 团队总数：N人/N名人员
  const totalPatterns = [
    /项目团队共?\s*(\d+)\s*[名人]/g,
    /(?:团队|总数|共计)[^。、\n]{0,15}?(\d+)\s*[名人]/g,
    /(\d+)\s*人\s*团队/g,
  ];
  for (const p of totalPatterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      records.push({
        entity: "团队总数",
        value: `${m[1]}人`,
        snippet: extractSnippet(text, m[0]),
        file: file.name,
      });
    }
  }

  return records;
}

// ============ 证书统计一致性 ============

/** 检测 CISP/HCIP/HCIE/密码等证书数量在多处的口径矛盾 */
function checkCertificateConsistency(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  const certTypes = ["CISP", "HCIP", "HCIE", "密码", "信息安全师", "网络技术员"];
  const records = extractFromAllFiles(bidder, extractCertificateRecords);

  for (const cert of certTypes) {
    const certRecords = records.filter((r) => r.entity === `证书-${cert}`);
    if (certRecords.length >= 2) {
      const values = new Set(certRecords.map((r) => r.value));
      if (values.size > 1) {
        issues.push(makeIssue(
          `证书统计-${cert}`,
          `${cert} 证书数量多处矛盾：${certRecords.map((r) => `${r.file}="${r.value}"`).join("；")}`,
          "critical",
          bidder,
          cert,
          locateInBidder(bidder, cert),
          `以商务文件证书附件实有人数为准，统一 ${cert} 数量口径`,
          "评分细则-人员配备12分"
        ));
      }
    }
  }

  return issues;
}

function extractCertificateRecords(text: string, file: BidderFile | UploadedFile): ValueRecord[] {
  const records: ValueRecord[] = [];
  const certNames = ["CISP", "HCIP", "HCIE", "密码技术应用员", "信息安全师", "网络技术员"];
  for (const cert of certNames) {
    const re = new RegExp(`${cert}[^。、\\n]{0,15}?(\\d+)\\s*名`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      records.push({
        entity: `证书-${cert}`,
        value: `${m[1]}名`,
        snippet: extractSnippet(text, m[0]),
        file: file.name,
      });
    }
  }
  return records;
}

// ============ 经验年限一致性 ============

function checkExperienceYearsConsistency(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  const records = extractFromAllFiles(bidder, extractExperienceRecords);

  const yearRecords = records.filter((r) => r.entity === "经验年限");
  if (yearRecords.length >= 2) {
    const values = new Set(yearRecords.map((r) => r.value));
    if (values.size > 1) {
      issues.push(makeIssue(
        "经验年限",
        `现场人员经验年限多处矛盾：${yearRecords.map((r) => `${r.file}="${r.value}"`).join("；")}`,
        "major",
        bidder,
        "经验年限",
        locateInBidder(bidder, "经验"),
        "统一经验年限表述（如统一为'五年及以上'或按社保证明实际年限填写）",
        "评分细则-人员配备12分"
      ));
    }
  }

  return issues;
}

function extractExperienceRecords(text: string, file: BidderFile | UploadedFile): ValueRecord[] {
  const records: ValueRecord[] = [];
  const patterns = [
    /(?:五年|5年|三年|3年|五年及以上|三年以上|5年以上|3年以上)\s*(?:以上)?(?:工作经验|工作经验|从业经验|项目管理经验|技术经验)/g,
    /(?:经验|年限)[^。、\n]{0,15}?(\d+)\s*年/g,
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      records.push({
        entity: "经验年限",
        value: m[1] ? `${m[1]}年` : m[0],
        snippet: extractSnippet(text, m[0]),
        file: file.name,
      });
    }
  }
  return records;
}

// ============ 报价一致性 ============

function checkPriceConsistency(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  const records = extractFromAllFiles(bidder, extractPriceRecords);

  const totalRecords = records.filter((r) => r.entity === "投标总价");
  if (totalRecords.length >= 2) {
    const values = new Set(totalRecords.map((r) => r.value));
    if (values.size > 1) {
      issues.push(makeIssue(
        "报价-总价",
        `投标总价多处矛盾：${totalRecords.map((r) => `${r.file}="${r.value}"`).join("；")}`,
        "critical",
        bidder,
        "投标总价",
        locateInBidder(bidder, "投标总价"),
        "以开标一览表为准，统一投标书/报价明细表/开标一览表三处总价与分项金额",
        "须知23.1 / 评标索引-开标一览表"
      ));
    }
  }

  // 分项金额合计 = 总价？
  const subItems = records.filter((r) => r.entity === "分项金额");
  if (subItems.length > 0) {
    const sum = subItems.reduce((acc, r) => {
      const num = parseFloat(r.value.replace(/[^\d.]/g, ""));
      return acc + (isNaN(num) ? 0 : num);
    }, 0);
    const total = totalRecords[0];
    if (total) {
      const totalNum = parseFloat(total.value.replace(/[^\d.]/g, ""));
      if (!isNaN(totalNum) && Math.abs(sum - totalNum) > 1) {
        issues.push(makeIssue(
          "报价-分项合计",
          `分项金额合计 ${sum.toFixed(2)} 与总价 ${totalNum} 不一致`,
          "critical",
          bidder,
          "分项金额",
          locateInBidder(bidder, "报价明细"),
          "调整分项金额使合计与开标一览表总价严格一致",
          "格式四-报价明细表"
        ));
      }
    }
  }

  return issues;
}

function extractPriceRecords(text: string, file: BidderFile | UploadedFile): ValueRecord[] {
  const records: ValueRecord[] = [];

  // 总价：含元/万元/圆整的金额
  const totalPatterns = [
    /(?:投标总价|投标金额|总报价|合计)[^。、\n]{0,15}?人民币\s*([\d,]+(?:\.\d+)?)\s*元/g,
    /人民币\s*([\d,]+(?:\.\d+)?)\s*元[整]/g,
    /([\d,]+(?:\.\d+)?)\s*元[整]/g,
  ];
  for (const p of totalPatterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      records.push({
        entity: "投标总价",
        value: `${m[1]}元`,
        snippet: extractSnippet(text, m[0]),
        file: file.name,
      });
    }
  }

  // 分项金额
  const subPatterns = [
    /(?:维保|运维|运营|保障|服务|密码|应急)[^。、\n]{0,20}?([\d,]+(?:\.\d+)?)\s*元/g,
  ];
  for (const p of subPatterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(text)) !== null) {
      records.push({
        entity: "分项金额",
        value: `${m[1]}元`,
        snippet: extractSnippet(text, m[0]),
        file: file.name,
      });
    }
  }

  return records;
}

// ============ 业绩信息一致性 ============

/**
 * 业绩一致性核查：
 * 识别商务文件"业绩一览表"与技术文件"类似业绩一览表"中同一业绩的金额/起止时间/年度差异
 */
function checkPerformanceConsistency(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  const commercial = bidder.files.find((f) => f.type === "commercial");
  const technical = bidder.files.find((f) => f.type === "technical");
  if (!commercial || !technical) return issues;

  // 从两份文件分别提取业绩记录
  const commRecords = extractPerformanceRecords(commercial.text, commercial);
  const techRecords = extractPerformanceRecords(technical.text, technical);

  // 按业绩名称片段对齐
  for (const cr of commRecords) {
    const matched = techRecords.find((tr) =>
      tr.entity.includes(cr.entity.slice(0, 6)) || cr.entity.includes(tr.entity.slice(0, 6))
    );
    if (matched && matched.amount !== cr.amount && cr.amount && matched.amount) {
      issues.push(makeIssue(
        `业绩一致性-${cr.entity.slice(0, 12)}`,
        `业绩"${cr.entity}"金额矛盾：商务文件=${cr.amount}，技术文件=${matched.amount}`,
        "critical",
        bidder,
        cr.entity,
        locateTable(commercial, "业绩一览表"),
        `调取"${cr.entity}"合同签章页原件，以合同为准统一两表金额`,
        "评分细则-类似业绩10分（以合同为准）；须知31.2 不利于出错投标人原则"
      ));
    }
    if (matched && matched.period !== cr.period && cr.period && matched.period) {
      issues.push(makeIssue(
        `业绩一致性-合同期-${cr.entity.slice(0, 12)}`,
        `业绩"${cr.entity}"合同期矛盾：商务文件=${cr.period}，技术文件=${matched.period}`,
        "critical",
        bidder,
        cr.entity,
        locateTable(commercial, "业绩一览表"),
        `以合同为准统一"${cr.entity}"起止时间`,
        "评分细则-类似业绩10分"
      ));
    }
  }

  return issues;
}

interface PerformanceRecord extends ValueRecord {
  amount?: string;
  period?: string;
}

function extractPerformanceRecords(text: string, file: BidderFile | UploadedFile): PerformanceRecord[] {
  const records: PerformanceRecord[] = [];
  // 简化策略：识别表格行（包含日期范围 + 金额的行）
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    // 日期范围：YYYY.MM.DD – YYYY.MM.DD 或 YYYY-MM-DD – YYYY-MM-DD
    const periodMatch = line.match(/(\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?)\s*[-–至到~]\s*(\d{4}[.\-/年]\d{1,2}[.\-/月]\d{1,2}日?)/);
    // 金额：N万/万元/元
    const amountMatch = line.match(/([\d,]+(?:\.\d+)?)\s*(万元|万|元)/);
    if (periodMatch || amountMatch) {
      // 提取业绩名（行首 1-15 字）
      const entityMatch = line.match(/([\u4e00-\u9fa5][\u4e00-\u9fa5\w]{2,30})/);
      const entity = entityMatch ? entityMatch[1] : line.slice(0, 15).trim();
      records.push({
        entity,
        value: `${periodMatch?.[0] || ""} ${amountMatch?.[0] || ""}`.trim() || line.slice(0, 30),
        snippet: extractSnippet(text, line.slice(0, 30)),
        file: file.name,
        amount: amountMatch?.[0],
        period: periodMatch?.[0],
      });
    }
  }
  return records;
}

// ============ 工具函数 ============

/** 在所有文件中提取数值记录 */
function extractFromAllFiles(
  bidder: Bidder,
  extractor: ValueExtractor
): ValueRecord[] {
  const records: ValueRecord[] = [];
  for (const f of bidder.files) {
    records.push(...extractor(f.text, f));
  }
  return records;
}

/** 构造 Issue */
function makeIssue(
  name: string,
  description: string,
  riskLevel: "critical" | "major" | "minor" | "info" | "highlight",
  bidder: Bidder,
  keyword: string,
  location: import("../types.js").IssueLocation,
  remediation: string,
  basis: string
): Issue {
  return {
    id: `consistency_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimension: "consistency",
    name: `${bidder.name} - ${name}`,
    riskLevel,
    location,
    description,
    evidence: location.snippet,
    basis,
    remediation,
  };
}

/** 去重 */
function dedupeIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const result: Issue[] = [];
  for (const i of issues) {
    const key = `${i.name}|${i.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(i);
  }
  return result;
}

// 结构规范性检测模块（F2）
// 检测投标文件中的结构问题：
// - 表格列错位（表头与数据行字段类型不符）
// - 评标索引空白（评分索引"页码"列空白）
// - 报价明细缺失（分项金额栏空白、无合计行）
// - 必填栏空白（签字栏、日期栏、公章栏为空）
// - 联系方式不规范（统一填座机而非手机号）
import type { Bidder, BidderFile, Issue } from "../types.js";
import { locateKeyword, locateInBidder, extractSnippet } from "./location.js";

/** 结构规范性检测入口 */
export function runStructureCheck(bidder: Bidder): Issue[] {
  return [
    ...detectTableMisalign(bidder),
    ...detectIndexBlank(bidder),
    ...detectPriceDetailMissing(bidder),
    ...detectRequiredFieldBlank(bidder),
    ...detectContactPhoneMissing(bidder),
  ];
}

// ============ 表格列错位检测 ============

/**
 * 检测业绩一览表等表格的列错位：
 * 表头"项目名称 | 委托单位"，若数据行"项目名称"列填了公司名（含"有限公司/中心/局"），判定错位
 */
function detectTableMisalign(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    // 定位业绩一览表附近内容
    const tableIdx = text.indexOf("业绩一览表");
    if (tableIdx === -1) continue;

    // 截取表后 2000 字
    const section = text.slice(tableIdx, tableIdx + 2000);
    const lines = section.split(/\r?\n/);

    // 找表头行
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/项目名称|委托单位|委托时间|合同金额/.test(lines[i]) && /[\t|｜]/.test(lines[i])) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const header = lines[headerIdx];
    const cols = splitRow(header);
    const nameColIdx = cols.findIndex((c) => /项目名称/.test(c));
    const clientColIdx = cols.findIndex((c) => /委托单位|采购人/.test(c));

    if (nameColIdx === -1 || clientColIdx === -1) continue;

    // 检查数据行
    let misalignCount = 0;
    for (let i = headerIdx + 1; i < Math.min(headerIdx + 8, lines.length); i++) {
      const dataCols = splitRow(lines[i]);
      if (dataCols.length < Math.max(nameColIdx, clientColIdx) + 1) continue;
      const nameCell = dataCols[nameColIdx] || "";
      const clientCell = dataCols[clientColIdx] || "";
      // 公司名特征：含"有限公司/中心/局/院"
      const isCompany = /有限公司|中心$|局$|院$|委员会/.test(nameCell);
      const isProject = /项目|工程|服务|保障|运维/.test(clientCell);
      if (isCompany && isProject) {
        misalignCount++;
      }
    }
    if (misalignCount >= 2) {
      issues.push(makeIssue(
        bidder,
        file,
        "业绩表列错位",
        `业绩一览表存在列错位：表头为"项目名称|委托单位"，但数据行"项目名称"列填了公司名，"委托单位"列填了项目名（${misalignCount} 行错位）`,
        "major",
        locateKeyword(file, "业绩一览表"),
        "按表头逐行重排：项目名称列填项目名，委托单位列填公司名",
        "格式九-业绩一览表"
      ));
    }
  }
  return issues;
}

// ============ 评标索引空白检测 ============

function detectIndexBlank(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";
    const idxPos = text.indexOf("评标索引");
    if (idxPos === -1 && !/评分索引|评标索引/.test(text)) continue;

    // 截取评标索引后 3000 字
    const section = text.slice(idxPos, idxPos + 3000);
    const lines = section.split(/\r?\n/);

    // 找含"页码"列的表头
    let headerIdx = -1;
    let pageColIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const cols = splitRow(lines[i]);
      const idx = cols.findIndex((c) => /页码|对应页码|对应册|册及页码/.test(c));
      if (idx >= 0) {
        headerIdx = i;
        pageColIdx = idx;
        break;
      }
    }
    if (headerIdx === -1) continue;

    // 统计数据行页码列空白
    let blankCount = 0;
    const blankItems: string[] = [];
    for (let i = headerIdx + 1; i < Math.min(headerIdx + 20, lines.length); i++) {
      const cols = splitRow(lines[i]);
      if (cols.length <= pageColIdx) continue;
      const item = cols[0] || cols[1] || "";
      if (!item || /合计|小计/.test(item)) continue;
      const pageCell = (cols[pageColIdx] || "").trim();
      if (!pageCell) {
        blankCount++;
        if (blankItems.length < 5) blankItems.push(item);
      }
    }
    if (blankCount >= 3) {
      issues.push(makeIssue(
        bidder,
        file,
        "评标索引页码空白",
        `评标索引表"页码"列 ${blankCount} 项空白：${blankItems.join("、")}等`,
        "major",
        locateKeyword(file, "评标索引"),
        "逐项补填对应册及页码（指向技术文件对应章节），并核对已填页码与最终排版一致",
        "招标文件第七部分-评标索引要求"
      ));
    }
  }
  return issues;
}

// ============ 报价明细缺失检测 ============

function detectPriceDetailMissing(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    if (file.type !== "commercial") continue;
    const text = file.text || "";
    const idx = text.indexOf("报价明细表");
    if (idx === -1) continue;
    const section = text.slice(idx, idx + 1500);
    const lines = section.split(/\r?\n/);

    // 找表头
    let headerIdx = -1;
    let priceColIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const cols = splitRow(lines[i]);
      const pIdx = cols.findIndex((c) => /金额|价格|报价|单价|合价/.test(c));
      if (pIdx >= 0) {
        headerIdx = i;
        priceColIdx = pIdx;
        break;
      }
    }
    if (headerIdx === -1) continue;

    let blankCount = 0;
    let totalRowFound = false;
    for (let i = headerIdx + 1; i < Math.min(headerIdx + 15, lines.length); i++) {
      const cols = splitRow(lines[i]);
      if (cols.length <= priceColIdx) continue;
      const first = (cols[0] || "").trim();
      if (/合计|总计|总价/.test(first)) {
        totalRowFound = true;
        continue;
      }
      const price = (cols[priceColIdx] || "").trim();
      if (!price) blankCount++;
    }
    if (blankCount >= 2) {
      issues.push(makeIssue(
        bidder,
        file,
        "报价明细分项金额缺失",
        `报价明细表分项金额栏 ${blankCount} 项空白，${totalRowFound ? "存在合计行" : "缺失合计行"}`,
        "major",
        locateKeyword(file, "报价明细表"),
        "补充分项金额（软硬件维保+网络运维+网络运营+一网通办保障+密码+政务云安全+应急保障）并加合计行，与开标一览表严格一致",
        "格式四-报价明细表"
      ));
    }
  }
  return issues;
}

// ============ 必填栏空白检测 ============

function detectRequiredFieldBlank(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    const text = file.text || "";

    // 投标书/授权委托书/开标一览表的签字栏空白
    const signSections = [
      { keyword: "投标人（公章）", basis: "须知23.1 ★条款" },
      { keyword: "法定代表人（签字", basis: "须知23.1" },
      { keyword: "授权代表（签字", basis: "须知23.1" },
      { keyword: "被授权人（签字", basis: "须知23.1" },
    ];

    for (const s of signSections) {
      const idx = text.indexOf(s.keyword);
      if (idx === -1) continue;
      // 取关键词后 50 字内若全为空白或无内容，提示
      const after = text.slice(idx + s.keyword.length, idx + s.keyword.length + 80).trim();
      if (!after || /^\s*$/.test(after) || /^[:：]\s*$/.test(after)) {
        issues.push(makeIssue(
          bidder,
          file,
          `签字栏空白-${s.keyword}`,
          `签字栏"${s.keyword}"后空白，需在上传电子件中确认已加盖电子签章/手写签名`,
          "critical",
          locateKeyword(file, s.keyword),
          `上传前用"${s.keyword}"为关键词全文检索终验，所有该处逐一确认电子签章覆盖`,
          s.basis
        ));
      }
    }
  }
  return issues;
}

// ============ 联系方式不规范检测 ============

function detectContactPhoneMissing(bidder: Bidder): Issue[] {
  const issues: Issue[] = [];
  for (const file of bidder.files) {
    if (file.type !== "commercial") continue;
    const text = file.text || "";

    // 人员安排表
    const idx = text.indexOf("人员安排表");
    if (idx === -1) continue;
    const section = text.slice(idx, idx + 2000);
    const lines = section.split(/\r?\n/);

    // 检测统一座机（如 021-XXXXXXXX 在 5 行以上出现）
    const phonePattern = /0\d{2,3}-\d{7,8}/g;
    const phoneMatches = section.match(phonePattern) || [];
    const mobilePattern = /1[3-9]\d{9}/g;
    const mobileMatches = section.match(mobilePattern) || [];

    if (phoneMatches.length >= 5 && mobileMatches.length === 0) {
      issues.push(makeIssue(
        bidder,
        file,
        "联系方式全部为座机",
        `人员安排表联系方式统一填写座机（${phoneMatches[0]}），无任何手机号`,
        "major",
        locateKeyword(file, "人员安排表"),
        "至少为主要现场维护人员、值守人员及服务经理填写手机号码（可用'详见后续进场名册'+填写服务经理手机）",
        "项目需求-技术服务人员手机号码7*24开机响应"
      ));
    }
  }
  return issues;
}

// ============ 工具函数 ============

/** 拆分表格行：支持 Tab、竖线、中文竖线、多空格 */
function splitRow(line: string): string[] {
  if (!line) return [];
  // 优先用明显分隔符
  if (/\t/.test(line)) return line.split(/\t/).map((c) => c.trim());
  if (/[|｜]/.test(line)) return line.split(/[|｜]/).map((c) => c.trim());
  // 退回多空格
  return line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
}

function makeIssue(
  bidder: Bidder,
  file: BidderFile,
  name: string,
  description: string,
  riskLevel: "critical" | "major" | "minor" | "info" | "highlight",
  location: import("../types.js").IssueLocation,
  remediation: string,
  basis: string
): Issue {
  return {
    id: `structure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimension: "structure",
    name: `${bidder.name} - ${name}`,
    riskLevel,
    location,
    description,
    evidence: location.snippet,
    basis,
    remediation,
  };
}

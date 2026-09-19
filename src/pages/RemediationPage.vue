<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  AlertTriangle, CheckCircle2, Info, Sparkles, ListChecks,
  FileCheck, ChevronDown, ChevronUp, Loader2, Download, RotateCcw,
} from "lucide-vue-next";
import type {
  Issue, RiskLevel, CompletenessItem, MultiDimReviewResult,
} from "@/types";
import { runMultiDimReview, getRemediationPlan, exportMultiDimReport } from "@/api";

const props = defineProps<{
  sessionId: string;
  mode: "local" | "llm";
}>();

const emit = defineEmits<{
  (e: "back"): void;
  (e: "restart"): void;
}>();

const loading = ref(false);
const error = ref("");
const result = ref<MultiDimReviewResult | null>(null);
const procurementName = ref("");
const generatedAt = ref<number>(0);
const expandedIssues = ref<Set<string>>(new Set());
const expandedScoreIds = ref<Set<string>>(new Set());

const summary = computed(() => result.value?.summary);
const remediationPlan = computed(() => result.value?.remediationPlan);
const completeness = computed<CompletenessItem[]>(() => result.value?.completeness || []);
const highlights = computed<Issue[]>(() => result.value?.highlights || []);
const scoringIndex = computed(() => result.value?.scoringIndex || []);

// 问题分层：废标项（命中否决条款的 critical）单独分区暗红展示，其余按等级分区
const rejectionIssues = computed<Issue[]>(() =>
  (result.value?.issues || []).filter((i) => i.riskLevel === "critical" && i.rejection));
const criticalIssues = computed<Issue[]>(() =>
  (result.value?.issues || []).filter((i) => i.riskLevel === "critical" && !i.rejection));
const majorIssues = computed<Issue[]>(() =>
  (result.value?.issues || []).filter((i) => i.riskLevel === "major"));
const minorIssues = computed<Issue[]>(() =>
  (result.value?.issues || []).filter((i) => i.riskLevel === "minor" || i.riskLevel === "info"));

// 章节动态编号：一、结论固定为 1，其后按实际出现顺序连续编号，避免缺章跳号
const secNo = computed<Record<string, number>>(() => {
  const plan = remediationPlan.value;
  const presence: [string, boolean][] = [
    ["rejection", rejectionIssues.value.length > 0],
    ["completeness", completeness.value.length > 0],
    ["critical", criticalIssues.value.length > 0],
    ["major", majorIssues.value.length > 0],
    ["minor", minorIssues.value.length > 0],
    ["highlights", highlights.value.length > 0],
    ["remediation", !!plan],
    ["manual", !!plan && plan.manualCheck.length > 0],
    // 模拟打分为可选增值内容，统一置于全部审查内容之后（末章）；无评分项时不渲染（避免出现空的占位章）
    ["scoring", scoringIndex.value.length > 0],
  ];
  const map: Record<string, number> = {};
  let seq = 1; // 一、整体核查结论
  presence.forEach(([k, ok]) => {
    if (ok) map[k] = ++seq;
  });
  return map;
});

const completenessStats = computed(() => ({
  complete: completeness.value.filter((c) => c.status === "complete").length,
  partial: completeness.value.filter((c) => c.status === "partial").length,
  missing: completeness.value.filter((c) => c.status === "missing").length,
}));

const scoreTotal = computed(() => {
  const rows = scoringIndex.value;
  if (rows.length === 0) return null;
  const full = rows.reduce((s, r) => s + r.fullScore, 0);
  const got = rows.filter((r) => r.assessment).reduce((s, r) => s + (r.assessment?.score || 0), 0);
  return { full, got: Math.round(got * 10) / 10, rate: full > 0 ? Math.round((got / full) * 100) : 0 };
});

const riskConfig: Record<RiskLevel, { label: string; class: string; dot: string }> = {
  critical: { label: "准高危", class: "bg-red-100 text-red-700 border-red-300", dot: "bg-red-500" },
  major: { label: "扣分项", class: "bg-orange-100 text-orange-700 border-orange-300", dot: "bg-orange-500" },
  minor: { label: "细节优化", class: "bg-amber-100 text-amber-700 border-amber-300", dot: "bg-amber-500" },
  info: { label: "提示", class: "bg-blue-100 text-blue-700 border-blue-300", dot: "bg-blue-500" },
  highlight: { label: "亮点", class: "bg-green-100 text-green-700 border-green-300", dot: "bg-green-500" },
};

const dimensionLabels: Record<string, string> = {
  qualification: "资格合规",
  substantive: "实质性条款",
  consistency: "数据一致性",
  structure: "结构规范",
  template: "模板残留",
  signature: "签字盖章",
  textFlaw: "文本瑕疵",
  highlight: "合规亮点",
  completeness: "完整性对照",
};

const overallRiskClass = computed(() => {
  const r = summary.value?.overallRisk;
  if (r === "high") return "bg-red-50 border-red-300 text-red-700";
  if (r === "medium") return "bg-amber-50 border-amber-300 text-amber-700";
  return "bg-green-50 border-green-300 text-green-700";
});

async function runMultiDim() {
  loading.value = true;
  error.value = "";
  try {
    const r = await runMultiDimReview(props.sessionId, { mode: "local" });
    result.value = r;
    // 拉取详细信息
    const detail = await getRemediationPlan(props.sessionId);
    procurementName.value = detail.procurement;
    generatedAt.value = detail.generatedAt;
  } catch (e: any) {
    error.value = e.message || "多维审核失败";
  } finally {
    loading.value = false;
  }
}

function toggleIssue(id: string) {
  if (expandedIssues.value.has(id)) {
    expandedIssues.value.delete(id);
  } else {
    expandedIssues.value.add(id);
  }
}

function toggleScore(id: string) {
  if (expandedScoreIds.value.has(id)) {
    expandedScoreIds.value.delete(id);
  } else {
    expandedScoreIds.value.add(id);
  }
}

function completenessStatus(item: CompletenessItem): { label: string; cls: string } {
  if (item.status === "complete") return { label: "✓ 完整", cls: "bg-green-100 text-green-700" };
  if (item.status === "partial") return { label: "△ 部分提供/空泛", cls: "bg-amber-100 text-amber-700" };
  return { label: "✗ 缺失", cls: "bg-red-100 text-red-700" };
}

function scoreRate(score: number | undefined, full: number): number | null {
  if (score === undefined || full <= 0) return null;
  return Math.round((score / full) * 100);
}

function scoreCls(rate: number | null, hasAssessment: boolean): string {
  if (!hasAssessment || rate === null) return "text-slate-400";
  if (rate === 100) return "text-green-600";
  if (rate >= 60) return "text-orange-600";
  return "text-red-600";
}

function formatLocation(issue: Issue): string {
  const loc = issue.location;
  const parts: string[] = [loc.file];
  if (loc.chapter) parts.push(loc.chapter);
  if (loc.page) parts.push(`第${loc.page}页`);
  if (loc.tableId) parts.push(loc.tableId);
  if (loc.tableRow !== undefined) parts.push(`第${loc.tableRow}行`);
  return parts.join("・");
}

async function downloadReport() {
  try {
    const blob = await exportMultiDimReport(props.sessionId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `投标文件全方位审核报告_${props.mode === "llm" ? "LLM" : "本地"}_${date}.html`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    error.value = e.message || "导出失败";
  }
}

// 用接口返回的详情组装页面结果
function applyDetail(detail: Awaited<ReturnType<typeof getRemediationPlan>>) {
  result.value = {
    mode: (detail.mode === "llm" ? "llm" : "local") as "local" | "llm",
    bidders: detail.bidders || [],
    issues: detail.issues || [],
    completeness: detail.completeness || [],
    highlights: detail.highlights || [],
    remediationPlan: detail.remediationPlan,
    summary: detail.summary,
    scoringIndex: detail.scoringIndex,
  };
  procurementName.value = detail.procurement;
  generatedAt.value = detail.generatedAt;
}

// 进入页面：优先加载已有结果（LLM 模式结果必须保留，不得被本地审核覆盖）；
// 仅在尚无多维结果时（本地模式首次进入）才执行本地多维审核
async function load() {
  loading.value = true;
  error.value = "";
  try {
    const detail = await getRemediationPlan(props.sessionId);
    applyDetail(detail);
  } catch {
    await runMultiDim();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<template>
  <div class="space-y-6">
    <!-- 头部 -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold text-slate-800 flex items-center gap-2">
          <ListChecks class="w-6 h-6 text-cyber-magenta" />
          多维审核结果与整改清单
          <span class="text-cyber-gray text-sm font-normal">[步骤 3/3]</span>
          <span v-if="mode === 'llm'"
            class="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-300">LLM 智能审核</span>
          <span v-else
            class="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-300">本地检查</span>
        </h2>
        <p class="text-sm text-slate-500 mt-1">
          覆盖：资格合规 / 采购要求逐条响应比对 / 数据一致性 / 结构规范 / 模板残留 / 签字盖章 / 文本瑕疵 / 完整性对照 / 评分标准逐项打分
        </p>
      </div>
      <button
        v-if="mode === 'local'"
        @click="runMultiDim"
        :disabled="loading"
        class="px-4 py-2 rounded-lg bg-cyber-magenta text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
      >
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        {{ loading ? "审核中..." : "重新审核" }}
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex flex-col items-center py-16">
      <Loader2 class="w-10 h-10 text-cyber-magenta animate-spin mb-4" />
      <p class="text-slate-500">正在执行多维审核...</p>
      <p class="text-xs text-slate-400 mt-2">检测一致性、结构、模板、签字、文本瑕疵、亮点</p>
    </div>

    <!-- 错误提示 -->
    <div v-else-if="error" class="bg-red-50 border border-red-200 rounded-lg p-4">
      <div class="flex items-start gap-2">
        <AlertTriangle class="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p class="text-red-700 font-medium">审核失败</p>
          <p class="text-red-600 text-sm mt-1">{{ error }}</p>
        </div>
      </div>
    </div>

    <!-- 审核结果 -->
    <template v-else-if="result && summary">
      <!-- 一、整体结论卡片 -->
      <div :class="['rounded-xl border-2 p-5', overallRiskClass]">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2">
            <AlertTriangle v-if="summary.overallRisk === 'high'" class="w-5 h-5" />
            <Info v-else-if="summary.overallRisk === 'medium'" class="w-5 h-5" />
            <CheckCircle2 v-else class="w-5 h-5" />
            <h3 class="font-semibold">一、整体核查结论</h3>
          </div>
          <button
            @click="downloadReport"
            class="px-4 py-2 rounded-lg bg-cyber-cyan text-white text-sm font-medium hover:opacity-90 flex items-center gap-1.5 shadow-sm"
          >
            <Download class="w-4 h-4" />
            下载 HTML 报告
          </button>
        </div>
        <p class="text-sm mb-3">{{ summary.conclusion }}</p>
        <div v-if="rejectionIssues.length > 0" class="rounded-lg px-4 py-3 mb-3 text-white text-sm font-bold"
          style="background:#7f1d1d">
          ⚠ 检出 {{ rejectionIssues.length }} 项废标风险：命中招标文件否决条款，按现行投标文件状态将被否决/废标（详见第
          {{ secNo.rejection }} 章），必须在递交前完成整改并复核
        </div>
        <div class="flex flex-wrap gap-2 text-xs">
          <span v-if="rejectionIssues.length > 0" class="px-2.5 py-1 rounded-full text-white font-bold"
            style="background:#7f1d1d">废标项 {{ rejectionIssues.length }}</span>
          <span class="px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium">
            准高危 {{ summary.criticalCount }}
          </span>
          <span class="px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 font-medium">
            扣分项 {{ summary.majorCount }}
          </span>
          <span class="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
            细节优化 {{ summary.minorCount }}
          </span>
          <span class="px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-medium">
            合规亮点 {{ summary.highlightCount }}
          </span>
          <span v-if="typeof summary.estimatedScore === 'number' && summary.estimatedFullScore"
            class="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold">
            模拟总分 {{ summary.estimatedScore }} / {{ summary.estimatedFullScore }} 分
          </span>
        </div>
      </div>

      <!-- 二、废标风险项（命中否决条款，暗红分区，直接定性废标） -->
      <div v-if="rejectionIssues.length > 0" class="rounded-lg overflow-hidden border-2 bg-white" style="border-color:#7f1d1d">
        <div class="px-4 py-2.5 flex items-center justify-between flex-wrap gap-2" style="background:#7f1d1d">
          <h4 class="font-medium text-white">{{ secNo.rejection }}、废标风险项（命中否决条款，将被认定废标）</h4>
          <span class="text-xs text-red-100">{{ rejectionIssues.length }} 项</span>
        </div>
        <div class="px-4 py-2.5 bg-red-50 border-b" style="border-color:#7f1d1d33">
          <p class="text-xs font-bold leading-relaxed" style="color:#7f1d1d">
            以下问题命中招标文件/政府采购法定否决条款（如多处报价不一致、大小写金额不符、未实质性响应等）。按招标文件规定，评标委员会将认定投标无效/废标，必须逐项整改并复核所有报价表原件后方可递交。
          </p>
        </div>
        <div class="divide-y divide-red-100">
          <div v-for="(issue, ci) in rejectionIssues" :key="issue.id" class="text-sm">
            <button type="button" @click="toggleIssue(issue.id)"
              class="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-red-50/60">
              <component :is="expandedIssues.has(issue.id) ? ChevronUp : ChevronDown"
                class="w-4 h-4 flex-shrink-0 mt-0.5" style="color:#7f1d1d" />
              <span class="flex-1 min-w-0">
                <span class="font-bold" style="color:#7f1d1d">{{ ci + 1 }}. {{ issue.name }}</span>
                <span class="ml-2 text-xs text-slate-400">{{ dimensionLabels[issue.dimension] }}</span>
                <span class="ml-2 text-xs text-purple-600 font-medium">{{ formatLocation(issue) }}</span>
              </span>
              <span class="flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold text-white" style="background:#7f1d1d">废标项</span>
            </button>
            <div v-if="expandedIssues.has(issue.id)" class="px-4 pb-4 pl-12 space-y-2 text-xs">
              <p class="text-slate-700">{{ issue.description }}</p>
              <div v-if="issue.evidence" class="bg-slate-50 border-l-2 px-3 py-2 text-slate-700 whitespace-pre-wrap rounded-r"
                style="border-color:#7f1d1d">
                <b>证据：</b>{{ issue.evidence }}
              </div>
              <p v-if="issue.basis" class="text-slate-500"><b>违反依据：</b>{{ issue.basis }}</p>
              <div v-if="issue.remediation" class="p-2 bg-amber-50 border-l-2 border-amber-400 text-amber-800">
                <b>整改：</b>{{ issue.remediation }}
              </div>
              <p class="font-bold" style="color:#7f1d1d">※ 本项命中否决条款：按招标文件规定将被认定为废标/无效投标，必须整改后方可递交。</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 投标文件完整性对照表 -->
      <div v-if="completeness.length > 0" class="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div class="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <h4 class="font-medium text-slate-800">{{ secNo.completeness }}、投标文件完整性对照表</h4>
          <div class="text-xs text-slate-500 flex gap-3">
            <span class="text-green-600 font-medium">完整 {{ completenessStats.complete }}</span>
            <span class="text-amber-600 font-medium">部分 {{ completenessStats.partial }}</span>
            <span class="text-red-600 font-medium">缺失 {{ completenessStats.missing }}</span>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-[760px]">
            <thead>
              <tr class="bg-slate-100 text-slate-600 text-xs">
                <th class="px-3 py-2 text-left w-[8%]">编号</th>
                <th class="px-3 py-2 text-left w-[22%]">文件名称</th>
                <th class="px-3 py-2 text-center w-[12%]">要求提交状态</th>
                <th class="px-3 py-2 text-left w-[22%]">实际提交状态</th>
                <th class="px-3 py-2 text-center w-[14%]">完整性检查结果</th>
                <th class="px-3 py-2 text-left w-[22%]">备注</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="item in completeness" :key="item.formatId + item.formatName" class="hover:bg-slate-50">
                <td class="px-3 py-2 text-slate-500">{{ item.formatId || "—" }}</td>
                <td class="px-3 py-2 font-medium text-slate-700">{{ item.formatName }}</td>
                <td class="px-3 py-2 text-center">
                  <span v-if="item.required === 'optional'" class="text-slate-500 text-xs">按需提交</span>
                  <span v-else class="text-red-700 text-xs font-semibold">要求必交</span>
                </td>
                <td class="px-3 py-2 text-slate-600 text-xs">
                  <span v-if="item.status === 'missing'" class="text-red-600 font-medium">未提交</span>
                  <span v-else>{{ item.fileName || "已提交" }}</span>
                </td>
                <td class="px-3 py-2 text-center">
                  <span :class="['px-2 py-0.5 rounded text-xs', completenessStatus(item).cls]">
                    {{ completenessStatus(item).label }}
                  </span>
                </td>
                <td class="px-3 py-2 text-xs text-slate-500">{{ item.remark }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 高危问题（准高危，非废标项） -->
      <div v-if="criticalIssues.length > 0" class="bg-white border border-red-200 rounded-lg overflow-hidden">
        <div class="bg-red-50 px-4 py-2.5 border-b border-red-200 flex items-center justify-between">
          <h4 class="font-medium text-red-800">{{ secNo.critical }}、高危问题（一票否决风险项）</h4>
          <span class="text-xs text-red-700">{{ criticalIssues.length }} 项</span>
        </div>
        <div class="divide-y divide-red-100">
          <div v-for="(issue, ci) in criticalIssues" :key="issue.id" class="text-sm">
            <button type="button" @click="toggleIssue(issue.id)"
              class="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-red-50/40">
              <component :is="expandedIssues.has(issue.id) ? ChevronUp : ChevronDown"
                class="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
              <span class="flex-1 min-w-0">
                <span class="font-medium text-slate-800">{{ ci + 1 }}. {{ issue.name }}</span>
                <span class="ml-2 text-xs text-slate-400">{{ dimensionLabels[issue.dimension] }}</span>
                <span class="ml-2 text-xs text-purple-600 font-medium">{{ formatLocation(issue) }}</span>
              </span>
              <span :class="['flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium border', riskConfig[issue.riskLevel].class]">
                {{ riskConfig[issue.riskLevel].label }}
              </span>
            </button>
            <div v-if="expandedIssues.has(issue.id)" class="px-4 pb-4 pl-12 space-y-2 text-xs">
              <p class="text-slate-700">{{ issue.description }}</p>
              <div v-if="issue.evidence" class="bg-slate-50 border-l-2 border-red-500 px-3 py-2 text-slate-700 whitespace-pre-wrap rounded-r">
                <b>证据：</b>{{ issue.evidence }}
              </div>
              <p v-if="issue.basis" class="text-slate-500"><b>违反依据：</b>{{ issue.basis }}</p>
              <div v-if="issue.remediation" class="p-2 bg-amber-50 border-l-2 border-amber-400 text-amber-800">
                <b>整改：</b>{{ issue.remediation }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 评标扣分问题 -->
      <div v-if="majorIssues.length > 0" class="bg-white border border-orange-200 rounded-lg overflow-hidden">
        <div class="bg-orange-50 px-4 py-2.5 border-b border-orange-200 flex items-center justify-between">
          <h4 class="font-medium text-orange-800">{{ secNo.major }}、评标扣分问题（失分项）</h4>
          <span class="text-xs text-orange-700">{{ majorIssues.length }} 项</span>
        </div>
        <div class="divide-y divide-orange-100">
          <div v-for="(issue, mi) in majorIssues" :key="issue.id" class="text-sm">
            <button type="button" @click="toggleIssue(issue.id)"
              class="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-orange-50/40">
              <component :is="expandedIssues.has(issue.id) ? ChevronUp : ChevronDown"
                class="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
              <span class="flex-1 min-w-0">
                <span class="font-medium text-slate-800">{{ mi + 1 }}. {{ issue.name }}</span>
                <span class="ml-2 text-xs text-slate-400">{{ dimensionLabels[issue.dimension] }}</span>
                <span class="ml-2 text-xs text-purple-600 font-medium">{{ formatLocation(issue) }}</span>
              </span>
              <span :class="['flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium border', riskConfig[issue.riskLevel].class]">
                {{ riskConfig[issue.riskLevel].label }}
              </span>
            </button>
            <div v-if="expandedIssues.has(issue.id)" class="px-4 pb-4 pl-12 space-y-2 text-xs">
              <p class="text-slate-700">{{ issue.description }}</p>
              <div v-if="issue.evidence" class="bg-slate-50 border-l-2 border-orange-500 px-3 py-2 text-slate-700 whitespace-pre-wrap rounded-r">
                <b>证据：</b>{{ issue.evidence }}
              </div>
              <p v-if="issue.basis" class="text-slate-500"><b>违反依据：</b>{{ issue.basis }}</p>
              <div v-if="issue.remediation" class="p-2 bg-amber-50 border-l-2 border-amber-400 text-amber-800">
                <b>整改：</b>{{ issue.remediation }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 细节优化问题 -->
      <div v-if="minorIssues.length > 0" class="bg-white border border-amber-200 rounded-lg overflow-hidden">
        <div class="bg-amber-50 px-4 py-2.5 border-b border-amber-200 flex items-center justify-between">
          <h4 class="font-medium text-amber-800">{{ secNo.minor }}、细节优化问题（提升项）</h4>
          <span class="text-xs text-amber-700">{{ minorIssues.length }} 项</span>
        </div>
        <div class="divide-y divide-amber-100">
          <div v-for="issue in minorIssues" :key="issue.id" class="px-4 py-2.5 text-sm hover:bg-amber-50/30">
            <p>
              <span :class="['px-1.5 py-0.5 rounded text-xs font-medium border mr-2', riskConfig[issue.riskLevel].class]">
                {{ riskConfig[issue.riskLevel].label }}
              </span>
              <span class="font-medium text-slate-700">{{ issue.name }}</span>
              <span class="ml-2 text-xs text-slate-400">{{ dimensionLabels[issue.dimension] }}</span>
              <span class="ml-2 text-xs text-purple-600">{{ formatLocation(issue) }}</span>
            </p>
            <p class="mt-1 text-xs text-slate-600">{{ issue.description }}</p>
            <p v-if="issue.remediation" class="mt-1 text-xs text-amber-800"><b>整改：</b>{{ issue.remediation }}</p>
          </div>
        </div>
      </div>

      <!-- 合规亮点梳理 -->
      <div v-if="highlights.length > 0" class="bg-green-50/50 border border-green-200 rounded-lg overflow-hidden">
        <div class="bg-green-100 px-4 py-2.5 flex items-center gap-2">
          <Sparkles class="w-4 h-4 text-green-700" />
          <h4 class="font-medium text-green-800">{{ secNo.highlights }}、合规亮点梳理（保留并强化）</h4>
        </div>
        <ul class="divide-y divide-green-100">
          <li v-for="h in highlights" :key="h.id" class="p-3 text-sm">
            <b class="text-green-800">{{ h.name }}：</b>
            <span class="text-slate-700">{{ h.description }}</span>
          </li>
        </ul>
      </div>

      <!-- 最终整改清单 P0/P1/P2 -->
      <div v-if="remediationPlan">
        <h4 class="text-sm font-semibold text-slate-700 pt-2">{{ secNo.remediation }}、最终整改清单（按优先级执行）</h4>
      </div>
      <div v-if="remediationPlan" class="space-y-4">
        <!-- P0 -->
        <div v-if="remediationPlan.p0.length > 0" class="bg-red-50/50 border border-red-200 rounded-lg overflow-hidden">
          <div class="bg-red-100 px-4 py-2.5 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-white">P0</span>
              <h4 class="font-medium text-red-800">递交前必须完成（否则有无效/失分风险）</h4>
            </div>
            <span class="text-sm text-red-700">{{ remediationPlan.p0.length }} 项</span>
          </div>
          <div class="divide-y divide-red-100">
            <div v-for="(issue, idx) in remediationPlan.p0" :key="issue.id" class="p-4 hover:bg-red-50/30">
              <div class="flex items-start gap-3">
                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center">{{ idx + 1 }}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span v-if="issue.rejection" class="px-2 py-0.5 rounded text-xs font-bold text-white" style="background:#7f1d1d">废标项</span>
                    <span v-else :class="['px-2 py-0.5 rounded text-xs font-medium border', riskConfig[issue.riskLevel].class]">
                      {{ riskConfig[issue.riskLevel].label }}
                    </span>
                    <span class="text-xs text-slate-500">{{ dimensionLabels[issue.dimension] }}</span>
                    <span class="text-xs text-purple-600 font-medium">{{ formatLocation(issue) }}</span>
                  </div>
                  <p class="font-medium text-slate-800 text-sm">{{ issue.name }}</p>
                  <p class="text-sm text-slate-600 mt-1">{{ issue.description }}</p>
                  <div v-if="issue.remediation" class="mt-2 p-2 bg-amber-50 border-l-2 border-amber-400 text-sm text-amber-800">
                    <b>整改：</b>{{ issue.remediation }}
                  </div>
                  <div v-if="issue.basis" class="mt-1 text-xs text-slate-500">
                    <b>依据：</b>{{ issue.basis }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- P1 -->
        <div v-if="remediationPlan.p1.length > 0" class="bg-orange-50/50 border border-orange-200 rounded-lg overflow-hidden">
          <div class="bg-orange-100 px-4 py-2.5 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-orange-600 text-white">P1</span>
              <h4 class="font-medium text-orange-800">强烈建议完成（直接关系得分）</h4>
            </div>
            <span class="text-sm text-orange-700">{{ remediationPlan.p1.length }} 项</span>
          </div>
          <div class="divide-y divide-orange-100">
            <div v-for="(issue, idx) in remediationPlan.p1" :key="issue.id" class="p-4 hover:bg-orange-50/30">
              <div class="flex items-start gap-3">
                <span class="flex-shrink-0 w-6 h-6 rounded-full bg-orange-600 text-white text-xs font-bold flex items-center justify-center">{{ idx + 1 }}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span :class="['px-2 py-0.5 rounded text-xs font-medium border', riskConfig[issue.riskLevel].class]">
                      {{ riskConfig[issue.riskLevel].label }}
                    </span>
                    <span class="text-xs text-slate-500">{{ dimensionLabels[issue.dimension] }}</span>
                    <span class="text-xs text-purple-600 font-medium">{{ formatLocation(issue) }}</span>
                  </div>
                  <p class="font-medium text-slate-800 text-sm">{{ issue.name }}</p>
                  <p class="text-sm text-slate-600 mt-1">{{ issue.description }}</p>
                  <div v-if="issue.remediation" class="mt-2 p-2 bg-amber-50 border-l-2 border-amber-400 text-sm text-amber-800">
                    <b>整改：</b>{{ issue.remediation }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- P2 -->
        <div v-if="remediationPlan.p2.length > 0" class="bg-amber-50/50 border border-amber-200 rounded-lg overflow-hidden">
          <div class="bg-amber-100 px-4 py-2.5 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-600 text-white">P2</span>
              <h4 class="font-medium text-amber-800">时间允许时优化</h4>
            </div>
            <span class="text-sm text-amber-700">{{ remediationPlan.p2.length }} 项</span>
          </div>
          <div class="divide-y divide-amber-100">
            <div v-for="(issue, idx) in remediationPlan.p2" :key="issue.id" class="p-3 hover:bg-amber-50/30">
              <div class="flex items-start gap-2">
                <span class="flex-shrink-0 text-amber-700 text-sm font-medium">{{ idx + 1 }}.</span>
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-medium text-slate-700">{{ issue.name }}：</span>
                  <span class="text-sm text-slate-600">{{ issue.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 待补充核查 -->
      <div v-if="remediationPlan && remediationPlan.manualCheck.length > 0" class="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
        <div class="flex items-center gap-2 mb-2">
          <FileCheck class="w-4 h-4 text-yellow-700" />
          <h4 class="font-medium text-yellow-800">{{ secNo.manual }}、待补充核查（需人工核对扫描件/原件/事实存疑项后确认）</h4>
        </div>
        <ul class="list-disc list-inside text-sm text-yellow-800 space-y-1">
          <li v-for="(c, idx) in remediationPlan.manualCheck" :key="idx">{{ c }}</li>
        </ul>
      </div>

      <!-- 评分索引与逐项打分（可选增值内容，统一置于全部审查内容之后；仅在有评分项时渲染） -->
      <div v-if="scoringIndex.length > 0" class="bg-white border border-emerald-200 rounded-lg overflow-hidden">
        <div class="bg-emerald-50 px-4 py-2.5 border-b border-emerald-200 flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <FileCheck class="w-4 h-4 text-emerald-700" />
            <h4 class="font-medium text-emerald-900">{{ secNo.scoring }}、评分索引与逐项打分</h4>
          </div>
          <div v-if="scoreTotal" class="text-xs text-emerald-800">
            模拟评估总分：<b class="text-sm">{{ scoreTotal.got }} / {{ scoreTotal.full }}</b> 分（得分率 {{ scoreTotal.rate }}%）
          </div>
        </div>
        <div v-if="scoringIndex.length === 0" class="px-4 py-4 bg-amber-50 border-l-4 border-amber-400 m-3 rounded">
          <p class="text-sm font-medium text-amber-900">⚠ 未能自动抽取到结构化评分项，本章未完成逐项打分</p>
          <p class="mt-1 text-xs text-amber-800 leading-relaxed">
            系统已尝试定位招标文件中的评标办法/评分标准章节但未解析出可打分的评分项（常见原因：评分办法位于扫描图片页、分值表为复杂表格）。
            请人工查阅招标文件评分办法章节，按原文分值表逐项对照投标文件评分；该事项已列入待人工核查清单。重新上传文字版招标文件后再次运行审核可自动完成本章。
          </p>
        </div>
        <template v-else>
        <p class="px-4 pt-2.5 text-xs text-slate-500">
          严格依据招标文件评分办法原文构建，点击各评分项可展开评分细则、投标文件章节/页码/段落引用、证据原文与详细评分说明；标注"需人工复核"的项不作为最终结论，最终得分以评标委员会评审为准。
        </p>
        <div class="divide-y divide-slate-100">
          <div v-for="(row, idx) in scoringIndex" :key="row.id" class="text-sm">
            <button
              type="button"
              @click="toggleScore(row.id)"
              class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-emerald-50/40"
            >
              <component :is="expandedScoreIds.has(row.id) ? ChevronUp : ChevronDown" class="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span class="flex-shrink-0 text-xs font-mono text-slate-500 w-14">{{ row.code || idx + 1 }}</span>
              <span class="flex-1 min-w-0">
                <span class="font-medium text-slate-800">{{ row.name }}</span>
                <span class="ml-2 text-xs text-slate-400">{{ row.category }}</span>
              </span>
              <span class="flex-shrink-0 text-xs text-slate-500 w-16 text-right">权重 {{ row.weight }}%</span>
              <span class="flex-shrink-0 text-xs w-20 text-right">
                <span :class="['font-bold', scoreCls(scoreRate(row.assessment?.score, row.fullScore), !!row.assessment)]">
                  {{ row.assessment ? row.assessment.score : "待评分" }}
                </span>
                <span class="text-slate-400"> / {{ row.fullScore }}</span>
              </span>
            </button>
            <div v-if="expandedScoreIds.has(row.id)" class="px-4 pb-4 pl-12 space-y-2 text-xs">
              <p class="text-slate-600"><b class="text-slate-700">评分标准详细描述：</b>{{ row.description || "（以评分细则原文为准）" }}</p>
              <p class="text-slate-600"><b class="text-slate-700">具体评分细则：</b>{{ row.rules || "（未抽取到细则原文）" }}</p>
              <p class="text-slate-600"><b class="text-slate-700">招标文件对应条款：</b><span class="text-purple-600">{{ row.sourceClause || "未注明出处" }}</span></p>
              <p v-if="row.assessment" class="text-slate-600">
                <b class="text-slate-700">投标文件精确引用：</b>
                {{ row.assessment.bidChapter || "未定位章节" }}
                <template v-if="row.assessment.bidPage">　·　第 {{ row.assessment.bidPage }} 页</template>
                <template v-if="row.assessment.bidParagraph">　·　{{ row.assessment.bidParagraph }}</template>
              </p>
              <p v-if="row.assessment?.criterionClause" class="text-slate-600">
                <b class="text-slate-700">适用评分条款：</b>{{ row.assessment.criterionClause }}
              </p>
              <div v-if="row.assessment?.evidenceQuote"
                class="bg-slate-50 border-l-2 border-emerald-500 px-3 py-2 text-slate-700 whitespace-pre-wrap rounded-r">
                <b>投标文件引用原文（证据）：</b>{{ row.assessment.evidenceQuote }}
              </div>
              <p v-if="row.assessment" class="text-slate-600">
                <b class="text-slate-700">评分依据与详细评分说明：</b>{{ row.assessment.explanation || "（未给出说明）" }}
              </p>
              <p v-if="row.assessment?.needManualCheck" class="text-amber-700 bg-amber-50 px-2 py-1 rounded">
                ※ 该项证据或分值需人工复核后确认，当前得分不作为最终结论。
              </p>
            </div>
          </div>
        </div>
        </template>
      </div>
    </template>

    <!-- 空状态 -->
    <div v-else class="text-center py-16 text-slate-400">
      <FileCheck class="w-12 h-12 mx-auto mb-3 opacity-50" />
      <p>尚未执行多维审核</p>
    </div>

    <!-- 导航按钮 -->
    <div class="flex justify-between items-center pt-4 border-t border-slate-200">
      <button
        @click="emit('back')"
        class="px-5 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm"
      >
        返回上传
      </button>
      <div class="flex gap-3">
        <button
          @click="emit('restart')"
          class="px-5 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm flex items-center gap-1.5"
        >
          <RotateCcw class="w-4 h-4" />
          重新审查
        </button>
        <button
          v-if="result"
          @click="downloadReport"
          class="px-5 py-2 rounded-lg bg-cyber-cyan text-white hover:opacity-90 text-sm font-medium flex items-center gap-1.5"
        >
          <Download class="w-4 h-4" />
          下载 HTML 报告
        </button>
      </div>
    </div>
  </div>
</template>

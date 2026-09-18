<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  AlertTriangle, CheckCircle2, Info, Sparkles, ListChecks,
  FileCheck, ChevronDown, ChevronUp, Loader2, Download,
} from "lucide-vue-next";
import type {
  Issue, RiskLevel, CompletenessItem, MultiDimReviewResult,
} from "@/types";
import { runMultiDimReview, getRemediationPlan, exportMultiDimReport } from "@/api";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: "next"): void;
  (e: "back"): void;
}>();

const loading = ref(false);
const error = ref("");
const result = ref<MultiDimReviewResult | null>(null);
const procurementName = ref("");
const generatedAt = ref<number>(0);
const expandedIssues = ref<Set<string>>(new Set());

const summary = computed(() => result.value?.summary);
const remediationPlan = computed(() => result.value?.remediationPlan);
const completeness = computed<CompletenessItem[]>(() => result.value?.completeness || []);
const highlights = computed<Issue[]>(() => result.value?.highlights || []);

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
    a.download = "投标文件全方位审核报告.html";
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
          多维审核与整改清单
        </h2>
        <p class="text-sm text-slate-500 mt-1">
          覆盖：数据一致性 / 结构规范 / 模板残留 / 签字盖章 / 文本瑕疵 / 合规亮点 / 完整性对照
        </p>
      </div>
      <button
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
      <!-- 整体结论卡片 -->
      <div :class="['rounded-xl border-2 p-5', overallRiskClass]">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2">
            <AlertTriangle v-if="summary.overallRisk === 'high'" class="w-5 h-5" />
            <Info v-else-if="summary.overallRisk === 'medium'" class="w-5 h-5" />
            <CheckCircle2 v-else class="w-5 h-5" />
            <h3 class="font-semibold">整体核查结论</h3>
          </div>
          <button
            @click="downloadReport"
            class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <Download class="w-4 h-4" />
            导出 HTML 报告
          </button>
        </div>
        <p class="text-sm mb-3">{{ summary.conclusion }}</p>
        <div class="flex flex-wrap gap-2 text-xs">
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
        </div>
      </div>

      <!-- 整改清单 P0/P1/P2 -->
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

      <!-- 合规亮点 -->
      <div v-if="highlights.length > 0" class="bg-green-50/50 border border-green-200 rounded-lg overflow-hidden">
        <div class="bg-green-100 px-4 py-2.5 flex items-center gap-2">
          <Sparkles class="w-4 h-4 text-green-700" />
          <h4 class="font-medium text-green-800">合规亮点梳理（保留并强化）</h4>
        </div>
        <ul class="divide-y divide-green-100">
          <li v-for="h in highlights" :key="h.id" class="p-3 text-sm">
            <b class="text-green-800">{{ h.name }}：</b>
            <span class="text-slate-700">{{ h.description }}</span>
          </li>
        </ul>
      </div>

      <!-- 待人工核验 -->
      <div v-if="remediationPlan && remediationPlan.manualCheck.length > 0" class="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
        <div class="flex items-center gap-2 mb-2">
          <FileCheck class="w-4 h-4 text-yellow-700" />
          <h4 class="font-medium text-yellow-800">待补充核查（需人工核对扫描件/原件后确认）</h4>
        </div>
        <ul class="list-disc list-inside text-sm text-yellow-800 space-y-1">
          <li v-for="(c, idx) in remediationPlan.manualCheck" :key="idx">{{ c }}</li>
        </ul>
      </div>

      <!-- 完整性对照表 -->
      <div v-if="completeness.length > 0" class="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div class="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <h4 class="font-medium text-slate-800">投标文件完整性对照表</h4>
        </div>
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-slate-100 text-slate-600 text-xs">
              <th class="px-3 py-2 text-left">格式</th>
              <th class="px-3 py-2 text-left">文件</th>
              <th class="px-3 py-2 text-center">状态</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="item in completeness" :key="item.formatId" class="hover:bg-slate-50">
              <td class="px-3 py-2 font-medium text-slate-700">{{ item.formatId }}</td>
              <td class="px-3 py-2 text-slate-600">{{ item.formatName }}</td>
              <td class="px-3 py-2 text-center">
                <span v-if="item.status === 'complete'" class="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">✓ 已提供</span>
                <span v-else-if="item.status === 'partial'" class="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">△ 部分</span>
                <span v-else class="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">✗ 缺失</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 空状态 -->
    <div v-else class="text-center py-16 text-slate-400">
      <FileCheck class="w-12 h-12 mx-auto mb-3 opacity-50" />
      <p>尚未执行多维审核</p>
    </div>

    <!-- 导航按钮 -->
    <div class="flex justify-between pt-4 border-t border-slate-200">
      <button
        @click="emit('back')"
        class="px-5 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm"
      >
        上一步
      </button>
      <button
        @click="emit('next')"
        class="px-5 py-2 rounded-lg bg-cyber-cyan text-white hover:opacity-90 text-sm font-medium"
      >
        下一步：报告导出
      </button>
    </div>
  </div>
</template>

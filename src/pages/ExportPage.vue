<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Download, FileCheck, CheckCircle2, RotateCcw, Bot, ShieldCheck,
  XCircle, Star, ScrollText
} from "lucide-vue-next";
import { exportReport } from "@/api";
import type { UnifiedReviewResult, LLMReviewResult } from "@/types";

const props = defineProps<{
  sessionId: string;
  result: UnifiedReviewResult | null;
}>();

const emit = defineEmits<{
  (e: "back"): void;
  (e: "restart"): void;
}>();

const isLLMMode = computed(() => props.result?.mode === "llm");
const llmResult = computed<LLMReviewResult | null>(
  () => (props.result?.mode === "llm" ? (props.result as LLMReviewResult) : null)
);

const exportOptions = ref({
  complianceTable: true,
  comparisonDetails: true,
  evaluation: true,
  rejection: true,
  scoring: true,
  analysisLog: true,
});

const isExporting = ref(false);
const isExported = ref(false);
const errorMsg = ref("");

const selectedCount = computed(() =>
  Object.values(exportOptions.value).filter(Boolean).length
);

const bidderCount = computed(() => props.result?.bidders.length || 0);
const itemCount = computed(() => props.result?.complianceTable.length || 0);
const rejectionCount = computed(() => llmResult.value?.rejection.items.length || 0);
const scoringCount = computed(() => llmResult.value?.scoringItems.length || 0);
const logCount = computed(() => llmResult.value?.analysisLog.length || 0);

async function handleExport() {
  if (selectedCount.value === 0 || isExporting.value) return;
  isExporting.value = true;
  isExported.value = false;
  errorMsg.value = "";

  try {
    const blob = await exportReport(props.sessionId, {
      complianceTable: exportOptions.value.complianceTable,
      comparisonDetails: exportOptions.value.comparisonDetails,
      evaluation: exportOptions.value.evaluation,
      rejection: isLLMMode.value ? exportOptions.value.rejection : undefined,
      scoring: isLLMMode.value ? exportOptions.value.scoring : undefined,
      analysisLog: isLLMMode.value ? exportOptions.value.analysisLog : undefined,
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const modeSuffix = isLLMMode.value ? "LLM审核" : "本地审核";
    a.download = `审查报告_${modeSuffix}_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    isExported.value = true;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "导出失败";
  } finally {
    isExporting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div class="flex items-center gap-3">
      <div class="w-1 h-8 shadow-cyan-glow" :class="isLLMMode ? 'bg-cyber-purple' : 'bg-cyber-cyan'"></div>
      <h2 class="text-2xl font-bold" :class="isLLMMode ? 'text-cyber-purple' : 'neon-text-cyan'">报告导出</h2>
      <span class="text-slate-500 text-sm">[步骤 4/4]</span>
      <span
        v-if="isLLMMode"
        class="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-300"
      >
        <Bot class="w-3 h-3" /> LLM 智能审核
      </span>
      <span
        v-else
        class="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-300"
      >
        <ShieldCheck class="w-3 h-3" /> 本地规则审核
      </span>
    </div>

    <p class="text-slate-500 text-sm">选择导出内容，生成 HTML 格式审查报告（内联样式，离线可打开）</p>

    <!-- 导出选项 -->
    <div class="cyber-panel p-6">
      <h3 class="font-semibold text-slate-700 mb-4">导出内容</h3>

      <div class="space-y-3">
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-cyber-cyan/50 transition-colors" :class="{ 'bg-blue-50 border-cyber-cyan/40': exportOptions.complianceTable }">
          <input type="checkbox" v-model="exportOptions.complianceTable" class="w-5 h-5 accent-cyber-cyan" />
          <div>
            <p class="text-slate-700">符合性检查表格</p>
            <p class="text-xs text-slate-400">包含所有审查项与各公司响应状态矩阵</p>
          </div>
        </label>

        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-cyber-cyan/50 transition-colors" :class="{ 'bg-blue-50 border-cyber-cyan/40': exportOptions.comparisonDetails }">
          <input type="checkbox" v-model="exportOptions.comparisonDetails" class="w-5 h-5 accent-cyber-cyan" />
          <div>
            <p class="text-slate-700">比对详情</p>
            <p class="text-xs text-slate-400">逐条比对的采购要求与投标响应原文及偏离说明</p>
          </div>
        </label>

        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-cyber-cyan/50 transition-colors" :class="{ 'bg-blue-50 border-cyber-cyan/40': exportOptions.evaluation }">
          <input type="checkbox" v-model="exportOptions.evaluation" class="w-5 h-5 accent-cyber-cyan" />
          <div>
            <p class="text-slate-700">专业评价</p>
            <p class="text-xs text-slate-400">综合评分、风险提示与建议结论</p>
          </div>
        </label>

        <!-- LLM 模式专属选项 -->
        <template v-if="isLLMMode">
          <label
            v-if="rejectionCount > 0"
            class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-red-300/50 transition-colors"
            :class="{ 'bg-red-50 border-red-300/40': exportOptions.rejection }"
          >
            <input type="checkbox" v-model="exportOptions.rejection" class="w-5 h-5 accent-red-500" />
            <div class="flex items-center gap-2">
              <XCircle class="w-4 h-4 text-red-500" />
              <div>
                <p class="text-slate-700">废标项分析</p>
                <p class="text-xs text-slate-400">共 {{ rejectionCount }} 项废标条件及各投标人触发情况</p>
              </div>
            </div>
          </label>

          <label
            v-if="scoringCount > 0"
            class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-amber-300/50 transition-colors"
            :class="{ 'bg-amber-50 border-amber-300/40': exportOptions.scoring }"
          >
            <input type="checkbox" v-model="exportOptions.scoring" class="w-5 h-5 accent-amber-500" />
            <div class="flex items-center gap-2">
              <Star class="w-4 h-4 text-amber-500" />
              <div>
                <p class="text-slate-700">评分项与模拟打分</p>
                <p class="text-xs text-slate-400">共 {{ scoringCount }} 项评分标准及各投标人模拟得分</p>
              </div>
            </div>
          </label>

          <label
            v-if="logCount > 0"
            class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-slate-400/50 transition-colors"
            :class="{ 'bg-slate-50 border-slate-400/40': exportOptions.analysisLog }"
          >
            <input type="checkbox" v-model="exportOptions.analysisLog" class="w-5 h-5 accent-slate-600" />
            <div class="flex items-center gap-2">
              <ScrollText class="w-4 h-4 text-slate-600" />
              <div>
                <p class="text-slate-700">分析过程日志</p>
                <p class="text-xs text-slate-400">共 {{ logCount }} 条 AI 分析记录，结果可追溯</p>
              </div>
            </div>
          </label>
        </template>
      </div>
    </div>

    <!-- 报告信息 -->
    <div class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <FileCheck class="w-5 h-5 text-cyber-green" />
        <h3 class="font-semibold text-slate-700">报告信息</h3>
      </div>
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span class="text-slate-400">审核模式：</span>
          <span class="text-slate-700">{{ isLLMMode ? 'LLM 智能审核' : '本地规则审核' }}</span>
        </div>
        <div>
          <span class="text-slate-400">投标公司数：</span>
          <span class="text-slate-700">{{ bidderCount }} 家</span>
        </div>
        <div>
          <span class="text-slate-400">审查项数：</span>
          <span class="text-slate-700">{{ itemCount }} 项</span>
        </div>
        <div v-if="isLLMMode">
          <span class="text-slate-400">废标项数：</span>
          <span class="text-slate-700">{{ rejectionCount }} 项</span>
        </div>
        <div v-if="isLLMMode">
          <span class="text-slate-400">评分项数：</span>
          <span class="text-slate-700">{{ scoringCount }} 项</span>
        </div>
        <div>
          <span class="text-slate-400">综合评分：</span>
          <span class="text-slate-700">{{ result?.evaluation.score }} 分</span>
        </div>
        <div>
          <span class="text-slate-400">导出时间：</span>
          <span class="text-slate-700">{{ new Date().toLocaleString('zh-CN') }}</span>
        </div>
      </div>
    </div>

    <!-- 导出成功提示 -->
    <div v-if="isExported" class="cyber-panel p-6 border-cyber-green/40">
      <div class="flex items-center gap-3">
        <CheckCircle2 class="w-8 h-8 text-cyber-green" />
        <div>
          <p class="text-cyber-green font-semibold">报告已生成</p>
          <p class="text-sm text-slate-500">审查报告 HTML 文件已开始下载，可离线打开查看</p>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
      {{ errorMsg }}
    </div>

    <!-- 底部操作 -->
    <div class="flex justify-between items-center pt-4 border-t border-cyber-border">
      <button @click="emit('back')" class="cyber-btn text-slate-500 border-slate-200 hover:text-slate-700">
        ← 上一步
      </button>
      <div class="flex gap-3">
        <button
          v-if="isExported"
          @click="emit('restart')"
          class="cyber-btn text-slate-500 border-slate-200 hover:text-slate-700"
        >
          <RotateCcw class="w-4 h-4 inline mr-1" /> 重新审查
        </button>
        <button
          :disabled="selectedCount === 0 || isExporting"
          @click="handleExport"
          :class="isLLMMode ? 'cyber-btn-purple' : 'cyber-btn-primary'"
          class="disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download v-if="!isExporting" class="w-4 h-4 inline mr-1" />
          <span v-if="isExporting">生成中...</span>
          <span v-else-if="isExported">重新下载</span>
          <span v-else>生成 HTML 报告</span>
        </button>
      </div>
    </div>
  </div>
</template>

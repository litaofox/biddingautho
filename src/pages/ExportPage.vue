<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Download, FileCheck, CheckCircle2, RotateCcw, Bot, ShieldCheck,
} from "lucide-vue-next";
import { exportMultiDimReport } from "@/api";
import type { ReviewMode } from "@/types";

const props = defineProps<{
  sessionId: string;
  mode: ReviewMode;
}>();

const emit = defineEmits<{
  (e: "back"): void;
  (e: "restart"): void;
}>();

const isLLMMode = computed(() => props.mode === "llm");

// 多维审核报告章节选项
const reportOptions = ref({
  summary: true,
  critical: true,
  major: true,
  minor: true,
  highlights: true,
  remediation: true,
  manualCheck: true,
  completeness: true,
});

const isExporting = ref(false);
const isExported = ref(false);
const errorMsg = ref("");

const selectedCount = computed(() => Object.values(reportOptions.value).filter(Boolean).length);

async function handleExport() {
  if (selectedCount.value === 0 || isExporting.value) return;
  isExporting.value = true;
  isExported.value = false;
  errorMsg.value = "";

  try {
    const blob = await exportMultiDimReport(props.sessionId, { ...reportOptions.value });
    const date = new Date().toISOString().slice(0, 10);
    const filename = `投标文件全方位审核报告_${isLLMMode.value ? "LLM" : "本地"}_${date}.html`;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
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
      <div class="w-1 h-8 shadow-cyan-glow" :class="isLLMMode ? 'bg-purple-500' : 'bg-cyber-cyan'"></div>
      <h2 class="text-2xl font-bold" :class="isLLMMode ? 'text-purple-600' : 'neon-text-cyan'">报告导出</h2>
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
        <ShieldCheck class="w-3 h-3" /> 本地检查
      </span>
    </div>

    <p class="text-slate-500 text-sm">选择导出内容，生成 HTML 格式审核报告（内联样式，离线可打开）</p>

    <!-- 导出选项 -->
    <div class="cyber-panel p-6">
      <h3 class="font-semibold text-slate-700 mb-4">导出内容（已选 {{ selectedCount }} 项）</h3>

      <div class="space-y-3">
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-cyber-cyan/50 transition-colors" :class="{ 'bg-blue-50 border-cyber-cyan/40': reportOptions.summary }">
          <input type="checkbox" v-model="reportOptions.summary" class="w-5 h-5 accent-cyber-cyan" />
          <div>
            <p class="text-slate-700">整体核查结论</p>
            <p class="text-xs text-slate-400">风险分级汇总与总体结论</p>
          </div>
        </label>
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-red-300/50 transition-colors" :class="{ 'bg-red-50 border-red-300/40': reportOptions.critical }">
          <input type="checkbox" v-model="reportOptions.critical" class="w-5 h-5 accent-red-500" />
          <div>
            <p class="text-slate-700">准高危问题</p>
            <p class="text-xs text-slate-400">可能导致无效投标的关键问题清单</p>
          </div>
        </label>
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-orange-300/50 transition-colors" :class="{ 'bg-orange-50 border-orange-300/40': reportOptions.major }">
          <input type="checkbox" v-model="reportOptions.major" class="w-5 h-5 accent-orange-500" />
          <div>
            <p class="text-slate-700">扣分项问题</p>
            <p class="text-xs text-slate-400">影响评审得分的实质性问题</p>
          </div>
        </label>
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-amber-300/50 transition-colors" :class="{ 'bg-amber-50 border-amber-300/40': reportOptions.minor }">
          <input type="checkbox" v-model="reportOptions.minor" class="w-5 h-5 accent-amber-500" />
          <div>
            <p class="text-slate-700">细节优化项</p>
            <p class="text-xs text-slate-400">文本、格式等细节问题</p>
          </div>
        </label>
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-emerald-300/50 transition-colors" :class="{ 'bg-emerald-50 border-emerald-300/40': reportOptions.highlights }">
          <input type="checkbox" v-model="reportOptions.highlights" class="w-5 h-5 accent-emerald-500" />
          <div>
            <p class="text-slate-700">合规亮点</p>
            <p class="text-xs text-slate-400">响应到位、可加分的内容</p>
          </div>
        </label>
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-indigo-300/50 transition-colors" :class="{ 'bg-indigo-50 border-indigo-300/40': reportOptions.completeness }">
          <input type="checkbox" v-model="reportOptions.completeness" class="w-5 h-5 accent-indigo-500" />
          <div>
            <p class="text-slate-700">完整性对照</p>
            <p class="text-xs text-slate-400">采购文件要求材料与投标文件逐项对照</p>
          </div>
        </label>
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-pink-300/50 transition-colors" :class="{ 'bg-pink-50 border-pink-300/40': reportOptions.remediation }">
          <input type="checkbox" v-model="reportOptions.remediation" class="w-5 h-5 accent-pink-500" />
          <div>
            <p class="text-slate-700">整改清单（P0/P1/P2）与评分索引</p>
            <p class="text-xs text-slate-400">按优先级组织的整改建议与模拟打分</p>
          </div>
        </label>
        <label class="flex items-center gap-3 p-4 rounded-lg border border-slate-200 cursor-pointer hover:border-slate-400/50 transition-colors" :class="{ 'bg-slate-50 border-slate-400/40': reportOptions.manualCheck }">
          <input type="checkbox" v-model="reportOptions.manualCheck" class="w-5 h-5 accent-slate-600" />
          <div>
            <p class="text-slate-700">人工核查事项</p>
            <p class="text-xs text-slate-400">证照、签章等图片材料需人工确认的事项</p>
          </div>
        </label>
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
          <span class="text-slate-400">审核方式：</span>
          <span class="text-slate-700">{{ isLLMMode ? 'LLM 智能审核' : '本地规则检查' }}</span>
        </div>
        <div>
          <span class="text-slate-400">报告类型：</span>
          <span class="text-slate-700">投标文件全方位审核报告（HTML）</span>
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
          <p class="text-sm text-slate-500">HTML 报告已开始下载，可离线打开查看</p>
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
        ← 返回审核结果
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
          <span v-else>下载 HTML 报告</span>
        </button>
      </div>
    </div>
  </div>
</template>

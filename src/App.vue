<script setup lang="ts">
import { ref } from "vue";
import { ShieldCheck } from "lucide-vue-next";
import UploadPage from "@/pages/UploadPage.vue";
import ConfigPage from "@/pages/ConfigPage.vue";
import ResultPage from "@/pages/ResultPage.vue";
import RemediationPage from "@/pages/RemediationPage.vue";
import ExportPage from "@/pages/ExportPage.vue";
import type { UnifiedReviewResult, ReviewMode } from "@/types";

const currentStep = ref(0);
const sessionId = ref<string>("");
const reviewResult = ref<UnifiedReviewResult | null>(null);
const reviewMode = ref<ReviewMode>("local");

const steps = [
  { name: "文件上传", color: "cyan" },
  { name: "审查配置", color: "magenta" },
  { name: "审查结果", color: "green" },
  { name: "多维审核", color: "magenta" },
  { name: "报告导出", color: "cyan" },
];

function nextStep() {
  if (currentStep.value < steps.length - 1) currentStep.value++;
}
function prevStep() {
  if (currentStep.value > 0) currentStep.value--;
}
function restart() {
  currentStep.value = 0;
  sessionId.value = "";
  reviewResult.value = null;
  reviewMode.value = "local";
}
function onUploaded(sid: string) {
  sessionId.value = sid;
  nextStep();
}
function onReviewed(result: UnifiedReviewResult) {
  reviewResult.value = result;
  reviewMode.value = result.mode;
  nextStep();
}
// LLM 模式两阶段审查完成：结果已是 MultiDimReviewResult，直接进入多维审核页（跳过符合性结果页）
function onLlmAudited() {
  reviewMode.value = "llm";
  currentStep.value = 3;
}
// 多维审核页返回：LLM 模式回到审查配置（无符合性结果页），本地模式回到符合性结果页
function onRemediationBack() {
  currentStep.value = reviewMode.value === "llm" ? 1 : 2;
}

const colorMap: Record<string, string> = {
  cyan: "text-cyber-cyan border-cyber-cyan shadow-cyan-glow",
  magenta: "text-cyber-magenta border-cyber-magenta shadow-magenta-glow",
  green: "text-cyber-green border-cyber-green shadow-green-glow",
};
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶部导航 -->
    <header class="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm">
      <div class="container px-6 py-3.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <ShieldCheck class="w-7 h-7 text-cyber-cyan" />
            <div>
              <h1 class="text-lg font-semibold text-slate-800">投标书智能审查系统</h1>
              <p class="text-xs text-slate-400">BID COMPLIANCE REVIEW SYSTEM</p>
            </div>
          </div>

          <!-- 步骤指示器 -->
          <div class="hidden md:flex items-center gap-1">
            <template v-for="(step, idx) in steps" :key="idx">
              <div class="flex items-center">
                <div
                  class="flex items-center gap-2 px-3 py-1.5 rounded border transition-all"
                  :class="idx === currentStep
                    ? colorMap[step.color]
                    : idx < currentStep
                      ? 'text-cyber-green/60 border-cyber-green/30'
                      : 'text-cyber-gray border-cyber-border'"
                >
                  <span
                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    :class="idx <= currentStep ? 'bg-cyber-cyan/20 text-cyber-cyan' : 'bg-cyber-border text-cyber-gray'"
                  >
                    {{ idx < currentStep ? '✓' : idx + 1 }}
                  </span>
                  <span class="text-sm">{{ step.name }}</span>
                </div>
                <div
                  v-if="idx < steps.length - 1"
                  class="w-8 h-px mx-1"
                  :class="idx < currentStep ? 'bg-cyber-green/50' : 'bg-cyber-border'"
                ></div>
              </div>
            </template>
          </div>
        </div>

        <!-- 移动端步骤 -->
        <div class="md:hidden flex items-center justify-between mt-3">
          <span class="text-sm text-cyber-cyan">步骤 {{ currentStep + 1 }}/{{ steps.length }}</span>
          <span class="text-sm text-slate-500">{{ steps[currentStep].name }}</span>
        </div>
      </div>
    </header>

    <!-- 主内容区 -->
    <main class="flex-1 container px-6 py-8">
      <transition name="fade" mode="out-in">
        <UploadPage v-if="currentStep === 0" @uploaded="onUploaded" />
        <ConfigPage
          v-else-if="currentStep === 1"
          :session-id="sessionId"
          @reviewed="onReviewed"
          @llm-audited="onLlmAudited"
          @back="prevStep"
        />
        <ResultPage
          v-else-if="currentStep === 2"
          :result="reviewResult"
          @next="nextStep"
          @back="prevStep"
        />
        <RemediationPage
          v-else-if="currentStep === 3"
          :session-id="sessionId"
          @next="nextStep"
          @back="onRemediationBack"
        />
        <ExportPage
          v-else
          :session-id="sessionId"
          :result="reviewResult"
          :mode="reviewMode"
          @back="prevStep"
          @restart="restart"
        />
      </transition>
    </main>

    <!-- 页脚 -->
    <footer class="border-t border-slate-200 py-4 text-center bg-white">
      <p class="text-xs text-slate-400">
        © 2026 投标书智能审查系统 · 规则引擎 + 可选 LLM 增强 · 数据仅存内存
      </p>
    </footer>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>

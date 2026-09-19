<script setup lang="ts">
import { ref } from "vue";
import { ShieldCheck } from "lucide-vue-next";
import UploadPage from "@/pages/UploadPage.vue";
import AuditProgressPage from "@/pages/AuditProgressPage.vue";
import RemediationPage from "@/pages/RemediationPage.vue";
import { startLlmAutoAudit, startLocalAutoAudit } from "@/api";
import type { ReviewMode } from "@/types";

const currentStep = ref(0);
const sessionId = ref<string>("");
const reviewMode = ref<ReviewMode>("local");
// 最近一次审核启动配置（用于失败后无需重新上传即可重试）
const auditConfig = ref<{ provider: string; apiKey: string }>({ provider: "qianwen", apiKey: "" });
// 进度页实例标识：重试时自增强制重新挂载并重新轮询
const progressRunId = ref(0);
// 上传页实例标识：重新审查时自增强制清空已选文件与配置
const uploadFormKey = ref(0);

const steps = [
  { name: "文件上传", color: "cyan" },
  { name: "智能审核", color: "magenta" },
  { name: "审核结果", color: "green" },
];

function restart() {
  currentStep.value = 0;
  sessionId.value = "";
  reviewMode.value = "local";
  uploadFormKey.value++;
}

// 上传页一次点击完成上传+启动 → 进入进度页
function onStartAudit(payload: {
  sessionId: string;
  mode: ReviewMode;
  provider?: string;
  apiKey?: string;
}) {
  sessionId.value = payload.sessionId;
  reviewMode.value = payload.mode;
  auditConfig.value = {
    provider: payload.provider || "qianwen",
    apiKey: payload.apiKey || "",
  };
  progressRunId.value++;
  currentStep.value = 1;
}

// 失败重试：用相同配置重新发起审核，并重挂载进度页
async function onRetry() {
  try {
    if (reviewMode.value === "llm") {
      await startLlmAutoAudit(sessionId.value, auditConfig.value);
    } else {
      await startLocalAutoAudit(sessionId.value);
    }
    progressRunId.value++;
  } catch {
    // 启动失败时进度页会在下一次轮询读到 error 进度；此处忽略
  }
}

// 审核全部完成 → 结构化结果页
function onAuditDone() {
  currentStep.value = 2;
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
      <!-- 上传页始终保活（v-show），返回时已选文件与审核方式配置不丢失；
           重新审查时通过 :key 重挂载实现整体清空 -->
      <UploadPage
        v-show="currentStep === 0"
        :key="`upload-${uploadFormKey}`"
        @start-audit="onStartAudit"
      />
      <AuditProgressPage
        v-if="currentStep === 1"
        :key="`progress-${progressRunId}`"
        :session-id="sessionId"
        :mode="reviewMode"
        @done="onAuditDone"
        @back="currentStep = 0"
        @retry="onRetry"
      />
      <RemediationPage
        v-else-if="currentStep === 2"
        :session-id="sessionId"
        :mode="reviewMode"
        @back="currentStep = 0"
        @restart="restart"
      />
    </main>

    <!-- 页脚 -->
    <footer class="border-t border-slate-200 py-4 text-center bg-white">
      <p class="text-xs text-slate-400">
        © 2026 投标书智能审查系统 · 本地规则引擎 / LLM 智能审核 · 数据仅存内存
      </p>
    </footer>
  </div>
</template>

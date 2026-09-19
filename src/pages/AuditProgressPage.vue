<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { CheckCircle2, Loader2, Circle, AlertTriangle, Bot, ShieldCheck } from "lucide-vue-next";
import { getAuditProgress } from "@/api";
import type { AuditProgress } from "@/types";

const props = defineProps<{
  sessionId: string;
  mode: "local" | "llm";
}>();

const emit = defineEmits<{
  (e: "done"): void;
  (e: "back"): void;
  (e: "retry"): void;
}>();

const progress = ref<AuditProgress | null>(null);
const failed = ref(false);
const loadError = ref("");
let timer: ReturnType<typeof setTimeout> | null = null;
let finished = false;

const isLLM = computed(() => props.mode === "llm");
const percent = computed(() => progress.value?.percent ?? 0);
const elapsed = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

async function poll() {
  try {
    const p = await getAuditProgress(props.sessionId);
    if (p) progress.value = p;

    if (p?.status === "done" && !finished) {
      finished = true;
      stopTimers();
      // 让用户看到 100% 完成态，再跳转结果页
      timer = setTimeout(() => emit("done"), 1000);
      return;
    }
    if (p?.status === "error" && !finished) {
      finished = true;
      failed.value = true;
      loadError.value = p.error || "审核执行失败";
      stopTimers();
      return;
    }
    timer = setTimeout(poll, 1200);
  } catch (err) {
    // 网络抖动时继续重试，不立即判失败
    loadError.value = "";
    timer = setTimeout(poll, 2000);
  }
}

function stopTimers() {
  if (timer) clearTimeout(timer);
  if (elapsedTimer) clearInterval(elapsedTimer);
}

onMounted(() => {
  poll();
  elapsedTimer = setInterval(() => {
    elapsed.value++;
  }, 1000);
});

onUnmounted(stopTimers);

const elapsedText = computed(() => {
  const m = Math.floor(elapsed.value / 60);
  const s = elapsed.value % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
});
</script>

<template>
  <div class="space-y-6 max-w-3xl mx-auto">
    <!-- 页面标题 -->
    <div class="flex items-center gap-3">
      <div class="w-1 h-8 shadow-magenta-glow" :class="isLLM ? 'bg-purple-500' : 'bg-cyber-cyan'"></div>
      <h2 class="text-2xl font-bold" :class="isLLM ? 'text-purple-600' : 'neon-text-cyan'">
        {{ isLLM ? "LLM 智能审核进行中" : "本地检查进行中" }}
      </h2>
      <span class="text-cyber-gray text-sm">[步骤 2/3]</span>
    </div>

    <!-- 模式与耗时 -->
    <div class="cyber-panel p-6 space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm">
          <component :is="isLLM ? Bot : ShieldCheck" :class="isLLM ? 'text-purple-500' : 'text-blue-500'" class="w-5 h-5" />
          <span class="text-slate-600">{{ isLLM ? "AI 全流程自动审核，无需人工操作" : "规则引擎离线检查，请稍候" }}</span>
        </div>
        <span class="text-xs text-slate-400">已用时 {{ elapsedText }}</span>
      </div>

      <!-- 大进度条 -->
      <div>
        <div class="flex items-end justify-between mb-2">
          <p class="text-sm text-slate-600 min-h-[20px]">
            {{ progress?.message || "正在准备审核任务…" }}
          </p>
          <p class="text-2xl font-bold tabular-nums" :class="isLLM ? 'text-purple-600' : 'text-cyber-cyan'">
            {{ percent }}%
          </p>
        </div>
        <div class="h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-700 ease-out"
            :class="failed
              ? 'bg-red-400'
              : isLLM
                ? 'bg-gradient-to-r from-purple-400 to-purple-600'
                : 'bg-gradient-to-r from-cyan-400 to-blue-500'"
            :style="{ width: `${percent}%` }"
          ></div>
        </div>
      </div>

      <!-- 环节步骤列表 -->
      <div class="space-y-3 pt-2">
        <div
          v-for="step in (progress?.steps || [])"
          :key="step.key"
          class="flex items-center gap-3 text-sm"
          :class="{
            'text-slate-800 font-medium': step.status === 'active',
            'text-slate-400': step.status === 'pending',
            'text-slate-600': step.status === 'done',
          }"
        >
          <CheckCircle2 v-if="step.status === 'done'" class="w-5 h-5 text-cyber-green flex-shrink-0" />
          <Loader2 v-else-if="step.status === 'active'"
            class="w-5 h-5 flex-shrink-0 animate-spin" :class="isLLM ? 'text-purple-500' : 'text-cyber-cyan'" />
          <Circle v-else class="w-5 h-5 text-slate-300 flex-shrink-0" />
          <span>{{ step.label }}</span>
          <span v-if="step.status === 'active'" class="text-xs" :class="isLLM ? 'text-purple-400' : 'text-cyber-cyan'">
            进行中…
          </span>
        </div>
      </div>
    </div>

    <!-- 失败提示 -->
    <div v-if="failed" class="p-4 rounded-lg bg-red-50 border border-red-200 space-y-3">
      <div class="flex items-start gap-3">
        <AlertTriangle class="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p class="font-semibold text-red-700 text-sm">审核执行失败</p>
          <p class="text-xs text-red-600 mt-1 break-all">{{ loadError }}</p>
        </div>
      </div>
      <div class="flex gap-2 pl-8">
        <button @click="emit('retry')"
          class="px-4 py-2 rounded bg-purple-500 text-white text-sm hover:bg-purple-600">
          重试本次审核
        </button>
        <button @click="emit('back')"
          class="px-4 py-2 rounded border border-slate-300 text-slate-600 text-sm hover:bg-slate-50">
          返回重新上传
        </button>
      </div>
    </div>

    <p v-if="!failed" class="text-center text-xs text-slate-400">
      {{ isLLM
        ? "大模型正在逐维度分析投标文件，整个过程可能需要数分钟，请勿关闭页面"
        : "系统正在自动完成检查，完成后将直接展示结构化审核结果" }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Upload, FileText, X, CheckCircle2, FileWarning, Wrench, Briefcase, Loader2,
  Bot, ShieldCheck, ShieldAlert, Sparkles, Zap,
} from "lucide-vue-next";
import { uploadFiles, startLlmAutoAudit, startLocalAutoAudit } from "@/api";

const emit = defineEmits<{
  (e: "start-audit", payload: {
    sessionId: string;
    mode: "local" | "llm";
    provider?: string;
    apiKey?: string;
  }): void;
}>();

// ========== 文件上传（仅一家投标公司） ==========
const procurementFile = ref<File | null>(null);
const projectReqFile = ref<File | null>(null);
const bidderName = ref("");
const technicalFile = ref<File | null>(null);
const commercialFile = ref<File | null>(null);

// 整体提交状态：uploading 上传解析中 / starting 启动审核中
const submitting = ref<"" | "uploading" | "starting">("");
const errorMsg = ref("");
// 上传成功后保留 sessionId：若后续启动审核失败，可直接重试而无需重新上传
const uploadedSessionId = ref("");

// ========== 审核方式 ==========
const auditMode = ref<"local" | "llm">("local");
const llmProvider = ref("qianwen");
const llmApiKey = ref("");
const llmRiskConfirmed = ref(false);
// 模拟打分（评分索引与逐项打分）功能入口开关——暂时下线；恢复时改回 true 即可（后端有对应总开关）
const SIMULATE_SCORING_ENABLED = false;
const simulateScoring = ref(true);

const procurementInput = ref<HTMLInputElement | null>(null);
const projectReqInput = ref<HTMLInputElement | null>(null);
const technicalInput = ref<HTMLInputElement | null>(null);
const commercialInput = ref<HTMLInputElement | null>(null);

const providers = [
  { value: "local", label: "本地兼容模型（推荐·数据不出内网）" },
  { value: "qianwen", label: "通义千问（外部·已脱敏）" },
  { value: "openai", label: "OpenAI（外部·已脱敏）" },
  { value: "qianfan", label: "百度千帆（外部·已脱敏）" },
  { value: "glm", label: "智谱 GLM（外部·已脱敏）" },
];
const isExternalProvider = computed(() => llmProvider.value !== "local");

function onProcurementChange(e: Event) {
  procurementFile.value = (e.target as HTMLInputElement).files?.[0] || null;
}
function onProjectReqChange(e: Event) {
  projectReqFile.value = (e.target as HTMLInputElement).files?.[0] || null;
}
function onTechnicalChange(e: Event) {
  technicalFile.value = (e.target as HTMLInputElement).files?.[0] || null;
  if (!bidderName.value && technicalFile.value) {
    bidderName.value = guessBidderName(technicalFile.value.name);
  }
}
function onCommercialChange(e: Event) {
  commercialFile.value = (e.target as HTMLInputElement).files?.[0] || null;
  if (!bidderName.value && commercialFile.value) {
    bidderName.value = guessBidderName(commercialFile.value.name);
  }
}

function guessBidderName(filename: string): string {
  return filename.replace(/\.(pdf|docx?|DOCX?|PDF)$/, "").slice(0, 30);
}

const hasBidFile = computed(() => technicalFile.value !== null || commercialFile.value !== null);
const filesReady = computed(
  () => procurementFile.value !== null && hasBidFile.value && bidderName.value.trim() !== ""
);
const llmReady = computed(() => {
  if (auditMode.value !== "llm") return true;
  if (isExternalProvider.value) {
    return llmApiKey.value.trim() !== "" && llmRiskConfirmed.value;
  }
  return true;
});
const canSubmit = computed(() => filesReady.value && llmReady.value && submitting.value === "");

// ========== 一次点击串行完成：上传解析 → 启动自动审核 → 进入进度页 ==========
async function handleStart() {
  if (!filesReady.value) {
    errorMsg.value = "请上传采购文件、填写投标公司名称，并至少上传一个投标文件";
    return;
  }
  if (auditMode.value === "llm" && isExternalProvider.value) {
    if (!llmApiKey.value.trim()) {
      errorMsg.value = "使用外部大模型请填写 API Key";
      return;
    }
    if (!llmRiskConfirmed.value) {
      errorMsg.value = "请先阅读并确认外部 LLM 数据安全风险";
      return;
    }
  }
  errorMsg.value = "";

  try {
    // 第一步：上传并解析（已上传过则跳过，支持启动失败后免重传重试）
    if (!uploadedSessionId.value) {
      submitting.value = "uploading";
      const res = await uploadFiles({
        procurement: procurementFile.value!,
        projectReq: projectReqFile.value || undefined,
        bidders: [
          {
            name: bidderName.value.trim(),
            files: [
              ...(technicalFile.value ? [{ file: technicalFile.value, type: "technical" as const }] : []),
              ...(commercialFile.value ? [{ file: commercialFile.value, type: "commercial" as const }] : []),
            ],
          },
        ],
      });
      uploadedSessionId.value = res.sessionId;
    }

    // 第二步：按所选方式启动后台自动审核
    submitting.value = "starting";
    if (auditMode.value === "local") {
      await startLocalAutoAudit(uploadedSessionId.value);
    } else {
      await startLlmAutoAudit(uploadedSessionId.value, {
        provider: llmProvider.value,
        apiKey: llmApiKey.value.trim(),
        simulateScoring: SIMULATE_SCORING_ENABLED && simulateScoring.value,
      });
    }

    // 第三步：进入进度页
    emit("start-audit", {
      sessionId: uploadedSessionId.value,
      mode: auditMode.value,
      ...(auditMode.value === "llm"
        ? { provider: llmProvider.value, apiKey: llmApiKey.value.trim() }
        : {}),
    });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "操作失败，请重试";
  } finally {
    submitting.value = "";
  }
}

function fileSize(f: File) {
  return `${(f.size / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div class="flex items-center gap-3">
      <div class="w-1 h-8 bg-cyber-cyan shadow-cyan-glow"></div>
      <h2 class="text-2xl font-bold neon-text-cyan">文件上传与审核方式</h2>
      <span class="text-cyber-gray text-sm">[步骤 1/3]</span>
    </div>
    <p class="text-cyber-gray text-sm">
      上传采购文件与<span class="text-cyber-green font-semibold">一家</span>投标公司的投标文件，并选择审核方式；
      点击开始后系统将自动完成解析与全部审核，无需其他操作
    </p>

    <!-- ========== 文件上传区 ========== -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- 采购文件 -->
      <div class="cyber-panel p-5">
        <div class="flex items-center gap-2 mb-4">
          <FileText class="w-5 h-5 text-cyber-cyan" />
          <h3 class="font-semibold text-cyber-cyan">采购文件</h3>
          <span class="text-cyber-red text-xs">*必填</span>
        </div>
        <input ref="procurementInput" type="file" accept=".pdf,.doc,.docx" class="hidden" @change="onProcurementChange" />
        <div
          v-if="!procurementFile"
          @click="procurementInput?.click()"
          class="border-2 border-dashed border-cyber-border rounded-lg p-8 text-center cursor-pointer hover:border-cyber-cyan/50 transition-colors group"
        >
          <Upload class="w-10 h-10 mx-auto text-cyber-gray group-hover:text-cyber-cyan transition-colors mb-3" />
          <p class="text-sm text-cyber-gray group-hover:text-cyber-cyan transition-colors">点击或拖拽上传</p>
          <p class="text-xs text-cyber-gray/60 mt-1">.pdf / .doc / .docx，≤ 100MB</p>
        </div>
        <div v-else class="flex items-center justify-between p-3 rounded-lg bg-cyber-cyan/10 border border-cyber-cyan/30">
          <div class="flex items-center gap-3 min-w-0">
            <CheckCircle2 class="w-5 h-5 text-cyber-green flex-shrink-0" />
            <div class="min-w-0">
              <p class="text-sm text-slate-700 truncate">{{ procurementFile.name }}</p>
              <p class="text-xs text-cyber-gray">{{ fileSize(procurementFile) }}</p>
            </div>
          </div>
          <button @click="procurementFile = null" class="text-cyber-gray hover:text-cyber-red transition-colors flex-shrink-0">
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- 项目需求 -->
      <div class="cyber-panel p-5">
        <div class="flex items-center gap-2 mb-4">
          <FileText class="w-5 h-5 text-cyber-magenta" />
          <h3 class="font-semibold text-cyber-magenta">项目需求</h3>
          <span class="text-cyber-gray text-xs">选填</span>
        </div>
        <input ref="projectReqInput" type="file" accept=".pdf,.doc,.docx,.txt" class="hidden" @change="onProjectReqChange" />
        <div
          v-if="!projectReqFile"
          @click="projectReqInput?.click()"
          class="border-2 border-dashed border-cyber-border rounded-lg p-8 text-center cursor-pointer hover:border-cyber-magenta/50 transition-colors group"
        >
          <Upload class="w-10 h-10 mx-auto text-cyber-gray group-hover:text-cyber-magenta transition-colors mb-3" />
          <p class="text-sm text-cyber-gray group-hover:text-cyber-magenta transition-colors">点击或拖拽上传</p>
          <p class="text-xs text-cyber-gray/60 mt-1">.pdf / .doc / .docx 或文本</p>
        </div>
        <div v-else class="flex items-center justify-between p-3 rounded-lg bg-cyber-magenta/10 border border-cyber-magenta/30">
          <div class="flex items-center gap-3 min-w-0">
            <CheckCircle2 class="w-5 h-5 text-cyber-green flex-shrink-0" />
            <div class="min-w-0">
              <p class="text-sm text-slate-700 truncate">{{ projectReqFile.name }}</p>
              <p class="text-xs text-cyber-gray">{{ fileSize(projectReqFile) }}</p>
            </div>
          </div>
          <button @click="projectReqFile = null" class="text-cyber-gray hover:text-cyber-red transition-colors flex-shrink-0">
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- 投标文件（单家公司） -->
      <div class="cyber-panel p-5">
        <div class="flex items-center gap-2 mb-4">
          <FileText class="w-5 h-5 text-cyber-green" />
          <h3 class="font-semibold text-cyber-green">投标文件</h3>
          <span class="text-cyber-red text-xs">*必填</span>
          <span class="text-cyber-gray text-xs ml-auto">仅限 1 家</span>
        </div>

        <input
          v-model="bidderName"
          type="text"
          placeholder="投标公司名称"
          class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:border-cyber-green outline-none text-sm mb-3"
        />

        <input ref="technicalInput" type="file" accept=".pdf,.doc,.docx" class="hidden" @change="onTechnicalChange" />
        <input ref="commercialInput" type="file" accept=".pdf,.doc,.docx" class="hidden" @change="onCommercialChange" />

        <div class="rounded-lg border border-slate-200 mb-2">
          <div v-if="!technicalFile" @click="technicalInput?.click()"
            class="p-3 text-center cursor-pointer hover:bg-cyber-cyan/5 transition-colors group">
            <Wrench class="w-5 h-5 mx-auto text-slate-300 group-hover:text-cyber-cyan transition-colors" />
            <p class="text-xs text-slate-400 group-hover:text-cyber-cyan mt-1">点击上传技术标（选填）</p>
          </div>
          <div v-else class="flex items-center justify-between p-2.5">
            <div class="flex items-center gap-2 min-w-0">
              <CheckCircle2 class="w-4 h-4 text-cyber-green flex-shrink-0" />
              <div class="min-w-0">
                <p class="text-xs text-slate-700 truncate">{{ technicalFile.name }}</p>
                <p class="text-xs text-slate-400">{{ fileSize(technicalFile) }}</p>
              </div>
            </div>
            <button @click="technicalFile = null" class="text-slate-400 hover:text-cyber-red flex-shrink-0">
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200">
          <div v-if="!commercialFile" @click="commercialInput?.click()"
            class="p-3 text-center cursor-pointer hover:bg-cyber-magenta/5 transition-colors group">
            <Briefcase class="w-5 h-5 mx-auto text-slate-300 group-hover:text-cyber-magenta transition-colors" />
            <p class="text-xs text-slate-400 group-hover:text-cyber-magenta mt-1">点击上传商务标（选填）</p>
          </div>
          <div v-else class="flex items-center justify-between p-2.5">
            <div class="flex items-center gap-2 min-w-0">
              <CheckCircle2 class="w-4 h-4 text-cyber-green flex-shrink-0" />
              <div class="min-w-0">
                <p class="text-xs text-slate-700 truncate">{{ commercialFile.name }}</p>
                <p class="text-xs text-slate-400">{{ fileSize(commercialFile) }}</p>
              </div>
            </div>
            <button @click="commercialFile = null" class="text-slate-400 hover:text-cyber-red flex-shrink-0">
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div v-if="!hasBidFile" class="flex items-center gap-2 mt-2">
          <FileWarning class="w-4 h-4 text-cyber-yellow flex-shrink-0" />
          <p class="text-xs text-cyber-yellow">技术标 / 商务标至少上传一个（只传一个视为综合文件）</p>
        </div>
      </div>
    </div>

    <!-- ========== 审核方式区 ========== -->
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <Sparkles class="w-4 h-4 text-purple-500" />
        <h3 class="font-semibold text-slate-700 text-sm">选择审核方式</h3>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- 本地检查 -->
        <button type="button" @click="auditMode = 'local'"
          class="text-left p-6 rounded-xl border-2 transition-all"
          :class="auditMode === 'local' ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-slate-200 bg-white hover:border-blue-300'">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-11 h-11 rounded-lg flex items-center justify-center"
              :class="auditMode === 'local' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'">
              <ShieldCheck class="w-6 h-6" />
            </div>
            <div>
              <p class="font-semibold text-slate-800 text-lg">本地检查</p>
              <p class="text-xs text-slate-400">规则引擎 · 离线快速</p>
            </div>
            <span v-if="auditMode === 'local'" class="ml-auto text-xs px-2 py-0.5 rounded bg-blue-500 text-white">已选择</span>
          </div>
          <ul class="text-xs text-slate-500 space-y-1.5">
            <li>✓ 基于关键词与规则匹配，数据全程本地处理</li>
            <li>✓ 检查速度快，不依赖外部网络</li>
            <li>✓ 覆盖签章、数据一致性、模板残留、完整性等维度</li>
          </ul>
        </button>

        <!-- LLM 检查 -->
        <button type="button" @click="auditMode = 'llm'"
          class="text-left p-6 rounded-xl border-2 transition-all"
          :class="auditMode === 'llm' ? 'border-purple-500 bg-purple-50 shadow-md' : 'border-slate-200 bg-white hover:border-purple-300'">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-11 h-11 rounded-lg flex items-center justify-center"
              :class="auditMode === 'llm' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-500'">
              <Bot class="w-6 h-6" />
            </div>
            <div>
              <p class="font-semibold text-slate-800 text-lg">LLM 智能检查</p>
              <p class="text-xs text-slate-400">AI 全流程深度分析</p>
            </div>
            <span v-if="auditMode === 'llm'" class="ml-auto text-xs px-2 py-0.5 rounded bg-purple-500 text-white">已选择</span>
          </div>
          <ul class="text-xs text-slate-500 space-y-1.5">
            <li>✓ AI 自动梳理审核要点，无需人工确认清单</li>
            <li>✓ 深度语义分析废标风险、扣分项与数据矛盾</li>
            <li>✓ 自动完整性对照、模拟打分、生成整改建议</li>
          </ul>
        </button>
      </div>

      <!-- LLM 紧凑配置：选中 LLM 时就地展开 -->
      <div v-if="auditMode === 'llm'" class="cyber-panel p-5 space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs text-slate-500 mb-1">LLM 服务商</label>
            <select v-model="llmProvider" @change="llmRiskConfirmed = false"
              class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:border-purple-500 outline-none text-sm">
              <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-slate-500 mb-1">API Key（本地模型无需填写）</label>
            <input v-model="llmApiKey" type="password" placeholder="sk-..." :disabled="!isExternalProvider"
              class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder-slate-400 focus:border-purple-500 outline-none text-sm disabled:bg-slate-100" />
          </div>
        </div>
        <div v-if="SIMULATE_SCORING_ENABLED" class="flex items-center gap-2 pt-1">
          <input id="simulate-scoring" type="checkbox" v-model="simulateScoring" class="w-4 h-4 accent-emerald-600" />
          <label for="simulate-scoring" class="text-sm text-slate-700 cursor-pointer select-none">
            模拟打分<span class="text-xs text-slate-400">（依据招标文件评分办法逐项对照投标文件打分并估算总分，结果展示在报告末章；默认启用）</span>
          </label>
        </div>
        <div v-if="isExternalProvider" class="p-3 rounded-lg bg-red-50 border border-red-200 space-y-2">
          <div class="flex items-start gap-2">
            <ShieldAlert class="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p class="text-xs text-red-700">采购与投标文件文本将发送至外部服务商，系统已对手机号、身份证号、银行账号等敏感信息脱敏，但公司名称、技术方案等仍会传输，请确认符合保密规定。</p>
          </div>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" v-model="llmRiskConfirmed" class="w-4 h-4 accent-red-600" />
            <span class="text-xs text-red-700 font-medium">我已阅读并确认上述风险</span>
          </label>
        </div>
        <div v-else class="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <ShieldCheck class="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p class="text-xs text-emerald-700">本地模型模式：数据不出内网。需提前部署 Ollama / vLLM 等兼容服务。</p>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
      {{ errorMsg }}
    </div>

    <!-- 底部单一主按钮：上传解析 → 自动审核 一次点击完成 -->
    <div class="flex justify-between items-center pt-4 border-t border-cyber-border">
      <div class="text-sm text-cyber-gray">
        <span v-if="filesReady" class="text-cyber-green">✓ 文件已就绪，选择审核方式后即可开始</span>
        <span v-else class="text-cyber-yellow">⚠ 请上传采购文件、填写投标公司名称，并至少上传一个投标文件</span>
      </div>
      <button
        :disabled="!canSubmit"
        @click="handleStart"
        :class="auditMode === 'llm' ? 'cyber-btn-purple' : 'cyber-btn-primary'"
        class="disabled:opacity-40 disabled:cursor-not-allowed min-w-[220px] justify-center"
      >
        <Loader2 v-if="submitting" class="w-4 h-4 inline animate-spin mr-1" />
        <Zap v-else-if="auditMode === 'local'" class="w-4 h-4 inline mr-1" />
        <Bot v-else class="w-4 h-4 inline mr-1" />
        <span v-if="submitting === 'uploading'">上传解析中...</span>
        <span v-else-if="submitting === 'starting'">正在启动审核...</span>
        <span v-else>{{ auditMode === "llm" ? "开始 LLM 智能检查" : "开始本地检查" }}</span>
      </button>
    </div>
  </div>
</template>

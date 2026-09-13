<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  Settings, Bot, ShieldAlert, ChevronDown, ChevronUp, Sliders, Loader2,
  Plus, Trash2, Sparkles, RefreshCw, Info, FileSearch, ShieldCheck
} from "lucide-vue-next";
import {
  runReview, getReviewItems, addCustomReviewItem, deleteCustomReviewItem,
  regenerateReviewItems, getLLMMode
} from "@/api";
import type { ReviewItem, ReviewItemSet, UnifiedReviewResult, ReviewMode } from "@/types";

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: "reviewed", result: UnifiedReviewResult): void;
  (e: "back"): void;
}>();

// ========== 审核模式选择 ==========
const reviewMode = ref<ReviewMode>("local");

// ========== 三层审查项 ==========
const reviewItemSet = ref<ReviewItemSet>({ common: [], project: [], custom: [] });
const loadingItems = ref(false);
const checkedIds = ref<Set<string>>(new Set());

// 匹配阈值（仅本地模式）
const threshold = ref(75);

// LLM 增强配置（本地模式下可选）
const llmEnabled = ref(false);
const llmProvider = ref("local");
const llmApiKey = ref("");
const llmScope = ref({
  clauseExtract: true,
  semanticMatch: true,
  deviation: true,
  evaluation: true,
});
const riskConfirmed = ref(false);
const showLlmPanel = ref(true);

// ========== LLM 审核模式配置 ==========
const llmReviewProvider = ref("qianwen");
const llmReviewApiKey = ref("");
const llmReviewRiskConfirmed = ref(false);

// ========== 通用状态 ==========
const reviewing = ref(false);
const errorMsg = ref("");

// 添加自定义审查项
const showAddCustom = ref(false);
const newCustomName = ref("");
const newCustomCategory = ref<"qualification" | "commitment" | "technical">("commitment");
const newCustomKeywords = ref("");
const addingCustom = ref(false);

// LLM 重新生成审查项（仅本地模式）
const llmMode = ref(false);
const regenerating = ref(false);
const showRegeneratePanel = ref(false);
const regenProvider = ref("qianwen");
const regenApiKey = ref("");
const regenRiskConfirmed = ref(false);
const regenMessage = ref("");

const providers = [
  { value: "local", label: "本地兼容模型（推荐·数据不出内网）" },
  { value: "qianwen", label: "通义千问（外部·已脱敏）" },
  { value: "openai", label: "OpenAI（外部·已脱敏）" },
  { value: "qianfan", label: "百度千帆（外部·已脱敏）" },
  { value: "glm", label: "智谱 GLM（外部·已脱敏）" },
];

const isExternalProvider = computed(() => llmProvider.value !== "local");
const isExternalReviewProvider = computed(() => llmReviewProvider.value !== "local");

const categoryLabel: Record<string, string> = {
  qualification: "报名资格",
  commitment: "承诺条款",
  technical: "技术偏离",
};

const categoryColor: Record<string, string> = {
  qualification: "text-cyber-cyan",
  commitment: "text-cyber-magenta",
  technical: "text-cyber-green",
};

// 已选数量
const checkedCount = computed(() => checkedIds.value.size);

// 本地模式可继续：已选审查项 > 0
const localCanProceed = computed(() => checkedCount.value > 0 && !reviewing.value);
// LLM 模式可继续：已确认风险（如外部）且非审核中
const llmCanProceed = computed(() => {
  if (reviewing.value) return false;
  if (isExternalReviewProvider.value && !llmReviewRiskConfirmed.value) return false;
  if (isExternalReviewProvider.value && !llmReviewApiKey.value.trim()) return false;
  return true;
});

const canProceed = computed(() =>
  reviewMode.value === "local" ? localCanProceed.value : llmCanProceed.value
);

// 按 category 分组
function groupByCategory(items: ReviewItem[]) {
  const groups: Record<string, ReviewItem[]> = { qualification: [], commitment: [], technical: [] };
  items.forEach((item) => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  });
  return groups;
}

const commonGroups = computed(() => groupByCategory(reviewItemSet.value.common));
const projectGroups = computed(() => groupByCategory(reviewItemSet.value.project));
const customGroups = computed(() => groupByCategory(reviewItemSet.value.custom));

// 所有审查项统计（用于 LLM 模式预览）
const allItemsCount = computed(() =>
  reviewItemSet.value.common.length + reviewItemSet.value.project.length + reviewItemSet.value.custom.length
);

function toggleItem(id: string) {
  if (checkedIds.value.has(id)) {
    checkedIds.value.delete(id);
  } else {
    checkedIds.value.add(id);
  }
}

function toggleGroup(items: ReviewItem[]) {
  const allChecked = items.every((i) => checkedIds.value.has(i.id));
  items.forEach((i) => {
    if (allChecked) checkedIds.value.delete(i.id);
    else checkedIds.value.add(i.id);
  });
}

// 加载审查项
async function loadReviewItems() {
  loadingItems.value = true;
  try {
    const set = await getReviewItems(props.sessionId);
    reviewItemSet.value = set;
    const ids = new Set<string>();
    set.common.forEach((i) => ids.add(i.id));
    set.custom.forEach((i) => ids.add(i.id));
    checkedIds.value = ids;

    try {
      const modeInfo = await getLLMMode(props.sessionId);
      llmMode.value = modeInfo.llmMode;
    } catch {
      // 忽略
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "加载审查项失败";
  } finally {
    loadingItems.value = false;
  }
}

// 使用 LLM 重新生成审查项（本地模式）
async function handleRegenerate() {
  if (regenProvider.value !== "local" && !regenApiKey.value.trim()) {
    errorMsg.value = "请填写 API Key";
    return;
  }
  if (regenProvider.value !== "local" && !regenRiskConfirmed.value) {
    errorMsg.value = "请先确认外部 LLM 数据安全风险";
    return;
  }
  regenerating.value = true;
  errorMsg.value = "";
  regenMessage.value = "";
  try {
    const { reviewItems: newSet, message } = await regenerateReviewItems(
      props.sessionId,
      { provider: regenProvider.value, apiKey: regenApiKey.value.trim() }
    );
    reviewItemSet.value = newSet;
    llmMode.value = true;
    regenMessage.value = message;
    const ids = new Set<string>();
    newSet.common.forEach((i) => ids.add(i.id));
    newSet.custom.forEach((i) => ids.add(i.id));
    newSet.project.forEach((i) => ids.add(i.id));
    checkedIds.value = ids;
    showRegeneratePanel.value = false;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "重新生成失败";
  } finally {
    regenerating.value = false;
  }
}

// 添加自定义审查项
async function handleAddCustom() {
  if (!newCustomName.value.trim()) return;
  addingCustom.value = true;
  try {
    const keywords = newCustomKeywords.value
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const set = await addCustomReviewItem(props.sessionId, {
      name: newCustomName.value.trim(),
      category: newCustomCategory.value,
      keywords: keywords.length > 0 ? keywords : [newCustomName.value.trim()],
      expectedText: newCustomName.value.trim(),
    });
    reviewItemSet.value = set;
    const newItem = set.custom[set.custom.length - 1];
    if (newItem) checkedIds.value.add(newItem.id);
    newCustomName.value = "";
    newCustomKeywords.value = "";
    showAddCustom.value = false;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "添加失败";
  } finally {
    addingCustom.value = false;
  }
}

// 删除自定义审查项
async function handleDeleteCustom(itemId: string) {
  try {
    const set = await deleteCustomReviewItem(props.sessionId, itemId);
    reviewItemSet.value = set;
    checkedIds.value.delete(itemId);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "删除失败";
  }
}

// 执行审查
async function handleReview() {
  if (!canProceed.value) return;

  if (reviewMode.value === "local") {
    // 本地模式
    if (llmEnabled.value && isExternalProvider.value && !riskConfirmed.value) {
      errorMsg.value = "使用外部 LLM 服务前，请先阅读并确认数据安全风险提示";
      return;
    }
  }

  reviewing.value = true;
  errorMsg.value = "";

  try {
    const selectedItems = Array.from(checkedIds.value);

    if (reviewMode.value === "local") {
      // 本地审核（规则引擎，可选 LLM 增强）
      const result = await runReview(props.sessionId, {
        items: selectedItems,
        threshold: threshold.value,
        mode: "local",
        ...(llmEnabled.value
          ? {
              llm: {
                enabled: true,
                provider: llmProvider.value,
                apiKey: llmApiKey.value,
                scope: Object.keys(llmScope.value).filter((k) =>
                  llmScope.value[k as keyof typeof llmScope.value]
                ),
              },
            }
          : {}),
      });
      emit("reviewed", result);
    } else {
      // LLM 审核（AI 全流程独立审核）
      const result = await runReview(props.sessionId, {
        items: selectedItems,
        threshold: threshold.value,
        mode: "llm",
        llm: {
          enabled: true,
          provider: llmReviewProvider.value,
          apiKey: llmReviewApiKey.value,
          scope: ["clauseExtract", "semanticMatch", "deviation", "evaluation"],
        },
      });
      emit("reviewed", result);
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "审查失败";
  } finally {
    reviewing.value = false;
  }
}

onMounted(() => {
  loadReviewItems();
});
</script>

<template>
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div class="flex items-center gap-3">
      <div class="w-1 h-8 bg-cyber-magenta shadow-magenta-glow"></div>
      <h2 class="text-2xl font-bold neon-text-magenta">审查配置</h2>
      <span class="text-cyber-gray text-sm">[步骤 2/4]</span>
    </div>

    <!-- 审核模式选择 -->
    <div class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <Settings class="w-5 h-5 text-cyber-cyan" />
        <h3 class="font-semibold text-slate-700">选择审核模式</h3>
      </div>
      <p class="text-slate-500 text-sm mb-4">
        系统提供两种独立审核模式，可根据需求选择。本地审核全程离线、基于规则引擎；LLM 审核由 AI 智能完成全流程分析。
      </p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- 本地审核 -->
        <button
          @click="reviewMode = 'local'"
          class="text-left p-5 rounded-xl border-2 transition-all"
          :class="reviewMode === 'local'
            ? 'border-blue-500 bg-blue-50 shadow-md'
            : 'border-slate-200 bg-white hover:border-blue-300'"
        >
          <div class="flex items-center gap-3 mb-2">
            <div
              class="w-10 h-10 rounded-lg flex items-center justify-center"
              :class="reviewMode === 'local' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500'"
            >
              <ShieldCheck class="w-5 h-5" />
            </div>
            <div>
              <p class="font-semibold text-slate-800">本地审核</p>
              <p class="text-xs text-slate-400">规则引擎 · 离线运行</p>
            </div>
            <span
              v-if="reviewMode === 'local'"
              class="ml-auto text-xs px-2 py-0.5 rounded bg-blue-500 text-white"
            >已选择</span>
          </div>
          <ul class="text-xs text-slate-500 space-y-1 mt-3">
            <li>✓ 基于关键词与规则匹配，数据全程本地处理</li>
            <li>✓ 不依赖外部 API，无网络连接需求</li>
            <li>✓ 可选启用 LLM 增强提升审查精度</li>
            <li>✓ 分析算法与重构前保持一致</li>
          </ul>
        </button>

        <!-- LLM 审核 -->
        <button
          @click="reviewMode = 'llm'"
          class="text-left p-5 rounded-xl border-2 transition-all"
          :class="reviewMode === 'llm'
            ? 'border-purple-500 bg-purple-50 shadow-md'
            : 'border-slate-200 bg-white hover:border-purple-300'"
        >
          <div class="flex items-center gap-3 mb-2">
            <div
              class="w-10 h-10 rounded-lg flex items-center justify-center"
              :class="reviewMode === 'llm' ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-500'"
            >
              <Bot class="w-5 h-5" />
            </div>
            <div>
              <p class="font-semibold text-slate-800">LLM 智能审核</p>
              <p class="text-xs text-slate-400">AI 全流程分析</p>
            </div>
            <span
              v-if="reviewMode === 'llm'"
              class="ml-auto text-xs px-2 py-0.5 rounded bg-purple-500 text-white"
            >已选择</span>
          </div>
          <ul class="text-xs text-slate-500 space-y-1 mt-3">
            <li>✓ AI 智能梳理审核项、废标项、评分项</li>
            <li>✓ 深度语义分析，识别废标与偏离</li>
            <li>✓ 自动模拟打分，生成客观评分建议</li>
            <li>✓ 完整分析过程日志，结果可追溯</li>
          </ul>
        </button>
      </div>
    </div>

    <!-- ========== 本地审核模式配置 ========== -->
    <template v-if="reviewMode === 'local'">
      <!-- 审查项配置 -->
      <div class="cyber-panel p-6 space-y-6">
        <div class="flex items-center gap-2">
          <Settings class="w-5 h-5 text-cyber-cyan" />
          <h3 class="font-semibold text-slate-700">审查项配置</h3>
          <span class="text-cyber-gray text-xs ml-auto">已选 {{ checkedCount }} 项</span>
        </div>

        <div v-if="loadingItems" class="flex items-center justify-center py-8 text-slate-400">
          <Loader2 class="w-5 h-5 animate-spin mr-2" />
          加载审查项中...
        </div>

        <template v-else>
          <!-- 通用审查项 -->
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-blue-600">通用审查项</span>
              <span class="text-xs text-slate-400">（适用于所有招标项目）</span>
            </div>

            <div v-for="cat in ['qualification', 'commitment', 'technical']" :key="cat" class="space-y-2 pl-2">
              <div v-if="commonGroups[cat].length > 0" class="flex items-center gap-3">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="commonGroups[cat].every((i) => checkedIds.has(i.id))"
                    @change="toggleGroup(commonGroups[cat])"
                    class="w-4 h-4 accent-cyber-cyan"
                  />
                  <span class="font-semibold text-sm" :class="categoryColor[cat]">
                    {{ categoryLabel[cat] }}
                  </span>
                </label>
              </div>
              <div v-if="commonGroups[cat].length > 0" class="grid grid-cols-2 md:grid-cols-4 gap-3 pl-6">
                <label
                  v-for="item in commonGroups[cat]"
                  :key="item.id"
                  class="flex items-center gap-2 p-3 rounded-lg border border-slate-200 cursor-pointer hover:border-cyber-cyan/50 transition-colors"
                  :class="{ 'bg-blue-50 border-cyber-cyan/40': checkedIds.has(item.id) }"
                >
                  <input
                    type="checkbox"
                    :checked="checkedIds.has(item.id)"
                    @change="toggleItem(item.id)"
                    class="w-4 h-4 accent-cyber-cyan"
                  />
                  <span class="text-sm text-slate-600">{{ item.name }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- 项目特有审查项 -->
          <div v-if="reviewItemSet.project.length > 0 || !llmMode" class="space-y-3 border-t border-slate-100 pt-4">
            <div class="flex items-center gap-2 flex-wrap">
              <Sparkles class="w-4 h-4 text-amber-500" />
              <span class="text-sm font-semibold text-amber-600">本项目特有审查项</span>
              <span class="text-xs text-slate-400">（从采购文件自动提取，共 {{ reviewItemSet.project.length }} 项，请确认勾选）</span>
              <button
                v-if="!llmMode"
                @click="showRegeneratePanel = !showRegeneratePanel"
                class="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-300 text-amber-600 hover:bg-amber-50 transition-colors"
              >
                <RefreshCw class="w-3 h-3" />
                使用 AI 重新生成
              </button>
              <span
                v-else
                class="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded bg-purple-50 border border-purple-300 text-purple-600"
              >
                <Bot class="w-3 h-3" />
                AI 模式已启用
              </span>
            </div>

            <!-- LLM 模式提示 -->
            <div v-if="llmMode" class="flex items-start gap-2 p-3 rounded-lg bg-purple-50 border border-purple-200">
              <Info class="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
              <p class="text-xs text-purple-700">
                审查项已由 AI 重新生成。后续所有扫描检查操作（规则匹配、结果分析等）将统一使用 LLM 进行处理，确保检查逻辑的一致性。
              </p>
            </div>

            <!-- 重新生成面板 -->
            <div v-if="showRegeneratePanel && !llmMode" class="p-4 rounded-lg bg-amber-50/50 border border-amber-200 space-y-3">
              <div class="flex items-center gap-2">
                <Bot class="w-4 h-4 text-amber-600" />
                <span class="text-sm font-semibold text-amber-700">使用 LLM 重新生成审查项</span>
              </div>
              <p class="text-xs text-slate-500">系统将使用大模型分析采购文件并重新生成项目特有审查项。启用后，后续所有审查操作将统一使用 LLM。</p>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-slate-500 mb-1">LLM 服务商</label>
                  <select
                    v-model="regenProvider"
                    class="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:border-amber-400 outline-none"
                  >
                    <option value="qianwen">通义千问（外部·已脱敏）</option>
                    <option value="openai">OpenAI（外部·已脱敏）</option>
                    <option value="qianfan">百度千帆（外部·已脱敏）</option>
                    <option value="glm">智谱 GLM（外部·已脱敏）</option>
                    <option value="local">本地兼容模型（数据不出内网）</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs text-slate-500 mb-1">API Key（本地模型无需填写）</label>
                  <input
                    v-model="regenApiKey"
                    type="password"
                    placeholder="sk-..."
                    :disabled="regenProvider === 'local'"
                    class="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:border-amber-400 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>

              <!-- 风险提示 -->
              <div v-if="regenProvider !== 'local'" class="p-3 rounded-lg bg-red-50 border border-red-200">
                <div class="flex items-start gap-3">
                  <ShieldAlert class="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div class="text-xs text-red-700 space-y-1">
                    <p class="font-semibold">数据安全风险提示</p>
                    <p>采购文件内容将发送至外部 LLM 服务商处理，系统已自动对手机号、身份证号等敏感信息脱敏，但公司名称、技术方案等无法自动脱敏的内容仍会被传输。</p>
                  </div>
                </div>
                <label class="flex items-center gap-2 cursor-pointer mt-2">
                  <input type="checkbox" v-model="regenRiskConfirmed" class="w-4 h-4 accent-red-600" />
                  <span class="text-xs text-red-700 font-medium">我已阅读并确认上述风险</span>
                </label>
              </div>

              <div class="flex gap-2">
                <button
                  @click="handleRegenerate"
                  :disabled="regenerating || (regenProvider !== 'local' && !regenApiKey.trim())"
                  class="px-4 py-2 rounded bg-amber-500 text-white text-sm hover:bg-amber-600 disabled:opacity-40"
                >
                  <Loader2 v-if="regenerating" class="w-4 h-4 inline animate-spin mr-1" />
                  {{ regenerating ? "AI 生成中..." : "开始生成" }}
                </button>
                <button
                  @click="showRegeneratePanel = false"
                  class="px-4 py-2 rounded border border-slate-200 text-slate-500 text-sm hover:bg-slate-50"
                >
                  取消
                </button>
              </div>
            </div>

            <div v-for="cat in ['qualification', 'commitment', 'technical']" :key="'p-' + cat" class="space-y-2 pl-2">
              <div v-if="projectGroups[cat].length > 0" class="flex items-center gap-3">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="projectGroups[cat].every((i) => checkedIds.has(i.id))"
                    @change="toggleGroup(projectGroups[cat])"
                    class="w-4 h-4 accent-amber-500"
                  />
                  <span class="font-semibold text-sm" :class="categoryColor[cat]">
                    {{ categoryLabel[cat] }}
                  </span>
                </label>
              </div>
              <div v-if="projectGroups[cat].length > 0" class="grid grid-cols-2 md:grid-cols-3 gap-3 pl-6">
                <label
                  v-for="item in projectGroups[cat]"
                  :key="item.id"
                  class="flex items-center gap-2 p-3 rounded-lg border border-slate-200 cursor-pointer hover:border-amber-400/50 transition-colors"
                  :class="{ 'bg-amber-50 border-amber-400/40': checkedIds.has(item.id) }"
                >
                  <input
                    type="checkbox"
                    :checked="checkedIds.has(item.id)"
                    @change="toggleItem(item.id)"
                    class="w-4 h-4 accent-amber-500"
                  />
                  <span class="text-sm text-slate-600">{{ item.name }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- 用户自定义审查项 -->
          <div class="space-y-3 border-t border-slate-100 pt-4">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-emerald-600">用户自定义审查项</span>
              <span class="text-xs text-slate-400">（本次会话有效）</span>
              <button
                @click="showAddCustom = !showAddCustom"
                class="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition-colors"
              >
                <Plus class="w-3 h-3" />
                添加
              </button>
            </div>

            <div v-if="showAddCustom" class="p-4 rounded-lg bg-emerald-50/50 border border-emerald-200 space-y-3 pl-6">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label class="block text-xs text-slate-500 mb-1">审查项名称 *</label>
                  <input
                    v-model="newCustomName"
                    placeholder="如：驻场人员资质要求"
                    class="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:border-emerald-400 outline-none"
                  />
                </div>
                <div>
                  <label class="block text-xs text-slate-500 mb-1">类别</label>
                  <select
                    v-model="newCustomCategory"
                    class="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:border-emerald-400 outline-none"
                  >
                    <option value="qualification">报名资格</option>
                    <option value="commitment">承诺条款</option>
                    <option value="technical">技术偏离</option>
                  </select>
                </div>
                <div>
                  <label class="block text-xs text-slate-500 mb-1">关键词（逗号分隔，可选）</label>
                  <input
                    v-model="newCustomKeywords"
                    placeholder="如：资质,证书"
                    class="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm focus:border-emerald-400 outline-none"
                  />
                </div>
              </div>
              <div class="flex gap-2">
                <button
                  @click="handleAddCustom"
                  :disabled="!newCustomName.trim() || addingCustom"
                  class="px-4 py-2 rounded bg-emerald-500 text-white text-sm hover:bg-emerald-600 disabled:opacity-40"
                >
                  <Loader2 v-if="addingCustom" class="w-4 h-4 inline animate-spin mr-1" />
                  确认添加
                </button>
                <button
                  @click="showAddCustom = false; newCustomName = ''; newCustomKeywords = ''"
                  class="px-4 py-2 rounded border border-slate-200 text-slate-500 text-sm hover:bg-slate-50"
                >
                  取消
                </button>
              </div>
            </div>

            <div v-if="reviewItemSet.custom.length === 0" class="text-xs text-slate-400 pl-6">
              暂无自定义审查项，点击"添加"按钮创建
            </div>
            <div v-for="cat in ['qualification', 'commitment', 'technical']" :key="'c-' + cat" class="space-y-2 pl-2">
              <div v-if="customGroups[cat].length > 0" class="flex items-center gap-3">
                <span class="font-semibold text-sm" :class="categoryColor[cat]">
                  {{ categoryLabel[cat] }}
                </span>
              </div>
              <div v-if="customGroups[cat].length > 0" class="grid grid-cols-2 md:grid-cols-3 gap-3 pl-6">
                <div
                  v-for="item in customGroups[cat]"
                  :key="item.id"
                  class="flex items-center gap-2 p-3 rounded-lg border border-slate-200"
                  :class="{ 'bg-emerald-50 border-emerald-400/40': checkedIds.has(item.id) }"
                >
                  <label class="flex items-center gap-2 flex-1 cursor-pointer">
                    <input
                      type="checkbox"
                      :checked="checkedIds.has(item.id)"
                      @change="toggleItem(item.id)"
                      class="w-4 h-4 accent-emerald-500"
                    />
                    <span class="text-sm text-slate-600">{{ item.name }}</span>
                  </label>
                  <button
                    @click="handleDeleteCustom(item.id)"
                    class="text-slate-400 hover:text-red-500 transition-colors"
                    title="删除"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 匹配阈值 -->
      <div class="cyber-panel p-6">
        <div class="flex items-center gap-2 mb-4">
          <Sliders class="w-5 h-5 text-cyber-green" />
          <h3 class="font-semibold text-slate-700">匹配阈值</h3>
        </div>
        <div class="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="100"
            v-model="threshold"
            class="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-cyber-green"
          />
          <span class="text-2xl font-bold neon-text-green w-16 text-right">{{ threshold }}%</span>
        </div>
        <p class="text-xs text-slate-500 mt-2">综合匹配度达到此阈值判定为"符合"，默认 75%</p>
      </div>

      <!-- LLM 增强配置（本地模式可选） -->
      <div class="cyber-panel overflow-hidden">
        <button
          @click="showLlmPanel = !showLlmPanel"
          class="w-full flex items-center gap-2 p-6 text-left"
        >
          <Bot class="w-5 h-5 text-cyber-magenta" />
          <h3 class="font-semibold text-slate-700">AI 增强（可选）</h3>
          <span v-if="llmMode" class="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-300">
            AI 模式已锁定
          </span>
          <span v-else class="text-xs px-2 py-0.5 rounded bg-cyber-magenta/20 text-cyber-magenta border border-cyber-magenta/40">
            {{ llmEnabled ? '已启用' : '默认关闭' }}
          </span>
          <component :is="showLlmPanel ? ChevronUp : ChevronDown" class="w-5 h-5 text-slate-400 ml-auto" />
        </button>

        <div v-show="showLlmPanel" class="px-6 pb-6 space-y-4 border-t border-slate-200 pt-4">
          <div v-if="llmMode" class="flex items-start gap-3 p-3 rounded-lg bg-purple-50 border border-purple-200">
            <Info class="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
            <div class="text-xs text-purple-700 space-y-1">
              <p class="font-semibold">AI 模式已启用</p>
              <p>您已通过 AI 重新生成审查项，后续所有审查操作将统一使用 LLM 处理，无需再次手动配置。</p>
              <p v-if="regenMessage" class="text-purple-600">{{ regenMessage }}</p>
            </div>
          </div>

          <template v-else>
          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              v-model="llmEnabled"
              class="w-5 h-5 accent-cyber-magenta"
            />
            <span class="font-mono text-cyber-magenta font-semibold">启用 LLM 增强</span>
          </label>

          <div v-if="llmEnabled" class="space-y-4 pl-7">
            <div v-if="isExternalProvider" class="p-4 rounded-lg bg-red-50 border border-red-200 space-y-2">
              <div class="flex items-start gap-3">
                <ShieldAlert class="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div class="text-xs text-red-700 space-y-1">
                  <p class="font-semibold">⚠ 数据安全风险提示</p>
                  <p>1. 开启后，投标文件文本内容将发送至第三方 LLM 服务商进行处理；</p>
                  <p>2. 系统已自动对手机号、身份证号、银行账号、金额、证书编号等敏感信息进行脱敏；</p>
                  <p>3. 但公司名称、技术方案、报价策略等无法自动脱敏的内容仍会被传输；</p>
                  <p>4. 请确保该操作符合贵单位保密规定，建议优先使用本地兼容模型。</p>
                </div>
              </div>
              <label class="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  v-model="riskConfirmed"
                  class="w-4 h-4 accent-red-600"
                />
                <span class="text-xs text-red-700 font-medium">我已阅读并确认上述风险，同意将脱敏后的文本发送至外部 LLM 服务</span>
              </label>
            </div>

            <div v-else class="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <ShieldAlert class="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <p class="text-xs text-emerald-700">
                ✓ 本地模型模式：数据不出内网，无泄密风险。需提前在本地部署 Ollama / vLLM 等兼容服务。
              </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-slate-500 mb-2">服务商</label>
                <select
                  v-model="llmProvider"
                  @change="riskConfirmed = false"
                  class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:border-cyber-magenta outline-none"
                >
                  <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm text-slate-500 mb-2">API Key（本地模型无需填写）</label>
                <input
                  type="password"
                  v-model="llmApiKey"
                  placeholder="sk-..."
                  :disabled="!isExternalProvider"
                  class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder-slate-400 focus:border-cyber-magenta outline-none disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>
            </div>

            <div>
              <label class="block text-sm text-slate-500 mb-2">增强范围</label>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label class="flex items-center gap-2 p-2 rounded border border-slate-200 cursor-pointer">
                  <input type="checkbox" v-model="llmScope.clauseExtract" class="accent-cyber-magenta" />
                  <span class="text-sm text-slate-600">条款抽取</span>
                </label>
                <label class="flex items-center gap-2 p-2 rounded border border-slate-200 cursor-pointer">
                  <input type="checkbox" v-model="llmScope.semanticMatch" class="accent-cyber-magenta" />
                  <span class="text-sm text-slate-600">语义比对</span>
                </label>
                <label class="flex items-center gap-2 p-2 rounded border border-slate-200 cursor-pointer">
                  <input type="checkbox" v-model="llmScope.deviation" class="accent-cyber-magenta" />
                  <span class="text-sm text-slate-600">偏离总结</span>
                </label>
                <label class="flex items-center gap-2 p-2 rounded border border-slate-200 cursor-pointer">
                  <input type="checkbox" v-model="llmScope.evaluation" class="accent-cyber-magenta" />
                  <span class="text-sm text-slate-600">专业评价</span>
                </label>
              </div>
            </div>
          </div>
          </template>
        </div>
      </div>
    </template>

    <!-- ========== LLM 审核模式配置 ========== -->
    <template v-else>
      <!-- LLM 审核配置 -->
      <div class="cyber-panel p-6 space-y-5">
        <div class="flex items-center gap-2">
          <Bot class="w-5 h-5 text-purple-600" />
          <h3 class="font-semibold text-slate-700">LLM 智能审核配置</h3>
          <span class="ml-auto text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-300">
            AI 全流程审核
          </span>
        </div>

        <div class="p-4 rounded-lg bg-purple-50 border border-purple-200">
          <div class="flex items-start gap-3">
            <Info class="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
            <div class="text-xs text-purple-800 space-y-1">
              <p class="font-semibold">LLM 智能审核流程</p>
              <p>1. AI 从采购文件中智能梳理审查项、废标项和评分项；</p>
              <p>2. 逐投标人进行符合性判定、废标项识别和模拟打分；</p>
              <p>3. 生成包含分析过程的完整审核报告。</p>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-slate-500 mb-2">LLM 服务商</label>
            <select
              v-model="llmReviewProvider"
              @change="llmReviewRiskConfirmed = false"
              class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:border-purple-500 outline-none"
            >
              <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-slate-500 mb-2">API Key（本地模型无需填写）</label>
            <input
              type="password"
              v-model="llmReviewApiKey"
              placeholder="sk-..."
              :disabled="!isExternalReviewProvider"
              class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 placeholder-slate-400 focus:border-purple-500 outline-none disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>
        </div>

        <!-- 风险提示：外部模型 -->
        <div v-if="isExternalReviewProvider" class="p-4 rounded-lg bg-red-50 border border-red-200 space-y-2">
          <div class="flex items-start gap-3">
            <ShieldAlert class="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div class="text-xs text-red-700 space-y-1">
              <p class="font-semibold">⚠ 数据安全风险提示</p>
              <p>1. LLM 审核将把采购文件和投标文件的文本内容发送至第三方 LLM 服务商；</p>
              <p>2. 系统已自动对手机号、身份证号、银行账号、金额、证书编号等敏感信息脱敏；</p>
              <p>3. 但公司名称、技术方案、报价策略等无法自动脱敏的内容仍会被传输；</p>
              <p>4. 请确保该操作符合贵单位保密规定，建议优先使用本地兼容模型。</p>
            </div>
          </div>
          <label class="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              v-model="llmReviewRiskConfirmed"
              class="w-4 h-4 accent-red-600"
            />
            <span class="text-xs text-red-700 font-medium">我已阅读并确认上述风险，同意将脱敏后的文本发送至外部 LLM 服务</span>
          </label>
        </div>

        <!-- 安全提示：本地模型 -->
        <div v-else class="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <ShieldAlert class="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p class="text-xs text-emerald-700">
            ✓ 本地模型模式：数据不出内网，无泄密风险。需提前在本地部署 Ollama / vLLM 等兼容服务。
          </p>
        </div>

        <!-- 审查项预览 -->
        <div class="border-t border-slate-100 pt-4">
          <div class="flex items-center gap-2 mb-3">
            <FileSearch class="w-4 h-4 text-slate-500" />
            <span class="text-sm font-semibold text-slate-600">当前审查项预览</span>
            <span class="text-xs text-slate-400">（LLM 审核将重新智能梳理，以下仅供参考）</span>
          </div>
          <div v-if="loadingItems" class="flex items-center justify-center py-4 text-slate-400 text-sm">
            <Loader2 class="w-4 h-4 animate-spin mr-2" />
            加载中...
          </div>
          <div v-else class="grid grid-cols-3 gap-3 text-center">
            <div class="p-3 rounded-lg bg-blue-50 border border-blue-200">
              <p class="text-2xl font-bold text-blue-600">{{ reviewItemSet.common.length }}</p>
              <p class="text-xs text-slate-500 mt-1">通用审查项</p>
            </div>
            <div class="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p class="text-2xl font-bold text-amber-600">{{ reviewItemSet.project.length }}</p>
              <p class="text-xs text-slate-500 mt-1">项目特有审查项</p>
            </div>
            <div class="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <p class="text-2xl font-bold text-emerald-600">{{ reviewItemSet.custom.length }}</p>
              <p class="text-xs text-slate-500 mt-1">自定义审查项</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
      {{ errorMsg }}
    </div>

    <!-- 底部操作 -->
    <div class="flex justify-between items-center pt-4 border-t border-cyber-border">
      <button @click="emit('back')" class="cyber-btn text-slate-500 border-slate-200 hover:text-slate-700">
        ← 上一步
      </button>
      <button
        :disabled="!canProceed"
        @click="handleReview"
        :class="reviewMode === 'llm' ? 'cyber-btn-purple' : 'cyber-btn-magenta'"
        class="disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Loader2 v-if="reviewing" class="w-4 h-4 inline animate-spin mr-1" />
        <span v-if="reviewing">审查中...</span>
        <span v-else-if="reviewMode === 'llm'">开始 AI 审核 →</span>
        <span v-else>开始审查 →</span>
      </button>
    </div>
  </div>
</template>

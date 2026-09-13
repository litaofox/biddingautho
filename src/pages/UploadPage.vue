<script setup lang="ts">
import { ref, computed } from "vue";
import { Upload, FileText, X, Plus, CheckCircle2, FileWarning, Wrench, Briefcase, Loader2 } from "lucide-vue-next";
import { uploadFiles } from "@/api";
import type { BidderForm } from "@/types";

const emit = defineEmits<{
  (e: "uploaded", sessionId: string): void;
}>();

const procurementFile = ref<File | null>(null);
const projectReqFile = ref<File | null>(null);
const bidders = ref<BidderForm[]>([]);

const maxBidders = 5;
let bidderIdCounter = 0;
const uploading = ref(false);

// 触发文件选择
const procurementInput = ref<HTMLInputElement | null>(null);
const projectReqInput = ref<HTMLInputElement | null>(null);
const technicalInputs = ref<Record<number, HTMLInputElement | null>>({});
const commercialInputs = ref<Record<number, HTMLInputElement | null>>({});

function onProcurementChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) procurementFile.value = file;
}
function onProjectReqChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) projectReqFile.value = file;
}
function onTechnicalChange(e: Event, bidder: BidderForm) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) bidder.technical = file;
}
function onCommercialChange(e: Event, bidder: BidderForm) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) bidder.commercial = file;
}

function addBidder() {
  if (bidders.value.length >= maxBidders) return;
  bidderIdCounter++;
  bidders.value.push({
    id: bidderIdCounter,
    name: "",
    technical: null,
    commercial: null,
  });
}

function removeBidder(id: number) {
  bidders.value = bidders.value.filter((b) => b.id !== id);
}

function hasFile(bidder: BidderForm): boolean {
  return bidder.technical !== null || bidder.commercial !== null;
}

function getUploadMode(bidder: BidderForm): string {
  if (bidder.technical && bidder.commercial) return "技术标 + 商务标（分开）";
  if (bidder.technical) return "综合（技术标）";
  if (bidder.commercial) return "综合（商务标）";
  return "未上传";
}

const allBiddersReady = computed(() =>
  bidders.value.length >= 1 && bidders.value.every(hasFile)
);

const canProceed = computed(() =>
  procurementFile.value !== null && allBiddersReady.value
);

const errorMsg = ref("");

async function handleSubmit() {
  if (!canProceed.value || uploading.value) return;
  uploading.value = true;
  errorMsg.value = "";

  try {
    // 构造 API 入参
    const bidderData = bidders.value
      .filter(hasFile)
      .map((b) => ({
        name: b.name || "未命名公司",
        files: [
          ...(b.technical ? [{ file: b.technical, type: "technical" as const }] : []),
          ...(b.commercial ? [{ file: b.commercial, type: "commercial" as const }] : []),
        ],
      }));

    const res = await uploadFiles({
      procurement: procurementFile.value!,
      projectReq: projectReqFile.value || undefined,
      bidders: bidderData,
    });

    emit("uploaded", res.sessionId);
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div class="flex items-center gap-3">
      <div class="w-1 h-8 bg-cyber-cyan shadow-cyan-glow"></div>
      <h2 class="text-2xl font-bold neon-text-cyan">文件上传</h2>
      <span class="text-cyber-gray text-sm">[步骤 1/4]</span>
    </div>

    <p class="text-cyber-gray text-sm">上传采购文件、项目需求及各投标公司的投标文件（支持 .doc / .docx 格式）</p>

    <!-- 三栏上传区 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- 采购文件 -->
      <div class="cyber-panel p-5">
        <div class="flex items-center gap-2 mb-4">
          <FileText class="w-5 h-5 text-cyber-cyan" />
          <h3 class="font-semibold text-cyber-cyan">采购文件</h3>
          <span class="text-cyber-red text-xs">*必填</span>
        </div>

        <input ref="procurementInput" type="file" accept=".doc,.docx" class="hidden" @change="onProcurementChange" />

        <div
          v-if="!procurementFile"
          @click="procurementInput?.click()"
          class="border-2 border-dashed border-cyber-border rounded-lg p-8 text-center cursor-pointer hover:border-cyber-cyan/50 transition-colors group"
        >
          <Upload class="w-10 h-10 mx-auto text-cyber-gray group-hover:text-cyber-cyan transition-colors mb-3" />
          <p class="text-sm text-cyber-gray group-hover:text-cyber-cyan transition-colors">点击或拖拽上传</p>
          <p class="text-xs text-cyber-gray/60 mt-1">.doc / .docx，≤ 50MB</p>
        </div>

        <div v-else class="flex items-center justify-between p-3 rounded-lg bg-cyber-cyan/10 border border-cyber-cyan/30">
          <div class="flex items-center gap-3 min-w-0">
            <CheckCircle2 class="w-5 h-5 text-cyber-green flex-shrink-0" />
            <div class="min-w-0">
              <p class="text-sm text-slate-700 truncate">{{ procurementFile.name }}</p>
              <p class="text-xs text-cyber-gray">{{ (procurementFile.size / 1024 / 1024).toFixed(1) }} MB</p>
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

        <input ref="projectReqInput" type="file" accept=".doc,.docx,.txt" class="hidden" @change="onProjectReqChange" />

        <div
          v-if="!projectReqFile"
          @click="projectReqInput?.click()"
          class="border-2 border-dashed border-cyber-border rounded-lg p-8 text-center cursor-pointer hover:border-cyber-magenta/50 transition-colors group"
        >
          <Upload class="w-10 h-10 mx-auto text-cyber-gray group-hover:text-cyber-magenta transition-colors mb-3" />
          <p class="text-sm text-cyber-gray group-hover:text-cyber-magenta transition-colors">点击或拖拽上传</p>
          <p class="text-xs text-cyber-gray/60 mt-1">.doc / .docx 或文本</p>
        </div>

        <div v-else class="flex items-center justify-between p-3 rounded-lg bg-cyber-magenta/10 border border-cyber-magenta/30">
          <div class="flex items-center gap-3 min-w-0">
            <CheckCircle2 class="w-5 h-5 text-cyber-green flex-shrink-0" />
            <div class="min-w-0">
              <p class="text-sm text-slate-700 truncate">{{ projectReqFile.name }}</p>
              <p class="text-xs text-cyber-gray">{{ (projectReqFile.size / 1024 / 1024).toFixed(1) }} MB</p>
            </div>
          </div>
          <button @click="projectReqFile = null" class="text-cyber-gray hover:text-cyber-red transition-colors flex-shrink-0">
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- 投标文件 -->
      <div class="cyber-panel p-5">
        <div class="flex items-center gap-2 mb-4">
          <FileText class="w-5 h-5 text-cyber-green" />
          <h3 class="font-semibold text-cyber-green">投标文件</h3>
          <span class="text-cyber-red text-xs">*必填</span>
          <span class="text-cyber-gray text-xs ml-auto">{{ bidders.length }}/{{ maxBidders }} 家</span>
        </div>

        <div
          v-if="bidders.length < maxBidders"
          @click="addBidder"
          class="border-2 border-dashed border-cyber-border rounded-lg p-4 text-center cursor-pointer hover:border-cyber-green/50 transition-colors group mb-3"
        >
          <Plus class="w-7 h-7 mx-auto text-cyber-gray group-hover:text-cyber-green transition-colors mb-1" />
          <p class="text-sm text-cyber-gray group-hover:text-cyber-green transition-colors">添加投标公司</p>
        </div>

        <div v-if="bidders.length === 0" class="flex items-center gap-2 p-3 rounded-lg bg-cyber-yellow/10 border border-cyber-yellow/30">
          <FileWarning class="w-4 h-4 text-cyber-yellow flex-shrink-0" />
          <p class="text-xs text-cyber-yellow">至少添加 1 家投标公司并上传文件</p>
        </div>
      </div>
    </div>

    <!-- 投标公司列表 -->
    <div v-if="bidders.length > 0" class="space-y-4">
      <div
        v-for="(bidder, index) in bidders"
        :key="bidder.id"
        class="cyber-panel p-5"
      >
        <div class="flex items-center gap-3 mb-4">
          <span class="w-7 h-7 rounded-full bg-cyber-green/15 text-cyber-green text-sm flex items-center justify-center font-bold flex-shrink-0">
            {{ index + 1 }}
          </span>
          <input
            v-model="bidder.name"
            type="text"
            placeholder="请输入投标公司名称"
            class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:border-cyber-green outline-none text-sm"
          />
          <button
            @click="removeBidder(bidder.id)"
            class="text-slate-400 hover:text-cyber-red transition-colors p-1"
            title="移除该公司"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <!-- 技术标 -->
          <div class="rounded-lg border border-slate-200 overflow-hidden">
            <input
              :ref="(el) => { technicalInputs[bidder.id] = el as HTMLInputElement }"
              type="file"
              accept=".doc,.docx"
              class="hidden"
              @change="(e) => onTechnicalChange(e, bidder)"
            />
            <div class="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
              <Wrench class="w-4 h-4 text-cyber-cyan" />
              <span class="text-sm font-medium text-slate-600">技术标</span>
            </div>
            <div
              v-if="!bidder.technical"
              @click="technicalInputs[bidder.id]?.click()"
              class="p-4 text-center cursor-pointer hover:bg-cyber-cyan/5 transition-colors group"
            >
              <Upload class="w-6 h-6 mx-auto text-slate-300 group-hover:text-cyber-cyan transition-colors mb-1" />
              <p class="text-xs text-slate-400 group-hover:text-cyber-cyan">点击上传技术标</p>
            </div>
            <div v-else class="flex items-center justify-between p-3">
              <div class="flex items-center gap-2 min-w-0">
                <CheckCircle2 class="w-4 h-4 text-cyber-green flex-shrink-0" />
                <div class="min-w-0">
                  <p class="text-sm text-slate-700 truncate">{{ bidder.technical.name }}</p>
                  <p class="text-xs text-slate-400">{{ (bidder.technical.size / 1024 / 1024).toFixed(1) }} MB</p>
                </div>
              </div>
              <button @click="bidder.technical = null" class="text-slate-400 hover:text-cyber-red transition-colors flex-shrink-0">
                <X class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- 商务标 -->
          <div class="rounded-lg border border-slate-200 overflow-hidden">
            <input
              :ref="(el) => { commercialInputs[bidder.id] = el as HTMLInputElement }"
              type="file"
              accept=".doc,.docx"
              class="hidden"
              @change="(e) => onCommercialChange(e, bidder)"
            />
            <div class="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
              <Briefcase class="w-4 h-4 text-cyber-magenta" />
              <span class="text-sm font-medium text-slate-600">商务标</span>
            </div>
            <div
              v-if="!bidder.commercial"
              @click="commercialInputs[bidder.id]?.click()"
              class="p-4 text-center cursor-pointer hover:bg-cyber-magenta/5 transition-colors group"
            >
              <Upload class="w-6 h-6 mx-auto text-slate-300 group-hover:text-cyber-magenta transition-colors mb-1" />
              <p class="text-xs text-slate-400 group-hover:text-cyber-magenta">点击上传商务标</p>
            </div>
            <div v-else class="flex items-center justify-between p-3">
              <div class="flex items-center gap-2 min-w-0">
                <CheckCircle2 class="w-4 h-4 text-cyber-green flex-shrink-0" />
                <div class="min-w-0">
                  <p class="text-sm text-slate-700 truncate">{{ bidder.commercial.name }}</p>
                  <p class="text-xs text-slate-400">{{ (bidder.commercial.size / 1024 / 1024).toFixed(1) }} MB</p>
                </div>
              </div>
              <button @click="bidder.commercial = null" class="text-slate-400 hover:text-cyber-red transition-colors flex-shrink-0">
                <X class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-2">
          <span
            class="text-xs px-2 py-0.5 rounded"
            :class="{
              'bg-green-50 text-green-700': hasFile(bidder),
              'bg-slate-100 text-slate-500': !hasFile(bidder),
            }"
          >
            {{ getUploadMode(bidder) }}
          </span>
          <span v-if="!hasFile(bidder)" class="text-xs text-cyber-yellow">
            ⚠ 请至少上传技术标或商务标（只传一个视为综合文件）
          </span>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
      {{ errorMsg }}
    </div>

    <!-- 底部操作 -->
    <div class="flex justify-between items-center pt-4 border-t border-cyber-border">
      <div class="text-sm text-cyber-gray">
        <span v-if="canProceed" class="text-cyber-green">✓ 已满足上传要求</span>
        <span v-else class="text-cyber-yellow">⚠ 请上传采购文件，并确保每家投标公司至少有一个文件</span>
      </div>
      <button
        :disabled="!canProceed || uploading"
        @click="handleSubmit"
        class="cyber-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Loader2 v-if="uploading" class="w-4 h-4 inline animate-spin mr-1" />
        <span v-if="uploading">上传解析中...</span>
        <span v-else>下一步：审查配置 →</span>
      </button>
    </div>
  </div>
</template>

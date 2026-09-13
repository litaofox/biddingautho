<script setup lang="ts">
import { ref, computed } from "vue";
import {
  Table2, AlertTriangle, Gauge, FileText, Bot, ShieldCheck,
  XCircle, Star, ScrollText, ChevronDown, ChevronUp
} from "lucide-vue-next";
import type {
  UnifiedReviewResult, LLMReviewResult, TableRow, StatusType,
  RejectionItem, ScoringItem
} from "@/types";

const props = defineProps<{
  result: UnifiedReviewResult | null;
}>();

const emit = defineEmits<{
  (e: "next"): void;
  (e: "back"): void;
}>();

const bidders = computed(() => props.result?.bidders || []);
const tableData = computed<TableRow[]>(() => props.result?.complianceTable || []);
const evaluation = computed(() => props.result?.evaluation);
const isLLMMode = computed(() => props.result?.mode === "llm");
const llmResult = computed<LLMReviewResult | null>(
  () => (props.result?.mode === "llm" ? (props.result as LLMReviewResult) : null)
);

// 废标项
const rejectionItems = computed<RejectionItem[]>(() => llmResult.value?.rejection.items || []);
const rejectionByBidder = computed(() => llmResult.value?.rejection.byBidder || {});

// 评分项
const scoringItems = computed<ScoringItem[]>(() => llmResult.value?.scoringItems || []);

// 分析日志
const analysisLog = computed<string[]>(() => llmResult.value?.analysisLog || []);

const selectedCell = ref<{ rowIndex: number; bidderIndex: number } | null>(null);

const statusConfig: Record<StatusType, { label: string; class: string }> = {
  pass: { label: "✓ 符合", class: "status-pass" },
  warn: { label: "△ 偏离", class: "status-warn" },
  fail: { label: "✗ 不符合", class: "status-fail" },
  none: { label: "○ 未响应", class: "status-none" },
};

const severityConfig: Record<string, { label: string; class: string; dot: string }> = {
  critical: { label: "致命", class: "bg-red-100 text-red-700 border-red-300", dot: "bg-red-500" },
  major: { label: "重大", class: "bg-orange-100 text-orange-700 border-orange-300", dot: "bg-orange-500" },
  minor: { label: "一般", class: "bg-amber-100 text-amber-700 border-amber-300", dot: "bg-amber-500" },
};

const selectedDetail = computed(() => {
  if (!selectedCell.value || !tableData.value.length) return null;
  const row = tableData.value[selectedCell.value.rowIndex];
  if (!row) return null;
  const cell = row.cells[selectedCell.value.bidderIndex];
  if (!cell) return null;
  return {
    item: row.item,
    expectedText: row.expectedText,
    bidder: bidders.value[selectedCell.value.bidderIndex],
    ...cell,
  };
});

// 废标项展开
const expandedRejections = ref<Set<string>>(new Set());
function toggleRejection(name: string) {
  if (expandedRejections.value.has(name)) {
    expandedRejections.value.delete(name);
  } else {
    expandedRejections.value.add(name);
  }
}

// 评分项展开
const expandedScoring = ref<Set<string>>(new Set());
function toggleScoring(name: string) {
  if (expandedScoring.value.has(name)) {
    expandedScoring.value.delete(name);
  } else {
    expandedScoring.value.add(name);
  }
}

// 评分合计
function getBidderTotalScore(bidder: string): { score: number; max: number } {
  let score = 0;
  let max = 0;
  for (const item of scoringItems.value) {
    const bs = item.bidderScores.find((s) => s.bidder === bidder);
    score += bs?.score || 0;
    max += item.maxScore;
  }
  return { score, max };
}

const conclusionOptions = ["推荐", "有条件推荐", "不推荐"];
const localConclusion = ref("");
function setConclusion(opt: string) {
  localConclusion.value = opt;
}
const displayConclusion = computed(() => localConclusion.value || evaluation.value?.conclusion || "");

function selectCell(rowIndex: number, bidderIndex: number) {
  selectedCell.value = { rowIndex, bidderIndex };
}

// 是否有废标项触发
function hasTriggeredRejection(bidder: string): boolean {
  const items = rejectionByBidder.value[bidder] || [];
  return items.some((r) => r.triggered);
}
</script>

<template>
  <div class="space-y-6">
    <!-- 页面标题 -->
    <div class="flex items-center gap-3">
      <div class="w-1 h-8 shadow-green-glow" :class="isLLMMode ? 'bg-cyber-purple' : 'bg-cyber-green'"></div>
      <h2 class="text-2xl font-bold" :class="isLLMMode ? 'text-cyber-purple' : 'neon-text-green'">审查结果</h2>
      <span class="text-slate-500 text-sm">[步骤 3/4]</span>
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

    <!-- 符合性检查表格 -->
    <div class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <Table2 class="w-5 h-5 text-cyber-cyan" />
        <h3 class="font-semibold text-slate-700">符合性检查表格</h3>
        <span class="text-xs text-slate-400 ml-auto">共 {{ tableData.length }} 项</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b border-slate-200">
              <th class="text-left p-3 text-sm text-slate-500">审查项</th>
              <th class="text-left p-3 text-sm text-slate-500">类别</th>
              <th class="text-left p-3 text-sm text-slate-500">采购要求</th>
              <th
                v-for="(bidder, idx) in bidders"
                :key="idx"
                class="text-center p-3 text-sm"
                :class="idx % 2 === 0 ? 'text-cyber-cyan' : 'text-cyber-magenta'"
              >
                {{ bidder }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIdx) in tableData"
              :key="rowIdx"
              class="border-b border-slate-100 hover:bg-blue-50/40 transition-colors"
            >
              <td class="p-3 text-sm text-slate-700">{{ row.item }}</td>
              <td class="p-3">
                <span class="text-xs text-slate-400">{{ row.category }}</span>
              </td>
              <td class="p-3 text-xs text-slate-500 max-w-[200px] truncate" :title="row.expectedText">
                {{ row.expectedText }}
              </td>
              <td
                v-for="(cell, bidIdx) in row.cells"
                :key="bidIdx"
                class="p-3 text-center"
              >
                <button
                  @click="selectCell(rowIdx, bidIdx)"
                  class="transition-transform hover:scale-105"
                  :class="{ 'ring-2 ring-cyber-cyan rounded': selectedCell?.rowIndex === rowIdx && selectedCell?.bidderIndex === bidIdx }"
                >
                  <span :class="statusConfig[cell.status].class">
                    {{ statusConfig[cell.status].label }}
                  </span>
                </button>
              </td>
            </tr>
            <tr v-if="!tableData.length">
              <td :colspan="3 + bidders.length" class="p-6 text-center text-slate-400 text-sm">
                暂无审查数据
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-slate-400 mt-3">点击单元格查看比对详情</p>
    </div>

    <!-- 比对详情 -->
    <div v-if="selectedDetail" class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <FileText class="w-5 h-5 text-cyber-magenta" />
        <h3 class="font-semibold text-slate-700">比对详情</h3>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-4 rounded-lg bg-blue-50 border border-blue-200">
          <p class="text-xs text-cyber-cyan mb-2">采购要求</p>
          <p class="text-sm text-slate-600">{{ selectedDetail.expectedText || selectedDetail.item }}</p>
        </div>
        <div class="p-4 rounded-lg bg-cyber-magenta/5 border border-cyber-magenta/30">
          <p class="text-xs text-cyber-magenta mb-2">{{ selectedDetail.bidder }} 响应</p>
          <p class="text-sm text-slate-600">{{ selectedDetail.evidence }}</p>
        </div>
      </div>

      <div v-if="selectedDetail.deviation" class="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
        <p class="text-xs text-amber-600 mb-1">偏离说明</p>
        <p class="text-sm text-amber-700">{{ selectedDetail.deviation }}</p>
      </div>

      <div class="mt-4 flex items-center gap-4">
        <span class="text-sm text-slate-500">匹配得分：</span>
        <div class="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden max-w-xs">
          <div
            class="h-full rounded-full transition-all"
            :class="{
              'bg-cyber-green': selectedDetail.score >= 75,
              'bg-cyber-yellow': selectedDetail.score >= 40 && selectedDetail.score < 75,
              'bg-cyber-red': selectedDetail.score < 40,
            }"
            :style="{ width: selectedDetail.score + '%' }"
          ></div>
        </div>
        <span class="text-sm font-bold" :class="{
          'text-cyber-green': selectedDetail.score >= 75,
          'text-cyber-yellow': selectedDetail.score >= 40 && selectedDetail.score < 75,
          'text-cyber-red': selectedDetail.score < 40,
        }">{{ selectedDetail.score }}%</span>
      </div>
    </div>

    <!-- ========== LLM 模式专属：废标项分析 ========== -->
    <div v-if="isLLMMode && rejectionItems.length > 0" class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <XCircle class="w-5 h-5 text-red-600" />
        <h3 class="font-semibold text-slate-700">废标项分析</h3>
        <span class="text-xs text-slate-400 ml-auto">共 {{ rejectionItems.length }} 项</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b border-slate-200">
              <th class="text-left p-3 text-sm text-slate-500">废标项</th>
              <th class="text-left p-3 text-sm text-slate-500">严重程度</th>
              <th class="text-left p-3 text-sm text-slate-500">废标条件</th>
              <th
                v-for="(bidder, idx) in bidders"
                :key="idx"
                class="text-center p-3 text-sm text-slate-500"
              >
                {{ bidder }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in rejectionItems"
              :key="item.name"
              class="border-b border-slate-100"
            >
              <td class="p-3 text-sm text-slate-700 font-medium">{{ item.name }}</td>
              <td class="p-3">
                <span
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border"
                  :class="severityConfig[item.severity]?.class || 'bg-slate-100 text-slate-600 border-slate-300'"
                >
                  <span class="w-1.5 h-1.5 rounded-full" :class="severityConfig[item.severity]?.dot || 'bg-slate-400'"></span>
                  {{ severityConfig[item.severity]?.label || item.severity }}
                </span>
              </td>
              <td class="p-3 text-xs text-slate-500 max-w-[250px]">{{ item.description }}</td>
              <td
                v-for="bidder in bidders"
                :key="bidder"
                class="p-3 text-center"
              >
                <button
                  @click="toggleRejection(item.name)"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
                  :class="(rejectionByBidder[bidder]?.find(r => r.name === item.name))?.triggered
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-green-100 text-green-700 hover:bg-green-200'"
                >
                  {{ (rejectionByBidder[bidder]?.find(r => r.name === item.name))?.triggered ? '触发' : '未触发' }}
                  <ChevronDown v-if="!expandedRejections.has(item.name)" class="w-3 h-3" />
                  <ChevronUp v-else class="w-3 h-3" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 废标项详情 -->
      <div
        v-for="bidder in bidders.filter(b => hasTriggeredRejection(b))"
        :key="'rej-' + bidder"
        class="mt-4 p-4 rounded-lg bg-red-50 border border-red-200"
      >
        <p class="text-sm font-semibold text-red-700 mb-2">{{ bidder }} - 触发废标项明细</p>
        <div
          v-for="r in (rejectionByBidder[bidder] || []).filter(r => r.triggered)"
          :key="bidder + '-' + r.name"
          class="mb-2 p-3 rounded bg-white border border-red-200"
        >
          <p class="text-sm font-medium text-red-700 mb-1">{{ r.name }}</p>
          <p class="text-xs text-slate-600"><strong>证据：</strong>{{ r.evidence || '无' }}</p>
          <p class="text-xs text-slate-600 mt-1"><strong>理由：</strong>{{ r.reason || '无' }}</p>
        </div>
      </div>
    </div>

    <!-- ========== LLM 模式专属：评分项与模拟打分 ========== -->
    <div v-if="isLLMMode && scoringItems.length > 0" class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <Star class="w-5 h-5 text-amber-500" />
        <h3 class="font-semibold text-slate-700">评分项与模拟打分</h3>
        <span class="text-xs text-slate-400 ml-auto">共 {{ scoringItems.length }} 项</span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b border-slate-200">
              <th class="text-left p-3 text-sm text-slate-500">评分项</th>
              <th class="text-left p-3 text-sm text-slate-500">类别</th>
              <th class="text-center p-3 text-sm text-slate-500">满分</th>
              <th class="text-left p-3 text-sm text-slate-500">评分标准</th>
              <th
                v-for="(bidder, idx) in bidders"
                :key="idx"
                class="text-center p-3 text-sm text-slate-500"
              >
                {{ bidder }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in scoringItems"
              :key="item.name"
              class="border-b border-slate-100"
            >
              <td class="p-3 text-sm text-slate-700 font-medium">{{ item.name }}</td>
              <td class="p-3 text-xs text-slate-500">{{ item.category }}</td>
              <td class="p-3 text-center text-sm text-slate-600">{{ item.maxScore }}</td>
              <td class="p-3 text-xs text-slate-500 max-w-[200px]">{{ item.requirement }}</td>
              <td
                v-for="bidder in bidders"
                :key="bidder"
                class="p-3 text-center"
              >
                <button
                  @click="toggleScoring(item.name)"
                  class="inline-flex flex-col items-center gap-1"
                >
                  <span
                    class="text-sm font-bold"
                    :class="{
                      'text-cyber-green': (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) >= item.maxScore * 0.8,
                      'text-cyber-yellow': (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) >= item.maxScore * 0.5 && (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) < item.maxScore * 0.8,
                      'text-cyber-red': (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) < item.maxScore * 0.5,
                    }"
                  >
                    {{ item.bidderScores.find(s => s.bidder === bidder)?.score || 0 }}/{{ item.maxScore }}
                  </span>
                  <div class="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full"
                      :class="{
                        'bg-cyber-green': (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) >= item.maxScore * 0.8,
                        'bg-cyber-yellow': (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) >= item.maxScore * 0.5 && (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) < item.maxScore * 0.8,
                        'bg-cyber-red': (item.bidderScores.find(s => s.bidder === bidder)?.score || 0) < item.maxScore * 0.5,
                      }"
                      :style="{ width: Math.round(((item.bidderScores.find(s => s.bidder === bidder)?.score || 0) / item.maxScore) * 100) + '%' }"
                    ></div>
                  </div>
                </button>
              </td>
            </tr>
            <!-- 合计行 -->
            <tr class="bg-slate-50 font-semibold">
              <td class="p-3 text-sm text-slate-700">合计</td>
              <td class="p-3" colspan="3">
                <span class="text-xs text-slate-500">满分 {{ scoringItems.reduce((s, i) => s + i.maxScore, 0) }} 分</span>
              </td>
              <td
                v-for="bidder in bidders"
                :key="'total-' + bidder"
                class="p-3 text-center"
              >
                <span class="text-sm text-cyber-purple">
                  {{ getBidderTotalScore(bidder).score }}/{{ getBidderTotalScore(bidder).max }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 打分详情 -->
      <div
        v-for="item in scoringItems"
        :key="'detail-' + item.name"
        v-show="expandedScoring.has(item.name)"
        class="mt-4 space-y-3"
      >
        <p class="text-sm font-semibold text-slate-700 border-l-4 border-amber-400 pl-2">{{ item.name }}</p>
        <div
          v-for="bs in item.bidderScores"
          :key="item.name + '-' + bs.bidder"
          class="p-3 rounded-lg bg-slate-50 border border-slate-200"
        >
          <div class="flex items-center justify-between mb-1">
            <span class="text-sm font-medium text-slate-700">{{ bs.bidder }}</span>
            <span class="text-sm font-bold text-cyber-purple">{{ bs.score }}/{{ item.maxScore }}</span>
          </div>
          <p class="text-xs text-slate-600"><strong>打分理由：</strong>{{ bs.reason || '无' }}</p>
          <p class="text-xs text-slate-500 mt-1"><strong>证据：</strong>{{ bs.evidence || '无' }}</p>
        </div>
      </div>

      <p class="text-xs text-slate-400 mt-3">
        ※ 模拟打分由 AI 根据投标文件响应程度给出，仅供参考，最终以评标委员会打分为准。点击得分可查看打分详情。
      </p>
    </div>

    <!-- 专业评价 -->
    <div v-if="evaluation" class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <Gauge class="w-5 h-5" :class="isLLMMode ? 'text-cyber-purple' : 'text-cyber-green'" />
        <h3 class="font-semibold text-slate-700">专业评价</h3>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- 综合评分 -->
        <div>
          <div class="flex items-end gap-4 mb-4">
            <span
              class="text-5xl font-bold"
              :class="isLLMMode ? 'text-cyber-purple' : 'neon-text-green'"
            >{{ evaluation.score }}</span>
            <span class="text-slate-400 mb-2">/ 100 分</span>
          </div>
          <div class="h-3 bg-slate-200 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all"
              :class="isLLMMode ? 'bg-gradient-to-r from-purple-500 to-cyber-purple' : 'bg-gradient-to-r from-cyber-cyan to-cyber-green'"
              :style="{ width: evaluation.score + '%' }"
            ></div>
          </div>

          <!-- AI 评价摘要（LLM 模式） -->
          <div v-if="isLLMMode && (llmResult?.evaluation.summary)" class="mt-4 p-3 rounded-lg bg-purple-50 border border-purple-200">
            <p class="text-xs text-purple-600 mb-1 font-medium">AI 评价摘要</p>
            <p class="text-sm text-purple-800">{{ llmResult?.evaluation.summary }}</p>
          </div>

          <div class="mt-6">
            <label class="block text-sm text-slate-500 mb-2">建议结论（可编辑）</label>
            <div class="flex gap-2">
              <button
                v-for="opt in conclusionOptions"
                :key="opt"
                @click="setConclusion(opt)"
                class="px-4 py-2 rounded border text-sm transition-all"
                :class="displayConclusion === opt
                  ? 'bg-blue-50 text-cyber-cyan border-cyber-cyan shadow-cyan-glow'
                  : 'border-slate-200 text-slate-500 hover:border-cyber-cyan/50'"
              >
                {{ opt }}
              </button>
            </div>
          </div>
        </div>

        <!-- 风险提示 -->
        <div>
          <div class="flex items-center gap-2 mb-3">
            <AlertTriangle class="w-4 h-4 text-amber-600" />
            <span class="text-sm text-amber-600">风险提示</span>
          </div>
          <ul v-if="evaluation.risks.length" class="space-y-2">
            <li
              v-for="(risk, idx) in evaluation.risks"
              :key="idx"
              class="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200"
            >
              <span class="text-amber-600 text-xs mt-0.5">▸</span>
              <span class="text-sm text-slate-600">{{ risk }}</span>
            </li>
          </ul>
          <p v-else class="text-sm text-slate-400">未发现重大风险</p>
        </div>
      </div>
    </div>

    <!-- ========== LLM 模式专属：分析过程日志 ========== -->
    <div v-if="isLLMMode && analysisLog.length > 0" class="cyber-panel p-6">
      <div class="flex items-center gap-2 mb-4">
        <ScrollText class="w-5 h-5 text-slate-600" />
        <h3 class="font-semibold text-slate-700">分析过程日志</h3>
        <span class="text-xs text-slate-400 ml-auto">共 {{ analysisLog.length }} 条记录</span>
      </div>
      <div class="bg-slate-900 text-slate-300 p-4 rounded-lg font-mono text-xs leading-relaxed max-h-80 overflow-y-auto">
        <div v-for="(line, idx) in analysisLog" :key="idx" class="whitespace-pre-wrap break-all">
          {{ line }}
        </div>
      </div>
    </div>

    <!-- 底部操作 -->
    <div class="flex justify-between items-center pt-4 border-t border-cyber-border">
      <button @click="emit('back')" class="cyber-btn text-slate-500 border-slate-200 hover:text-slate-700">
        ← 上一步
      </button>
      <button @click="emit('next')" :class="isLLMMode ? 'cyber-btn-purple' : 'cyber-btn-green'">
        下一步：导出报告 →
      </button>
    </div>
  </div>
</template>

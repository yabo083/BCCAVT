<script setup lang="ts">
/** 抓取进度：阶段、已取/声明、请求与缓存计数、退避倒计时、取消。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import IconCircleNotch from '~icons/ph/circle-notch';
import IconXCircle from '~icons/ph/x-circle';
import IconHourglass from '~icons/ph/hourglass';
import IconGearSix from '~icons/ph/gear-six';
import IconWarningCircle from '~icons/ph/warning-circle';
import CrawlOptionsPanel from './CrawlOptionsPanel.vue';
import { cancelRun, state } from '../store';
import { formatCount, formatDuration } from '../format';
import type { CrawlPhase } from '@/core/report';

const PHASE_LABELS: Record<CrawlPhase, string> = {
  session: '读取登录态',
  subject: '获取主体信息',
  roots: '抓取顶层评论',
  threads: '抓取评论树',
  analyze: '汇总分析',
  done: '完成',
};

const nowTick = ref(Date.now());
let timer: number | undefined;
let waitingUntil = 0;

function startTimer(): void {
  if (timer === undefined) {
    timer = window.setInterval(() => {
      nowTick.value = Date.now();
    }, 250);
  }
}

function stopTimer(): void {
  if (timer !== undefined) {
    window.clearInterval(timer);
    timer = undefined;
  }
}

watch(
  () => state.run,
  (run) => {
    if (run) {
      nowTick.value = Date.now();
      startTimer();
    } else {
      stopTimer();
      waitingUntil = 0;
    }
  },
  { immediate: true },
);

watch(
  () => state.run?.progress.waitingMs,
  (ms) => {
    if (ms && ms > 0) waitingUntil = Date.now() + ms;
  },
);

onBeforeUnmount(stopTimer);

const percent = computed(() => {
  const progress = state.run?.progress;
  if (!progress?.declared) return 0;
  return Math.min(100, (progress.fetched / progress.declared) * 100);
});

const remainingMs = computed(() => Math.max(0, waitingUntil - nowTick.value));
</script>

<template>
  <section v-if="state.run" class="run" aria-live="polite">
    <div class="row between wrap">
      <span class="row small">
        <IconCircleNotch class="spinner run-icon" />
        <strong>{{ PHASE_LABELS[state.run.progress.phase] }}</strong>
        <span class="subtle">{{ state.run.label }}</span>
      </span>
      <span class="row">
        <span class="subtle small tnum">{{ formatDuration(nowTick - state.run.startedAt) }}</span>
        <button type="button" class="btn btn-sm btn-danger" @click="cancelRun">
          <IconXCircle />
          取消
        </button>
      </span>
    </div>

    <div class="bar" :class="{ idle: !state.run.progress.declared }">
      <div class="fill" :style="state.run.progress.declared ? { width: `${percent}%` } : undefined" />
    </div>

    <div class="row wrap small subtle tnum counters">
      <span>
        已取 {{ formatCount(state.run.progress.fetched) }}
        <template v-if="state.run.progress.declared">/ {{ formatCount(state.run.progress.declared) }}</template>
      </span>
      <span>请求 {{ state.run.progress.requests }}</span>
      <span>缓存命中 {{ state.run.progress.cacheHits }}</span>
      <span v-if="state.run.progress.threadsTotal">
        评论树 {{ state.run.progress.threadsDone ?? 0 }}/{{ state.run.progress.threadsTotal }}
      </span>
    </div>

    <p v-if="remainingMs > 0" class="wait small">
      <IconHourglass />
      等待风控解除，{{ Math.ceil(remainingMs / 1000) }} 秒后自动重试
    </p>

    <details class="options">
      <summary class="row small">
        <IconGearSix />
        抓取选项
      </summary>
      <CrawlOptionsPanel />
    </details>
  </section>

  <section v-else-if="state.runError" class="failure" role="alert">
    <div class="row">
      <IconWarningCircle class="failure-icon" />
      <strong>抓取失败</strong>
      <span class="grow" />
      <button type="button" class="btn btn-sm btn-ghost" @click="state.runError = null">关闭</button>
    </div>
    <p class="small">{{ state.runError }}</p>
  </section>
</template>

<style scoped>
.run {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.run-icon {
  width: 14px;
  height: 14px;
  color: var(--accent);
}

.bar {
  height: 6px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: var(--r-pill);
  background: var(--accent);
  transition: width var(--dur) ease;
}

.bar.idle .fill {
  width: 35%;
  animation: slide 1.4s ease-in-out infinite alternate;
}

@keyframes slide {
  from {
    transform: translateX(-20%);
  }

  to {
    transform: translateX(190%);
  }
}

.counters {
  gap: var(--sp-3);
}

.wait {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  margin: 0;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--warning-bg);
  color: var(--warning);
}

.wait svg {
  width: 13px;
  height: 13px;
}

.options summary {
  cursor: pointer;
  color: var(--fg-muted);
  gap: var(--sp-1);
}

.options summary svg {
  width: 14px;
  height: 14px;
}

.options[open] summary {
  margin-bottom: var(--sp-2);
}

.failure {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--error-bg);
}

.failure-icon {
  width: 16px;
  height: 16px;
  color: var(--error);
}

.failure p {
  margin: 0;
  color: var(--fg);
  word-break: break-word;
}
</style>

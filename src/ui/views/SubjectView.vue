<script setup lang="ts">
/** 主体报告：头部、KPI、图表、榜单、全森林 Canvas。 */
import { computed } from 'vue';
import IconArrowClockwise from '~icons/ph/arrow-clockwise';
import IconArrowSquareOut from '~icons/ph/arrow-square-out';
import IconListMagnifyingGlass from '~icons/ph/list-magnifying-glass';
import IconSparkle from '~icons/ph/sparkle';
import IconChartBar from '~icons/ph/chart-bar';
import IconChatCircleText from '~icons/ph/chat-circle-text';
import IconChartLineUp from '~icons/ph/chart-line-up';
import IconUsers from '~icons/ph/users';
import IconShareNetwork from '~icons/ph/share-network';
import IconTreeStructure from '~icons/ph/tree-structure';
import AuthorChip from '../components/AuthorChip.vue';
import BarList from '../components/BarList.vue';
import CommentRow from '../components/CommentRow.vue';
import CompletenessBadge from '../components/CompletenessBadge.vue';
import ErrorBoundary from '../components/ErrorBoundary.vue';
import ForestCanvas from '../components/ForestCanvas.vue';
import HistogramChart from '../components/HistogramChart.vue';
import StatTile from '../components/StatTile.vue';
import TimelineChart from '../components/TimelineChart.vue';
import { generateInsight, refreshSubject, startThread, state } from '../store';
import { formatCount, formatDate, formatDuration, formatRelative } from '../format';
import type { Comment } from '@/core/model';
import type { CommentListItem } from '../explore';

const result = computed(() => state.subject);
const report = computed(() => result.value?.report ?? null);
const snapshot = computed(() => result.value?.snapshot ?? null);

function toItem(comment: Comment): CommentListItem {
  const node = result.value?.forest.byId.get(comment.id);
  let top = node ?? null;
  for (let current = top?.parent ?? null; current; current = current.parent) top = current;
  return {
    comment,
    depth: node?.depth ?? 0,
    replies: (node?.size ?? 1) - 1,
    rootId: top?.comment.id ?? comment.id,
  };
}

const tiles = computed(() => {
  const overview = report.value?.overview;
  const stats = snapshot.value?.fetchStats;
  if (!overview || !stats) return [];
  const spanDays =
    overview.firstAt !== null && overview.lastAt !== null
      ? Math.max(1, Math.round((overview.lastAt - overview.firstAt) / 86_400_000))
      : null;
  return [
    { label: '评论总数', value: formatCount(overview.total), sub: `顶层 ${formatCount(overview.roots)} · 回复 ${formatCount(overview.replies)}` },
    { label: '参与作者', value: formatCount(overview.authors) },
    { label: '总点赞', value: formatCount(overview.totalLikes), sub: `中位 ${formatCount(overview.medianLikes)}` },
    { label: '最大深度', value: String(overview.maxDepth) },
    {
      label: '时间跨度',
      value: spanDays === null ? '—' : `${spanDays} 天`,
      sub: overview.lastAt === null ? undefined : `最后一条 ${formatRelative(overview.lastAt)}`,
    },
    {
      label: '请求 / 缓存',
      value: String(stats.requests),
      sub: `命中 ${stats.cacheHits} · ${formatDuration(stats.durationMs)}`,
    },
  ];
});

function openThread(commentId: string): void {
  const ref = snapshot.value?.subject.ref;
  if (ref) void startThread(commentId, ref);
}

function openInsight(): void {
  state.view = 'ai';
  void generateInsight();
}
</script>

<template>
  <div v-if="!result || !report || !snapshot" class="empty">还没有主体报告，先在顶部输入目标并点「分析评论区」。</div>

  <div v-else class="stack view">
    <section class="card">
      <div class="head row">
        <img v-if="snapshot.subject.coverUrl" class="cover" :src="snapshot.subject.coverUrl" alt="" referrerpolicy="no-referrer" />
        <div class="stack grow">
          <h2 class="title">{{ snapshot.subject.title }}</h2>
          <div class="row wrap small subtle">
            <AuthorChip v-if="snapshot.subject.author" :author="snapshot.subject.author" />
            <span v-if="snapshot.subject.publishedAt" class="tnum">发布于 {{ formatDate(snapshot.subject.publishedAt) }}</span>
            <a :href="snapshot.subject.url" target="_blank" rel="noreferrer">
              <IconArrowSquareOut />
              原页面
            </a>
          </div>
          <div class="row wrap">
            <CompletenessBadge :completeness="snapshot.completeness" />
            <span class="chip">{{ snapshot.auth === 'user' ? '登录态' : '匿名' }}</span>
            <span class="chip tnum">抓取于 {{ formatRelative(snapshot.fetchedAt) }}</span>
            <span v-if="result.fromSnapshot" class="chip chip-info">来自已有快照</span>
          </div>
        </div>
      </div>
      <div class="row wrap actions">
        <button type="button" class="btn" :disabled="!!state.run" @click="refreshSubject">
          <IconArrowClockwise />
          刷新
        </button>
        <button type="button" class="btn btn-tonal" @click="state.view = 'explorer'">
          <IconListMagnifyingGlass />
          探索评论
        </button>
        <button type="button" class="btn btn-tonal" @click="openInsight">
          <IconSparkle />
          AI 解读
        </button>
      </div>
    </section>

    <section class="tiles">
      <StatTile v-for="tile in tiles" :key="tile.label" :label="tile.label" :value="tile.value" :sub="tile.sub" />
    </section>

    <div class="columns">
      <div class="stack column">
        <section class="card stack">
          <div class="card-head">
            <h2 class="card-title"><IconChartBar /> 时间分布</h2>
            <span class="small subtle tnum">共 {{ formatCount(report.overview.total) }} 条</span>
          </div>
          <TimelineChart :timeline="report.timeline" />
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChartBar /> 关键词</h2></div>
          <BarList :items="report.keywords" :limit="10" />
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChartBar /> 深度分布</h2></div>
          <HistogramChart :items="report.depthHistogram" unit=" 层" />
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChartBar /> 等级分布</h2></div>
          <HistogramChart :items="report.levels" unit=" 级" />
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChartBar /> IP 属地</h2></div>
          <BarList :items="report.locations" :limit="8" />
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChatCircleText /> 热门评论</h2></div>
          <div v-if="report.topComments.length" class="stack">
            <CommentRow
              v-for="comment in report.topComments"
              :key="comment.id"
              :comment="comment"
              :depth="toItem(comment).depth"
              :replies="toItem(comment).replies"
              thread-action
              @select="openThread"
              @open-thread="openThread"
            />
          </div>
          <p v-else class="empty">暂无评论数据</p>
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconChartLineUp /> 最热评论树</h2></div>
          <ul v-if="report.hotThreads.length" class="threads">
            <li v-for="digest in report.hotThreads" :key="digest.root.id" class="thread-row">
              <div class="row wrap">
                <AuthorChip :author="digest.root.author" />
                <span class="chip tnum">子树 {{ formatCount(digest.size) }}</span>
                <span class="chip tnum">深度 {{ digest.depth }}</span>
                <span class="chip tnum">{{ formatCount(digest.participants) }} 人</span>
                <span class="grow" />
                <button type="button" class="btn btn-sm btn-tonal" @click="openThread(digest.root.id)">
                  <IconTreeStructure />
                  分析此评论树
                </button>
              </div>
              <p class="text">{{ digest.root.text }}</p>
            </li>
          </ul>
          <p v-else class="empty">暂无评论树数据</p>
        </section>

        <section class="card stack">
          <div class="card-head"><h2 class="card-title"><IconUsers /> 活跃作者</h2></div>
          <ol v-if="report.activeAuthors.length" class="authors">
            <li v-for="stat in report.activeAuthors" :key="stat.author.id">
              <AuthorChip :author="stat.author" />
              <span class="grow" />
              <span class="small subtle tnum">{{ formatCount(stat.comments) }} 条 · {{ formatCount(stat.likes) }} 赞</span>
            </li>
          </ol>
          <p v-else class="empty">暂无作者数据</p>
        </section>

        <section v-if="report.exchanges.length" class="card stack">
          <div class="card-head"><h2 class="card-title"><IconShareNetwork /> 交锋最激烈的作者对</h2></div>
          <ol class="authors">
            <li v-for="exchange in report.exchanges" :key="exchange.a.id + exchange.b.id">
              <AuthorChip :author="exchange.a" />
              <span class="subtle small">与</span>
              <AuthorChip :author="exchange.b" />
              <span class="grow" />
              <span class="small subtle tnum">{{ formatCount(exchange.turns) }} 回合</span>
            </li>
          </ol>
        </section>
      </div>

      <div class="stack column">
        <section class="card stack forest-card">
          <div class="card-head">
            <h2 class="card-title"><IconTreeStructure /> 评论区森林</h2>
            <span class="small subtle">全部 {{ formatCount(report.overview.total) }} 条</span>
          </div>
          <ErrorBoundary title="评论区森林">
            <ForestCanvas
              :forest="result.forest"
              :selected-root-id="state.selectedCommentId"
              @open-thread="openThread"
            />
          </ErrorBoundary>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view {
  gap: var(--sp-3);
}

.head {
  align-items: flex-start;
  gap: var(--sp-3);
}

.cover {
  width: 96px;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  flex: none;
}

.title {
  font-size: var(--fs-lg);
  font-weight: 600;
  line-height: var(--lh-tight);
}

.actions {
  margin-top: var(--sp-3);
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: var(--sp-2);
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--sp-3);
  align-items: start;
}

@media (min-width: 720px) {
  .columns {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

.threads,
.authors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.thread-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}

.thread-row .text {
  margin: 0;
  font-size: var(--fs-sm);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.authors li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.forest-card {
  min-height: 340px;
}

@media (min-width: 720px) {
  .forest-card {
    position: sticky;
    top: var(--sp-3);
    min-height: 560px;
  }
}
</style>

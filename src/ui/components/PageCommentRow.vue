<script setup lang="ts">
/**
 * 内嵌阅读器的评论行（B 站原生风格的讨论串一行）。
 *
 * 版面：讨论串连接线（绝对定位铺满整行）→ 头像槽 → 内容列（作者行 / 正文 / 操作行 / 回复抽屉）。
 *
 * 连接线的几何全部锚在**头像中心**上：头像槽宽固定 `--avatar-slot`、圆片在槽里居中，于是第 col 列的
 * 中心线 `Xc(col) = --indent-base + col * --step + --slot-center`，竖脊与 elbow 都画在这条线上，
 * 线与线跨行首尾相接、x 严格对齐（旧版按「父头像左缘 + 几像素偏移」近似，换个主题或窄屏就会错位）。
 *
 * 画哪几列由 `thread.ts` 的 `col / parentCol / rowSpines` 决定（纯逻辑，收口规则见那里的注释）：
 * 本行自己接上来的那段是 elbow（父列 → 本列，左下圆角就是那段弧）；缩进封顶后父子同列，
 * 此时不画横线，只画一根竖直连接段（`.line.spine.capped`）把上方接进来——原型在这里会画出一段
 * 横向悬空尾巴，本实现修掉（见模板注释）。线色恒定，不随 hover 变色：整串变色会把连续的主干切成碎段。
 *
 * 缩进封顶在 `MAX_VISUAL_DEPTH` 列，更深的回复不再右移，深度语义用「第 N 层」补回。
 * 正文按自然高度完整展开（页面替换模式不做窗口化、不截断）。
 *
 * 写操作只收集意图：点赞按钮与回复框把 id / 正文 emit 给阅读器（EmbeddedComments）执行，
 * 组件自己不碰网络、不读 cookie。点赞显示态与回复草稿/发送态/错误全部由父级持有。
 */
import { computed, ref, watch } from 'vue';
import IconArrowBendDownRight from '~icons/ph/arrow-bend-down-right';
import IconCaretDown from '~icons/ph/caret-down';
import IconCaretRight from '~icons/ph/caret-right';
import IconChatCenteredText from '~icons/ph/chat-centered-text';
import IconGraph from '~icons/ph/graph';
import IconMapPin from '~icons/ph/map-pin';
import IconThumbsUp from '~icons/ph/thumbs-up';
import CommentComposer from './CommentComposer.vue';
import CommentText from './CommentText.vue';
import { splitMention } from '../comment-text';
import { formatCount, formatRelative } from '../format';
import { MAX_VISUAL_DEPTH, type ThreadRow } from '../thread';
import type { RowLikeState, RowReplyState } from '../reader-comments';
import type { UserCardRect } from '@/extension/page-comments';

const props = defineProps<{
  row: ThreadRow;
  /** 点赞显示态：计数已含本次会话的乐观增量。 */
  like: RowLikeState;
  /** 回复框状态：null / 缺省 = 关闭。 */
  reply?: RowReplyState | null;
  selected?: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  fold: [id: string];
  analyze: [id: string];
  'toggle-like': [id: string];
  'open-reply': [id: string];
  'close-reply': [id: string];
  'reply-input': [id: string, text: string];
  'submit-reply': [id: string, text: string];
  /**
   * 鼠标进了/出了作者（头像或昵称）：`rect: null` = 离开。
   * 组件只报「谁（mid）+ 在哪儿（嵌入文档坐标系）」，卡片本身由宿主驱动站点自己的实现（见 page-comments.ts）。
   */
  'user-card': [hover: { mid: string; rect: UserCardRect | null }];
}>();

/**
 * 悬停作者：把头像/昵称的当前位置报给父级；离开时 `rect: null`（同样带上 mid——收起的范围就是这位作者）。
 * 位置用**嵌入文档坐标系**（iframe 内部不滚动，等价于 iframe 视口坐标），由内容脚本换算到宿主坐标系。
 */
function hoverUser(event: Event, entering: boolean): void {
  // 没有主页地址的作者不参与卡片交互（元素是 span，不是链接）
  if (profileUrl.value === null) return;
  const mid = comment.value.author.id;
  const target = event.currentTarget;
  if (!entering || !(target instanceof HTMLElement)) {
    emit('user-card', { mid, rect: null });
    return;
  }
  const rect = target.getBoundingClientRect();
  emit('user-card', {
    mid,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  });
}

/**
 * 作者主页地址：有才是链接（点击开主页 + 悬停出卡片），没有（平台未给）就退化成纯展示元素。
 * 用 `:is` 切换 `a`/`span`，避免为「有链接 / 没链接」各写一份头像与昵称的内部结构。
 */
const profileUrl = computed(() => comment.value.author.profileUrl ?? null);
const userEntryTag = computed(() => (profileUrl.value === null ? 'span' : 'a'));

/** 真实深度超过封顶时才给出提示值。 */
const overflowDepth = computed(() => (props.row.depth > MAX_VISUAL_DEPTH ? props.row.depth : null));

/** 点赞数字：计数变化时重播一次回弹动画（挂载首帧不算变化，不播）。 */
const likeNum = ref<HTMLElement | null>(null);
watch(
  () => props.like.count,
  () => {
    const el = likeNum.value;
    if (el === null) return;
    // 先摘类再强制回流：连着点赞时浏览器会认为类没变，不回流就不重播动画。
    el.classList.remove('like-num-pop');
    void el.offsetWidth;
    el.classList.add('like-num-pop');
  },
);

/** 回复框正文的兜底：未打开时给一份空态（抽屉常驻 DOM，关着时也要有内容可渲染）。 */
const replyBox = computed<RowReplyState>(() => props.reply ?? { text: '', sending: false, error: null });
const replyOpen = computed(() => props.reply !== null && props.reply !== undefined);

const comment = computed(() => props.row.node.comment);
const author = computed(() => comment.value.author.name);
const isRoot = computed(() => props.row.depth === 0);
const level = computed(() => comment.value.author.level ?? null);
/** 头像 CDN 地址（取不到或被拦截时退回首字母牌）。 */
const avatarUrl = computed(() => comment.value.author.avatarUrl ?? '');
/** 离线/防盗链兜底头像的首字符与配色（确定性，避免一堆破图）。 */
const initial = computed(() => {
  const match = author.value.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : '·';
});
const avatarHue = computed(() => {
  let hash = 0;
  for (const char of author.value) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
});
/**
 * 头像底色：UP 主（`byCreator`）用品牌强调底，其余作者用昵称哈希出的确定性色相（原型 L1699/L1772）。
 * 底色有两个来源所以走 `:style`；UP 的首字母色是固定的，交给 `.up-avatar` 类。
 */
const avatarBackground = computed(() =>
  comment.value.byCreator ? 'var(--accent-bg)' : `hsl(${avatarHue.value} 52% 58%)`,
);
/**
 * 「回复 @某人：正文」前缀：命中时关系标记显示提及名、正文用去前缀的 body（原型 `parseCommentText`）。
 * 未命中则原样——`mention` 为 null、`body` 即全文。
 */
const parsedComment = computed(() => splitMention(comment.value.text));

function toggleReply(): void {
  if (replyOpen.value) emit('close-reply', props.row.id);
  else emit('open-reply', props.row.id);
}
</script>

<template>
  <article
    class="comment-row"
    :class="{ selected: props.selected, root: isRoot, 'branch-collapsed': props.row.folded }"
    :data-comment-id="row.id"
    :style="{ '--depth': row.col }"
    @click="emit('select', props.row.id)"
  >
    <!-- 连接层：竖脊 / elbow / 自己那根 stem。画哪几列由 thread.ts 算好（rowSpines），这里只负责几何 -->
    <div class="thread-lines" aria-hidden="true">
      <span v-for="col in row.rowSpines" :key="col" class="line spine" :style="{ '--col': col }" />
      <!-- 封顶后 col === parentCol：父子同列，没有横线可画，改画一根竖直连接段把上方接进来
           （照原型算 --col-span: max(1, col - parentCol) 会画出一段 32px 的横向悬空尾巴） -->
      <span v-if="row.col > row.parentCol" class="line elbow" :style="{ '--parent-col': row.parentCol, '--col-span': row.col - row.parentCol }" />
      <span v-else-if="row.col > 0" class="line spine capped" :style="{ '--col': row.col }" />
      <!-- 有子树就画 stem（折叠时靠 .branch-collapsed 淡出，元素留着才有淡出而不是闪断） -->
      <span v-if="row.hasChildren" class="line spine stem" :style="{ '--col': row.col }" />
    </div>

    <div class="row-content-body">
      <div class="avatar-slot">
        <!-- 头像即链接：与站点原版一致（`<a target=_blank href=//space.bilibili.com/<mid>>`）点击开主页，
             悬停时由宿主弹站点自己的用户卡片；平台没给主页地址时同一个元素降级成 span。 -->
        <component
          :is="userEntryTag"
          class="avatar"
          :class="{ 'up-avatar': comment.byCreator }"
          :style="{ backgroundColor: avatarBackground }"
          :href="profileUrl ?? undefined"
          :target="profileUrl === null ? undefined : '_blank'"
          :rel="profileUrl === null ? undefined : 'noopener noreferrer'"
          :aria-label="profileUrl === null ? undefined : `打开 ${author} 的主页`"
          @mouseenter="hoverUser($event, true)"
          @mouseleave="hoverUser($event, false)"
        >
          <span class="avatar-ini" aria-hidden="true">{{ initial }}</span>
          <span v-if="avatarUrl" class="avatar-img" aria-hidden="true" :style="{ backgroundImage: `url(${avatarUrl})` }" />
        </component>
      </div>

      <div class="comment-col">
        <div class="head">
          <component
            :is="userEntryTag"
            class="name"
            :class="{ up: comment.byCreator }"
            :href="profileUrl ?? undefined"
            :target="profileUrl === null ? undefined : '_blank'"
            :rel="profileUrl === null ? undefined : 'noopener noreferrer'"
            @mouseenter="hoverUser($event, true)"
            @mouseleave="hoverUser($event, false)"
          >{{ author }}</component>
          <span v-if="comment.byCreator" class="up-tag">UP</span>
          <span v-if="level !== null" class="lv" :class="`lv-${level}`">Lv{{ level }}</span>
          <!-- 关系标记：正文带「回复 @某人：」前缀时显示提及名（原型 .reply-target-tag pill），
               否则保持原样显示父评论作者名。 -->
          <span v-if="parsedComment.mention !== null" class="reply-target-tag">
            <IconArrowBendDownRight /><span>{{ parsedComment.mention }}</span>
          </span>
          <span v-else-if="props.row.node.parent" class="meta reply-to">
            <IconArrowBendDownRight />{{ props.row.node.parent.comment.author.name }}
          </span>
          <span
            v-if="overflowDepth !== null"
            class="meta tnum"
            :title="`缩进已封顶,真实深度 ${overflowDepth} 层`"
          >第 {{ overflowDepth }} 层</span>
          <span v-if="props.busy" class="meta">加载中...</span>
        </div>

        <p class="text"><CommentText :text="parsedComment.body" :emotes="comment.emotes" /></p>

        <div class="foot">
          <span class="meta time">{{ formatRelative(comment.createdAt) }}</span>
          <span v-if="comment.location" class="meta loc"><IconMapPin />{{ comment.location }}</span>
          <button
            type="button"
            class="act like"
            :class="{ liked: props.like.liked }"
            :disabled="props.like.busy"
            :aria-pressed="props.like.liked"
            :title="props.like.liked ? '取消点赞' : '点赞'"
            @click.stop="emit('toggle-like', props.row.id)"
          >
            <IconThumbsUp /><span ref="likeNum" class="tnum">{{ formatCount(props.like.count) }}</span>
          </button>
          <button
            type="button"
            class="act"
            :class="{ on: replyOpen }"
            :aria-expanded="replyOpen"
            :title="replyOpen ? '收起回复框' : `回复 ${author}`"
            @click.stop="toggleReply"
          >
            <IconChatCenteredText />回复
          </button>
          <button
            v-if="props.row.hasChildren"
            type="button"
            class="act fold-act"
            :aria-expanded="!props.row.folded"
            :title="props.row.folded ? '展开这条评论的回复' : '收起这条评论的回复'"
            @click.stop="emit('fold', props.row.id)"
          >
            <IconCaretRight v-if="props.row.folded" />
            <IconCaretDown v-else />
            {{ props.row.folded ? `展开 ${formatCount(props.row.hidden)} 条回复` : '收起回复' }}
          </button>
          <span v-else-if="props.row.node.size > 1" class="stat tnum" title="这条评论下的回复数">
            {{ formatCount(props.row.node.size - 1) }} 条回复
          </span>
          <span class="grow" />
          <button
            type="button"
            class="act analyze"
            title="分析这条评论树"
            aria-label="分析这条评论树"
            @click.stop="emit('analyze', props.row.id)"
          >
            <IconGraph />图谱
          </button>
        </div>

        <!-- 回复抽屉：整块吃掉点击，别把「选中这一行」也一并触发。
             抽屉壳常驻（0fr ↔ 1fr 的轨道过渡才有起止两端，也就不必测高），但**里面的 Composer 只在打开时挂载**：
             阅读器一次可能铺开上千行，给每一行常驻一个 textarea 是白付的内存。代价是关闭不做动画——
             被看见的是打开那一下，关闭即时（与改版前一致）。关着时 inert + aria-hidden，免得 Tab 落到裁掉的输入框。
             Composer 仍由父级受控，props/emits 不变。 -->
        <div
          class="reply-drawer-accordion"
          :class="{ 'is-open': replyOpen }"
          :inert="replyOpen ? undefined : true"
          :aria-hidden="replyOpen ? undefined : 'true'"
          @click.stop
        >
          <div class="reply-drawer-content">
            <div v-if="replyOpen" class="reply">
              <CommentComposer
                :text="replyBox.text"
                :sending="replyBox.sending"
                :error="replyBox.error"
                :placeholder="`回复 @${author}…`"
                submit-label="回复"
                cancellable
                @input="emit('reply-input', props.row.id, $event)"
                @submit="emit('submit-reply', props.row.id, $event)"
                @cancel="emit('close-reply', props.row.id)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
/*
 * 讨论串连接线的几何（全在 CSS 里算，脚本只决定画哪几列）：
 *   每层缩进 --step，行的左内边距 = --indent-base + 视觉列 * --step；
 *   头像槽宽 --avatar-slot、圆片在槽里居中，于是槽中心（= 圆片中心）落在
 *   Xc(col) = --indent-base + col * --step + --slot-center 上，所有线都锚在这条中心线上。
 *   竖脊贯通整行（上下各探 1px 盖住相邻行的接缝），自己那根 stem 从自己头像中心往下垂，
 *   elbow 从父列中心拐到本列中心（左下圆角就是那段弧）。
 *   --depth 由模板按 row.col 注入，明暗/窄屏只改这几个变量，线的 x 自动跟着走。
 */
.comment-row {
  --step: 32px;
  --indent-base: 16px;
  --avatar-slot: 38px;
  --slot-center: 19px;
  --line-w: 2px;
  --pad-top: 14px;
  /* 线色：比 --border 深一档的中性色，明暗两套都看得清，又不跟正文抢眼。
     恒定不变色——悬停整串线变色会把连续的主干切成一段段碎线（旧版病症）。 */
  --line-color: color-mix(in srgb, var(--border-strong) 70%, var(--fg-subtle));

  position: relative;
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  padding: var(--pad-top) var(--sp-3) var(--pad-top) calc(var(--indent-base) + var(--depth, 0) * var(--step));
  background: transparent;
  cursor: pointer;
  transition: background var(--dur-fast) ease;
}

/* 楼中楼整体收密：上下留白小于顶层，像 B 站的楼中楼块 */
.comment-row:not(.root) {
  --pad-top: 10px;
}

/*
 * 选中：不铺成实心卡片（那样显得各自为政）。只给极浅的强调色晕，
 * 近透明底不与 ::selection 的划词高亮撞色。
 */
.comment-row.selected {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

/*
 * 选中只点亮这一行自己的那一截（接上父的 elbow/capped、往下接孩子的 stem），
 * 路过的祖先竖脊保持中性——否则整根主干会跟着行走色，看着像断了。
 */
.comment-row.selected .line.elbow,
.comment-row.selected .line.spine.capped,
.comment-row.selected .line.spine.stem {
  border-color: var(--accent);
}

/* 定位闪烁：宿主按 data-comment-id 找到行后临时挂上这个类，1.4s 自己褪回选中底色 */
.comment-row.flash-highlight {
  animation: row-flash 1.4s ease-out;
}

@keyframes row-flash {
  0% {
    background: color-mix(in srgb, var(--accent) 32%, transparent);
  }

  100% {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
}

/* 连接层：绝对定位铺满整行，只画线，不吃点击 */
.thread-lines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

/* 一根线：统一 2px 描边，改色只改 border-color */
.line {
  position: absolute;
  border-color: var(--line-color);
  pointer-events: none;
}

/* 竖脊：贯通整行（上下各探 1px，把相邻两行的接缝盖住） */
.line.spine {
  left: calc(var(--indent-base) + var(--col) * var(--step) + var(--slot-center) - var(--line-w) / 2);
  width: var(--line-w);
  top: -1px;
  bottom: -1px;
  border-left: var(--line-w) solid var(--line-color);
}

/* 自己那根竖脊：起点严格对准自己头像中心，往下供直接子代接上来 */
.line.spine.stem {
  left: calc(var(--indent-base) + var(--col) * var(--step) + var(--slot-center) - var(--line-w) / 2);
  width: var(--line-w);
  top: calc(var(--pad-top) + var(--slot-center));
  bottom: -1px;
  border-left: var(--line-w) solid var(--line-color);
  transition: opacity var(--dur-fast) ease;
}

/* 折叠态：子树整棵不出行，把这根 stem 淡掉（元素仍在，才是淡出而不是闪断） */
.comment-row.branch-collapsed .line.spine.stem {
  opacity: 0;
  pointer-events: none;
}

/* 封顶列（父子同列）的竖直连接段：只把上方接进来，不画横线 */
.line.spine.capped {
  left: calc(var(--indent-base) + var(--col) * var(--step) + var(--slot-center) - var(--line-w) / 2);
  width: var(--line-w);
  top: -1px;
  bottom: auto;
  height: calc(var(--pad-top) + var(--slot-center) + 1px);
  border-left: var(--line-w) solid var(--line-color);
}

/* elbow：从父列中心拐到本列中心（左下圆角就是那段弧） */
.line.elbow {
  left: calc(var(--indent-base) + var(--parent-col) * var(--step) + var(--slot-center) - var(--line-w) / 2);
  width: calc(var(--step) * var(--col-span, 1) + var(--line-w) / 2);
  top: -1px;
  height: calc(var(--pad-top) + var(--slot-center) + 1px);
  border-left: var(--line-w) solid var(--line-color);
  border-bottom: var(--line-w) solid var(--line-color);
  border-bottom-left-radius: 10px;
}

/* 头像槽：槽中心落在 Xc(col) 上，圆片在槽内居中（大小随根/楼中楼变，中心不动） */
.avatar-slot {
  position: relative;
  z-index: 2;
  flex: none;
  width: var(--avatar-slot);
  height: var(--avatar-slot);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 头像与昵称是链接（点击开主页）：保留原样式，只去掉浏览器默认下划线与系统配色。 */
.avatar,
.name {
  text-decoration: none;
}

a.name:hover {
  color: #00aeec; /* 原生昵称 hover 变品牌蓝 */
}

/* 圆片在头像槽里居中（槽宽固定、圆片大小随根/楼中楼变，中心都不动）。
   类名沿用既有的 .avatar：它是 ADR-0005 里「作者入口」的 DOM 钩子，改名会打断外面的引用。 */
.avatar {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--avatar-slot);
  height: var(--avatar-slot);
  border-radius: 50%;
  overflow: hidden;
  background-color: var(--surface-3);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 6%);
}

/* UP 主的头像：底色走 :style 的 var(--accent-bg)，首字母色在这里（原型 byCreator 分支）。
   底色的另一个来源是昵称哈希色，无法用类表达，故两者分工。 */
.avatar.up-avatar {
  color: var(--accent-strong);
}

/* 楼中楼头像小一档（槽宽不变，中心不动） */
.comment-row:not(.root) .avatar {
  width: 30px;
  height: 30px;
  font-size: 12px;
}

.avatar-ini {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 头像图盖在首字母牌上：加载成功即覆盖；失败（离线/防盗链）露出字母牌 */
.avatar-img {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

/* 头像列 + 内容列：B 站式左右结构 */
.row-content-body {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  flex: 1 1 auto;
  min-width: 0;
}

.comment-col {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 1px 0;
}

.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px var(--sp-2);
  min-height: 20px;
}

/* 昵称 13px 灰字——B 站评论区的基线；UP 主用粉 */
.name {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--fg-muted);
}

.name.up {
  color: #ff6699;
}

.up-tag {
  display: inline-flex;
  align-items: center;
  height: 15px;
  padding: 0 5px;
  border-radius: var(--r-xs);
  background: #ff6699;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

/* 等级：小徽标而不是裸文字，配色沿 0-2 低、3-4 蓝、5-6 粉 */
.lv {
  display: inline-flex;
  align-items: center;
  height: 15px;
  padding: 0 4px;
  border: 1px solid currentcolor;
  border-radius: var(--r-xs);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  opacity: 0.85;
}

.lv-3,
.lv-4 {
  color: #00aeec;
}

.lv-5,
.lv-6 {
  color: #ff6699;
}

/* 楼中楼里的「回复 @某人」：一个安静的箭头关系标记 */
.reply-to {
  color: var(--fg-subtle);
}

/* 正文带「回复 @某人：」前缀时，关系标记升级成原型那个 pill（取值逐字取自原型 .reply-target-tag） */
.reply-target-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  color: var(--accent-strong);
  font-size: var(--fs-xs);
  font-weight: 500;
}

.reply-target-tag svg {
  width: 11px;
  height: 11px;
}

.meta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

.meta svg {
  width: 12px;
  height: 12px;
}

.text {
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 操作行：时间/属地打头，点赞回复居左，图谱沉到右端 */
.foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-3);
  margin-top: 3px;
}

.time {
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

.stat {
  display: inline-flex;
  align-items: center;
  font-size: var(--fs-xs);
  color: var(--fg-subtle);
}

/* 操作 pill：安静的灰字图标按钮，hover 提亮、press 弹簧回弹。
   press 用 --dur-micro（100ms，与原型一致）。 */
.act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  min-width: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--fg-muted);
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease, transform var(--dur-micro, 100ms) var(--ease-spring);
}

.act svg {
  width: 15px;
  height: 15px;
}

.act:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--fg);
}

.act:active:not(:disabled) {
  transform: scale(0.92);
}

.act:disabled {
  cursor: progress;
  opacity: 0.65;
}

/* 点赞选中：强调色胶囊 + 图标弹簧 */
.act.like.liked {
  background: var(--accent-bg);
  color: var(--accent-strong);
  font-weight: 700;
}

.act.like.liked svg {
  animation: like-spring 360ms var(--ease-spring);
}

@keyframes like-spring {
  0% {
    transform: scale(1);
  }

  40% {
    transform: scale(1.32) rotate(-8deg);
  }

  75% {
    transform: scale(0.92) rotate(3deg);
  }

  100% {
    transform: scale(1) rotate(0);
  }
}

/* 计数回弹：类由脚本在计数变化时挂上（挂载首帧不算变化） */
.like-num-pop {
  display: inline-block;
  animation: num-bounce 320ms var(--ease-spring);
}

@keyframes num-bounce {
  0% {
    transform: translateY(0) scale(1);
  }

  35% {
    transform: translateY(-4px) scale(1.18);
    color: var(--accent);
  }

  100% {
    transform: translateY(0) scale(1);
  }
}

/* 回复框开着：pill 上留一个「已激活」的痕迹 */
.act.on {
  background: var(--accent-bg);
  color: var(--accent-strong);
}

/* 「展开 N 条回复」：B 站楼中楼的入口，比左侧小箭头更显眼 */
.fold-act {
  color: var(--fg-subtle);
}

.comment-row.selected .act,
.comment-row.selected .time,
.comment-row.selected .stat {
  color: var(--fg-muted);
}

/* 图谱按钮：克制，默认隐于末端，hover 行或选中时显现 */
.analyze {
  opacity: 0;
  margin-left: 0;
  transition: opacity var(--dur-fast) ease, color var(--dur-fast) ease, background var(--dur-fast) ease;
}

.comment-row:hover .analyze,
.comment-row.selected .analyze,
.analyze:focus-visible {
  opacity: 1;
}

.analyze:hover:not(:disabled) {
  background: var(--accent-bg);
  color: var(--accent);
}

/* 回复抽屉：纯 CSS Grid 收展（0fr → 1fr），不测高、不需要 JS 记高度 */
.reply-drawer-accordion {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-dock) var(--ease-emphasized-decelerate);
}

.reply-drawer-accordion.is-open {
  grid-template-rows: 1fr;
}

.reply-drawer-content {
  overflow: hidden;
  min-height: 0;
}

.reply {
  margin-top: var(--sp-2);
  cursor: default;
}

/* 窄屏：缩进与头像都缩一档，给正文让出宽度（连接线几何跟着这几个变量走） */
@media (max-width: 640px) {
  .comment-row {
    --step: 20px;
    --indent-base: 8px;
    --avatar-slot: 30px;
    --slot-center: 15px;
    padding-right: var(--sp-2);
  }

  .avatar {
    font-size: 13px;
  }

  .comment-row:not(.root) .avatar {
    width: 24px;
    height: 24px;
    font-size: 11px;
  }

  .row-content-body {
    gap: var(--sp-2);
  }

  .text {
    font-size: 14px;
  }
}
</style>

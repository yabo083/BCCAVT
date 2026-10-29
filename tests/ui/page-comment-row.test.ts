// @vitest-environment happy-dom
/**
 * 评论行的渲染与交互测试。两条硬约束在这里盯住：
 *   1) 正文按自然高度完整渲染（不做单行化 / 截断），多级关系靠连接线与父作者提示表达；
 *   2) 点赞 / 回复只 emit 意图（id + 正文），组件自己不发请求——父级才持有乐观状态与草稿。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import PageCommentRow from '@/ui/components/PageCommentRow.vue';
import type { RowLikeState, RowReplyState } from '@/ui/reader-comments';
import type { ThreadRow } from '@/ui/thread';
import type { Comment } from '@/core/model';
import type { CommentNode } from '@/core/report';

/**
 * 组件源码里的样式块。vitest 不把 `.vue` 的 `<style scoped>` 注入文档（`css: false`），
 * 几何变量要断在「计算样式」上就只能自己注入这一份——否则 `--step` 这类自定义属性永远读不到。
 */
const ROW_CSS = /<style scoped>([\s\S]*)<\/style>/.exec(
  readFileSync(resolve(process.cwd(), 'src/ui/components/PageCommentRow.vue'), 'utf8'),
)![1]!;

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = ROW_CSS;
  document.head.append(style);
});

/** 够长的多段正文：单行化或截断都会让下面的断言失败。 */
const LONG_TEXT = `第一段：${'长正文'.repeat(50)}\n\n第二段：${'细节'.repeat(80)}\n结尾。`;

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    rootId: null,
    parentId: null,
    author: { id: 'u1', name: '阿蓝' },
    text: LONG_TEXT,
    createdAt: Date.now() - 60_000,
    likes: 12,
    replyCount: 3,
    ...overrides,
  };
}

function makeRow(overrides: Partial<ThreadRow> = {}): ThreadRow {
  const comment = makeComment();
  const node: CommentNode = { comment, children: [], parent: null, depth: 0, size: 4 };
  return {
    node,
    id: comment.id,
    depth: 0,
    col: 0,
    parentCol: 0,
    rowSpines: [],
    index: 0,
    hasChildren: true,
    folded: false,
    hidden: 0,
    preview: '',
    ...overrides,
  };
}

/** 楼中楼：row 的父节点是那条顶层评论。 */
function makeChildRow(): ThreadRow {
  const parent: CommentNode = { comment: makeComment({ id: 'p1', author: { id: 'u0', name: '楼主' } }), children: [], parent: null, depth: 0, size: 2 };
  const comment = makeComment({ id: 'c2', rootId: 'p1', parentId: 'p1' });
  const node: CommentNode = { comment, children: [], parent, depth: 1, size: 1 };
  return { node, id: comment.id, depth: 1, col: 1, parentCol: 0, rowSpines: [], index: 1, hasChildren: false, folded: false, hidden: 0, preview: '' };
}

interface RowOptions {
  row?: ThreadRow;
  like?: RowLikeState;
  reply?: RowReplyState | null;
  selected?: boolean;
  busy?: boolean;
  subjectUrl?: string;
  sessionUserId?: string;
  /** 挂进 document.body：happy-dom 只对在文档树里的元素算样式，几何断言必须挂上去。 */
  attached?: boolean;
}

function mountRow(options: RowOptions = {}) {
  return mount(PageCommentRow, {
    attachTo: options.attached ? document.body : undefined,
    props: {
      row: options.row ?? makeRow(),
      like: options.like ?? { count: 12, liked: false, disliked: false, busy: false },
      reply: options.reply ?? null,
      selected: options.selected ?? false,
      busy: options.busy ?? false,
      subjectUrl: options.subjectUrl,
      sessionUserId: options.sessionUserId,
    },
  });
}

describe('评论行的层级与正文', () => {
  it('缩进用视觉列 col（封顶后不再右移），超过封顶补一句层级提示', () => {
    const shallow = mountRow({ row: makeRow({ depth: 3, col: 3 }) });
    expect(shallow.get('.comment-row').attributes('style')).toContain('--depth: 3');
    expect(shallow.text()).not.toContain('第 9 层');

    const deep = mountRow({ row: makeRow({ depth: 9, col: 3 }) });
    expect(deep.get('.comment-row').attributes('style')).toContain('--depth: 3');
    expect(deep.get('.comment-row').attributes('style')).not.toContain('--depth: 9');
    expect(deep.text()).toContain('第 9 层');
  });

  it('楼中楼点名父作者，多级关系不靠缩进也能读出来', () => {
    const wrapper = mountRow({ row: makeChildRow() });
    expect(wrapper.get('.head').text()).toContain('楼主');
    expect(wrapper.get('.head').text()).toContain('阿蓝');
  });

  it('长正文完整渲染，不做单行化或截断', () => {
    const wrapper = mountRow();
    const text = wrapper.get('.text');
    expect(text.text()).toBe(LONG_TEXT);
    expect(text.text().length).toBeGreaterThan(250);
  });
});

describe('点赞', () => {
  it('显示计数与点过的状态', () => {
    const plain = mountRow();
    expect(plain.get('.act.like').text()).toBe('12');
    expect(plain.get('.act.like').attributes('aria-pressed')).toBe('false');

    const liked = mountRow({ like: { count: 13, liked: true, disliked: false, busy: false } });
    expect(liked.get('.act.like').text()).toBe('13');
    expect(liked.get('.act.like').attributes('aria-pressed')).toBe('true');
    expect(liked.get('.act.like').classes()).toContain('liked');
  });

  it('点击只发意图，不触发选中；请求在飞时按钮禁用', async () => {
    const wrapper = mountRow();
    await wrapper.get('.act.like').trigger('click');
    expect(wrapper.emitted('toggle-like')?.[0]).toEqual(['c1']);
    expect(wrapper.emitted('select')).toBeUndefined();

    const busy = mountRow({ like: { count: 12, liked: false, disliked: false, busy: true } });
    expect(busy.get('.act.like').attributes('disabled')).toBeDefined();
  });

  it('选中态只换底色，不影响点赞计数', () => {
    const wrapper = mountRow({ selected: true });
    expect(wrapper.get('.comment-row').classes()).toContain('selected');
    expect(wrapper.get('.act.like').text()).toBe('12');
  });
});

describe('回复框', () => {
  it('点回复按钮收起/展开只上报状态，不触发选中（受控：父级不回填抽屉就不开）', async () => {
    const wrapper = mountRow();
    await wrapper.findAll('.act')[2]!.trigger('click');
    expect(wrapper.emitted('open-reply')?.[0]).toEqual(['c1']);
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(wrapper.get('.reply-drawer-accordion').classes()).not.toContain('is-open');

    const open = mountRow({ reply: { text: '草稿', sending: false, error: null } });
    await open.findAll('.act')[2]!.trigger('click');
    expect(open.emitted('close-reply')?.[0]).toEqual(['c1']);
  });

  it('父级给了回复态就展开抽屉，标题点名被回复的人', () => {
    const wrapper = mountRow({ reply: { text: '草稿', sending: false, error: null } });
    expect(wrapper.get('textarea').attributes('placeholder')).toContain('阿蓝');
  });

  it('抽屉壳常驻、只切 is-open；Composer 只在打开时挂载（关着时 inert + 对读屏隐藏）', () => {
    const closed = mountRow();
    const drawer = closed.get('.reply-drawer-accordion');
    // 壳常驻：grid 轨道过渡要有起止两端；但里面的 textarea 不常驻——上千行各挂一个输入框是白付的内存
    expect(closed.find('textarea').exists()).toBe(false);
    expect(drawer.classes()).not.toContain('is-open');
    expect(drawer.attributes('inert')).toBeDefined();
    expect(drawer.attributes('aria-hidden')).toBe('true');

    const open = mountRow({ reply: { text: '草稿', sending: false, error: null } });
    const openDrawer = open.get('.reply-drawer-accordion');
    expect(openDrawer.classes()).toContain('is-open');
    expect(open.find('textarea').exists()).toBe(true);
    expect(openDrawer.attributes('inert')).toBeUndefined();
    expect(openDrawer.attributes('aria-hidden')).toBeUndefined();
  });

  it('输入与提交都把 id + 正文上报给父级', async () => {
    const wrapper = mountRow({ reply: { text: '同意', sending: false, error: null } });
    await wrapper.get('textarea').setValue('同意你的看法');
    expect(wrapper.emitted('reply-input')?.[0]).toEqual(['c1', '同意你的看法']);

    await wrapper.get('.reply .send').trigger('click');
    expect(wrapper.emitted('submit-reply')?.[0]).toEqual(['c1', '同意']);
  });

  it('在回复框里点击 / 输入都不会把这一行选中', async () => {
    const wrapper = mountRow({ reply: { text: '草稿', sending: false, error: null } });
    await wrapper.get('textarea').trigger('click');
    await wrapper.get('.reply').trigger('click');
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('发送中与失败原因都透传（草稿仍在）', () => {
    const wrapper = mountRow({ reply: { text: '草稿', sending: true, error: '评论已被关闭' } });
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.fail').text()).toContain('评论已被关闭');
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('草稿');
  });
});

describe('折叠与图谱', () => {
  it('点折叠只发折叠意图，不触发选中', async () => {
    const wrapper = mountRow();
    await wrapper.get('.fold-act').trigger('click');
    expect(wrapper.emitted('fold')?.[0]).toEqual(['c1']);
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('没有已加载回复时不画折叠开关（缩进后第一个元素就是头像槽，没有多余占位列）', () => {
    const wrapper = mountRow({ row: makeRow({ hasChildren: false }) });
    expect(wrapper.find('.fold-act').exists()).toBe(false);
    expect(wrapper.find('.fold-spacer').exists()).toBe(false);
    expect(wrapper.get('.row-content-body').element.firstElementChild?.className).toBe('avatar-slot');
  });

  it('点正文选中这一行，点图谱把这一行的 id 交给父级', async () => {
    const wrapper = mountRow();
    await wrapper.get('.text').trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual(['c1']);

    await wrapper.get('.analyze').trigger('click');
    expect(wrapper.emitted('analyze')?.[0]).toEqual(['c1']);
  });

  it('图谱入口总是渲染：评论树大小不参与是否出现', () => {
    // makeRow 的 node.size = 4（评论自己 + 3 条回复）
    expect(mountRow().find('.analyze').exists()).toBe(true);
    // 只有自己一条的叶子评论（size 1）同样有入口
    expect(mountRow({ row: makeRow({ node: { comment: makeComment(), children: [], parent: null, depth: 0, size: 1 } }) }).find('.analyze').exists()).toBe(true);
    // 大评论树也一样：不按数量分档
    expect(mountRow({ row: makeRow({ node: { comment: makeComment(), children: [], parent: null, depth: 0, size: 9999 } }) }).find('.analyze').exists()).toBe(true);
  });

  it('图谱入口默认不显示、悬停才显现：DOM 里始终在，隐现只交给 CSS', () => {
    const wrapper = mountRow({ attached: true });
    const button = wrapper.get('.analyze');
    expect(button.attributes('title')).toBe('分析这条评论树');
    expect(button.attributes('aria-label')).toBe('分析这条评论树');
    // 默认透明；hover 行、选中行、键盘聚焦时才显形
    expect(ROW_CSS).toMatch(/\.analyze\s*\{[^}]*opacity:\s*0/);
    expect(ROW_CSS).toContain('.comment-row:hover .analyze');
    expect(ROW_CSS).toContain('.comment-row.selected .analyze');
    expect(ROW_CSS).toContain('.analyze:focus-visible');
  });
});

/** 带主页地址的作者：适配器归一化后总会给（bilibili 即 `space.bilibili.com/<mid>`）。 */
function makeProfileRow(profileUrl = 'https://space.bilibili.com/703148042'): ThreadRow {
  const comment = makeComment({ author: { id: '703148042', name: '阿蓝', profileUrl } });
  const node: CommentNode = { comment, children: [], parent: null, depth: 0, size: 1 };
  return { node, id: comment.id, depth: 0, col: 0, parentCol: 0, rowSpines: [], index: 0, hasChildren: false, folded: false, hidden: 0, preview: '' };
}

describe('作者入口（复刻原生：主页链接 + 悬停交给宿主弹原版卡片）', () => {
  it('头像与昵称都是主页链接：新标签打开、带 noopener，头像有可访问名', () => {
    const wrapper = mountRow({ row: makeProfileRow() });
    const avatar = wrapper.get('a.avatar');
    const name = wrapper.get('a.name');

    expect(avatar.attributes('href')).toBe('https://space.bilibili.com/703148042');
    expect(avatar.attributes('target')).toBe('_blank');
    expect(avatar.attributes('rel')).toBe('noopener noreferrer');
    expect(avatar.attributes('aria-label')).toBe('打开 阿蓝 的主页');
    expect(name.attributes('href')).toBe('https://space.bilibili.com/703148042');
    expect(name.attributes('target')).toBe('_blank');
    expect(name.text()).toBe('阿蓝');
  });

  it('平台没给主页地址时退化成纯展示：不画链接、头像与昵称照旧在', () => {
    const wrapper = mountRow();
    expect(wrapper.find('a.avatar').exists()).toBe(false);
    expect(wrapper.find('a.name').exists()).toBe(false);
    expect(wrapper.get('.avatar').text()).toContain('阿');
    expect(wrapper.get('.name').text()).toBe('阿蓝');
  });

  it('悬停上报「谁 + 在哪」，离开同样带上 mid（`rect: null`）：组件不自己画卡片', async () => {
    const wrapper = mountRow({ row: makeProfileRow() });
    const avatar = wrapper.get('a.avatar');
    vi.spyOn(avatar.element, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 20, width: 44, height: 44, right: 54, bottom: 64, x: 10, y: 20, toJSON: () => ({}),
    } as DOMRect);

    await avatar.trigger('mouseenter');
    expect(wrapper.emitted('user-card')).toEqual([
      [{ mid: '703148042', rect: { left: 10, top: 20, width: 44, height: 44 } }],
    ]);

    await wrapper.get('a.name').trigger('mouseleave');
    expect(wrapper.emitted('user-card')?.at(-1)).toEqual([{ mid: '703148042', rect: null }]);
  });
});

describe('连接线几何（线锚在头像中心 Xc(col)）', () => {
  it('几何变量落在计算样式上：缩进基准、列宽、头像槽与线宽', () => {
    const style = getComputedStyle(mountRow({ attached: true }).get('.comment-row').element);
    expect(style.getPropertyValue('--step').trim()).toBe('32px');
    expect(style.getPropertyValue('--indent-base').trim()).toBe('16px');
    expect(style.getPropertyValue('--avatar-slot').trim()).toBe('38px');
    expect(style.getPropertyValue('--slot-center').trim()).toBe('19px');
    expect(style.getPropertyValue('--line-w').trim()).toBe('2px');
    expect(style.getPropertyValue('--pad-top').trim()).toBe('14px');
  });

  it('楼中楼把上下留白收窄一档（顶层 14px / 楼中楼 10px）', () => {
    const root = getComputedStyle(mountRow({ attached: true }).get('.comment-row').element);
    expect(root.getPropertyValue('--pad-top').trim()).toBe('14px');

    const sub = getComputedStyle(mountRow({ row: makeChildRow(), attached: true }).get('.comment-row').element);
    expect(sub.getPropertyValue('--pad-top').trim()).toBe('10px');
  });

  it('rowSpines 逐列画成贯通竖脊，一根不少', () => {
    const wrapper = mountRow({ row: makeRow({ hasChildren: false, rowSpines: [0, 2] }) });
    const cols = wrapper
      .findAll('.line.spine')
      .filter((line) => !line.classes().includes('stem') && !line.classes().includes('capped'))
      .map((line) => (line.element as HTMLElement).style.getPropertyValue('--col'));
    expect(cols).toEqual(['0', '2']);
  });

  it('未封顶的子回复画 elbow：从父列拐到本列，跨度 = 列差', () => {
    const wrapper = mountRow({ row: makeRow({ depth: 2, col: 2, parentCol: 1, hasChildren: false }) });
    expect(wrapper.find('.line.spine.capped').exists()).toBe(false);

    const elbow = wrapper.get('.line.elbow').element as HTMLElement;
    expect(elbow.style.getPropertyValue('--parent-col')).toBe('1');
    expect(elbow.style.getPropertyValue('--col-span')).toBe('1');
  });

  it('封顶行（col === parentCol）不画 elbow，改画竖直连接段把上方接进来', () => {
    const wrapper = mountRow({ row: makeRow({ depth: 4, col: 3, parentCol: 3, hasChildren: false }) });
    expect(wrapper.find('.line.elbow').exists()).toBe(false);

    const capped = wrapper.get('.line.spine.capped').element as HTMLElement;
    expect(capped.style.getPropertyValue('--col')).toBe('3');
  });

  it('根行没有任何连接线（它是讨论串的起点）', () => {
    const wrapper = mountRow({ row: makeRow({ hasChildren: false }) });
    expect(wrapper.find('.line').exists()).toBe(false);
  });

  it('有子树才画自己的 stem；折叠时 stem 仍在，交给 branch-collapsed 淡出', () => {
    expect(mountRow({ row: makeRow({ hasChildren: false }) }).find('.line.spine.stem').exists()).toBe(false);

    const folded = mountRow({ row: makeRow({ folded: true }) });
    expect(folded.get('.comment-row').classes()).toContain('branch-collapsed');
    const stem = folded.get('.line.spine.stem').element as HTMLElement;
    expect(stem.style.getPropertyValue('--col')).toBe('0');
  });

  it('行上带 data-comment-id：宿主靠它定位并挂 flash-highlight', () => {
    expect(mountRow().get('.comment-row').attributes('data-comment-id')).toBe('c1');
  });
});

/** UP 主（byCreator）的顶层行：头像底色换成品牌强调底，首字母色由 .up-avatar 类给。 */
function makeUpRow(): ThreadRow {
  const comment = makeComment({ byCreator: true });
  const node: CommentNode = { comment, children: [], parent: null, depth: 0, size: 1 };
  return { node, id: comment.id, depth: 0, col: 0, parentCol: 0, rowSpines: [], index: 0, hasChildren: false, folded: false, hidden: 0, preview: '' };
}

/** 「回复 @某人：正文」的楼中楼：父作者（楼主）与提及名（小红）故意不同，好分辨标记显示了谁。 */
function makeMentionRow(text = '回复 @小红：同意你的看法'): ThreadRow {
  const parent: CommentNode = { comment: makeComment({ id: 'p1', author: { id: 'u0', name: '楼主' } }), children: [], parent: null, depth: 0, size: 2 };
  const comment = makeComment({ id: 'c2', rootId: 'p1', parentId: 'p1', text });
  const node: CommentNode = { comment, children: [], parent, depth: 1, size: 1 };
  return { node, id: comment.id, depth: 1, col: 1, parentCol: 0, rowSpines: [], index: 1, hasChildren: false, folded: false, hidden: 0, preview: '' };
}

describe('UP 作者头像与「回复 @某人」前缀', () => {
  it('byCreator 行：头像带 up-avatar 类，底色是品牌强调底', () => {
    const wrapper = mountRow({ row: makeUpRow() });
    const avatar = wrapper.get('.avatar');
    expect(avatar.classes()).toContain('up-avatar');
    expect(avatar.attributes('style')).toContain('var(--accent-bg)');
    expect(wrapper.get('.head').text()).toContain('UP');
  });

  it('普通作者：头像不带 UP 类，底色仍是昵称哈希色（hsl，不是强调底）', () => {
    const avatar = mountRow().get('.avatar');
    expect(avatar.classes()).not.toContain('up-avatar');
    expect(avatar.attributes('style')).toContain('hsl(');
    expect(avatar.attributes('style')).not.toContain('--accent-bg');
  });

  it('带前缀的行：关系标记换成含提及名的 pill，正文不含前缀', () => {
    const wrapper = mountRow({ row: makeMentionRow(), attached: true });
    const pill = wrapper.get('.reply-target-tag');
    expect(pill.text()).toContain('小红');
    expect(pill.text()).not.toContain('楼主');
    expect(pill.classes()).not.toContain('reply-to');
    expect(wrapper.find('.meta.reply-to').exists()).toBe(false);
    expect(wrapper.get('.text').text()).toBe('同意你的看法');
    // pill 的样式取自原型（只有 CSS 里有）：形状是内联 flex 的小胶囊
    expect(getComputedStyle(pill.element).display).toBe('inline-flex');
  });

  it('无前缀的行保持父作者标记，正文完整', () => {
    const wrapper = mountRow({ row: makeChildRow() });
    expect(wrapper.find('.reply-target-tag').exists()).toBe(false);
    expect(wrapper.get('.meta.reply-to').text()).toContain('楼主');
    expect(wrapper.get('.text').text()).toBe(LONG_TEXT);
  });
});


describe('点踩与更多菜单', () => {
  it('点踩按钮发意图、激活态样式、busy 禁用', async () => {
    const w = mountRow({ like: { count: 5, liked: false, disliked: true, busy: false } });
    const btn = w.get('.act.dislike');
    expect(btn.classes()).toContain('disliked');
    await btn.trigger('click');
    expect(w.emitted('toggle-dislike')?.[0]).toEqual(['c1']);
    const busy = mountRow({ like: { count: 5, liked: false, disliked: false, busy: true } });
    expect(busy.get('.act.dislike').attributes('disabled')).toBeDefined();
  });
  it('菜单项按归属显示：他人 3 项（复制链接/拉黑/举报），本人再加删除且两段确认', async () => {
    const other = mountRow({ row: makeRow() });
    await other.get('[aria-label="更多"]').trigger('click');
    expect(other.findAll('.more-item')).toHaveLength(3);
    expect(other.text()).toContain('复制评论链接');
    expect(other.text()).toContain('加入黑名单');
    expect(other.text()).toContain('举报');
    const own = mountRow({ subjectUrl: 'https://www.bilibili.com/video/BV1x', sessionUserId: 'u1' });
    await own.get('[aria-label="更多"]').trigger('click');
    const items = own.findAll('.more-item');
    expect(items).toHaveLength(4);
    await items[0]!.trigger('click');
    expect(own.emitted('copy-link')?.[0]).toEqual(['c1']);
    await own.get('[aria-label="更多"]').trigger('click');
    await own.findAll('.more-item')[3]!.trigger('click');
    expect(own.emitted('delete-comment')).toBeUndefined();
    expect(own.text()).toContain('确认删除');
    await own.findAll('.more-item')[3]!.trigger('click');
    expect(own.emitted('delete-comment')?.[0]).toEqual(['c1']);
  });

  it('加入黑名单两段确认后发 block-user（作者 mid）；举报开对话框并按理由发 report-comment', async () => {
    const w = mountRow({ row: makeRow() });
    await w.get('[aria-label="更多"]').trigger('click');
    // 第一次只是武装
    await w.findAll('.more-item')[1]!.trigger('click');
    expect(w.emitted('block-user')).toBeUndefined();
    expect(w.text()).toContain('确认拉黑');
    await w.findAll('.more-item')[1]!.trigger('click');
    expect(w.emitted('block-user')?.[0]).toEqual(['u1']);

    await w.get('[aria-label="更多"]').trigger('click');
    await w.findAll('.more-item')[2]!.trigger('click');
    // 对话框经 Teleport 挂到 body：选「其他」→ 备注必填；默认「引战」→ 直接提交
    const dialog = document.body.querySelector<HTMLElement>('.report-dialog');
    expect(dialog?.textContent ?? '').toContain('举报评论');
    const submit = dialog!.querySelector<HTMLButtonElement>('.report-btn.primary')!;
    expect(submit.disabled).toBe(false);
    submit.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.emitted('report-comment')?.[0]).toEqual(['c1', 4, undefined]);
  });
});

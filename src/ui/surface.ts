/**
 * UI 承载面的唯一判定处：侧栏面板、整页工作台、页面评论行放大镜打开的图谱窗口。
 * 图谱窗口的地址也在这里拼：store 与嵌入阅读器共用同一份 `view=graph` 契约，不各写一份字符串。
 */
export type Surface = 'panel' | 'tab' | 'graph';

/** 只认扩展自己拼的 `?view=`；缺省与未知值都按侧栏面板处理（窄栏是保守的那一侧）。 */
export function surfaceOf(params: URLSearchParams): Surface {
  const view = params.get('view');
  if (view === 'tab') return 'tab';
  if (view === 'graph') return 'graph';
  return 'panel';
}

/** 图谱窗口地址：满窗力导向图；input 与 comment 必须一起带上，否则窗口不知道该抓哪条评论树。 */
export function graphPopupUrl(appUrl: string, input: string, commentId: string): string {
  const url = new URL(appUrl);
  url.searchParams.set('view', 'graph');
  url.searchParams.set('input', input);
  url.searchParams.set('comment', commentId);
  return url.href;
}

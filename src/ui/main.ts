import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import { createApp } from 'vue';
import App from './App.vue';
import { describeError, init, state } from './store';
import { applyPalette, applyStoredPalette, watchPalette } from './theme';

const app = createApp(App);
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[loupe/ui] 组件错误（${info}）`, error);
};
// 先落配色再挂载：任何失败都照样 mount，界面绝不能因为配色读不出来而挂不上。
void applyStoredPalette()
  .catch(() => {})
  .finally(() => app.mount('#app'));
// 配色只在设置弹窗里改：工作台靠存储事件跟随，不必重开页面（与阅读器同一条路径）。
watchPalette(applyPalette);

void init().catch((error: unknown) => {
  state.notice = { text: describeError(error), tone: 'error' };
});

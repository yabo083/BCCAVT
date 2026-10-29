import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import { createApp } from 'vue';
import EmbeddedComments from './EmbeddedComments.vue';
import { applyStoredPalette } from './theme';

const app = createApp(EmbeddedComments);
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[loupe/embedded] 组件错误（${info}）`, error);
};
// 先落配色再挂载：任何失败都照样 mount，界面绝不能因为配色读不出来而挂不上。
void applyStoredPalette()
  .catch(() => {})
  .finally(() => app.mount('#app'));

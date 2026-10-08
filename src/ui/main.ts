import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import { createApp } from 'vue';
import App from './App.vue';
import { describeError, init, state } from './store';

const app = createApp(App);
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[loupe/ui] 组件错误（${info}）`, error);
};
app.mount('#app');

void init().catch((error: unknown) => {
  state.notice = { text: describeError(error), tone: 'error' };
});

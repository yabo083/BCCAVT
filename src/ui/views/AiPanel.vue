<script setup lang="ts">
/** AI 面板：设置（含权限申请）、连接测试、主体解读（流式 Markdown）与评论树诊断。 */
import { computed, onMounted, ref } from 'vue';
import IconSparkle from '~icons/ph/sparkle';
import IconPlug from '~icons/ph/plug';
import IconFloppyDisk from '~icons/ph/floppy-disk';
import IconEye from '~icons/ph/eye';
import IconEyeSlash from '~icons/ph/eye-slash';
import IconFlag from '~icons/ph/flag';
import IconChatCircleText from '~icons/ph/chat-circle-text';
import IconBrain from '~icons/ph/brain';
import MarkdownView from '../components/MarkdownView.vue';
import StanceLegend from '../components/StanceLegend.vue';
import InfoTip from '../components/InfoTip.vue';
import { ai } from '../services';
import { cancelAi, diagnoseThread, generateInsight, openComment, state } from '../store';
import { hasOriginPermission, requestOriginPermission } from '@/extension/permissions';
import { DEFAULT_AI_SETTINGS } from '@/ai/types';
import type { AiSettings, ConnectionCheck } from '@/ai/types';

const PRESETS: { id: 'deepseek' | 'openai'; label: string; patch: Partial<AiSettings> }[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    patch: {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      extraBody: { thinking: { type: 'disabled' } },
    },
  },
  {
    id: 'openai',
    label: 'OpenAI 兼容',
    patch: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', extraBody: {} },
  },
];

const settings = ref<AiSettings>({ ...DEFAULT_AI_SETTINGS });
const extraBodyText = ref('{}');
const extraBodyError = ref<string | null>(null);
const apiKeyInput = ref('');
const apiKeyDirty = ref(false);
const revealKey = ref(false);
const saving = ref(false);
const checking = ref(false);
const permission = ref<boolean | null>(null);
const checkResult = ref<ConnectionCheck | null>(null);
const message = ref<string | null>(null);
const messageTone = ref<'info' | 'error'>('info');

function parseExtraBody(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, error: `不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '额外请求体必须是 JSON 对象' };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

const effectiveSettings = computed<AiSettings>(() => ({
  ...settings.value,
  apiKey: apiKeyDirty.value ? apiKeyInput.value.trim() : settings.value.apiKey,
}));

onMounted(async () => {
  try {
    const stored = await ai.loadSettings();
    settings.value = stored;
    extraBodyText.value = Object.keys(stored.extraBody).length ? JSON.stringify(stored.extraBody, null, 2) : '{}';
    permission.value = stored.baseUrl ? await hasOriginPermission(stored.baseUrl) : false;
  } catch (error) {
    message.value = `读取设置失败：${error instanceof Error ? error.message : String(error)}`;
    messageTone.value = 'error';
  }
});

function onExtraBodyInput(): void {
  const parsed = parseExtraBody(extraBodyText.value);
  extraBodyError.value = parsed.ok ? null : parsed.error;
}

function applyPreset(preset: (typeof PRESETS)[number]): void {
  settings.value = { ...settings.value, ...preset.patch };
  extraBodyText.value = JSON.stringify(settings.value.extraBody, null, 2);
  extraBodyError.value = null;
}

/** 同步校验接口地址：非法 URL 直接拦下，避免在权限申请里抛错。 */
function parseBaseUrl(value: string): { ok: true; url: string } | { ok: false; error: string } {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: '接口地址必须是 http(s) 链接' };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: '接口地址不是合法 URL' };
  }
}

async function save(): Promise<void> {
  const parsed = parseExtraBody(extraBodyText.value);
  if (!parsed.ok) {
    extraBodyError.value = parsed.error;
    return;
  }
  const baseUrl = parseBaseUrl(settings.value.baseUrl);
  if (!baseUrl.ok) {
    message.value = baseUrl.error;
    messageTone.value = 'error';
    return;
  }
  // 权限申请必须是点击处理里的第一个 await，否则用户手势已失效。
  const granted = await requestOriginPermission(baseUrl.url);
  if (!granted) {
    message.value = '未授予该地址的主机权限，AI 请求会被浏览器拦截';
    messageTone.value = 'error';
    return;
  }
  permission.value = true;
  saving.value = true;
  try {
    const next: AiSettings = { ...effectiveSettings.value, baseUrl: baseUrl.url, extraBody: parsed.value };
    await ai.saveSettings(next);
    settings.value = next;
    apiKeyDirty.value = false;
    apiKeyInput.value = '';
    message.value = '已保存';
    messageTone.value = 'info';
  } catch (error) {
    message.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    messageTone.value = 'error';
  } finally {
    saving.value = false;
  }
}

async function test(): Promise<void> {
  const parsed = parseExtraBody(extraBodyText.value);
  if (!parsed.ok) {
    extraBodyError.value = parsed.error;
    return;
  }
  const baseUrl = parseBaseUrl(settings.value.baseUrl);
  if (!baseUrl.ok) {
    message.value = baseUrl.error;
    messageTone.value = 'error';
    return;
  }
  const granted = await requestOriginPermission(baseUrl.url);
  if (!granted) {
    message.value = '未授予该地址的主机权限，无法测试';
    messageTone.value = 'error';
    return;
  }
  checking.value = true;
  checkResult.value = null;
  try {
    checkResult.value = await ai.checkConnection(
      { ...effectiveSettings.value, baseUrl: baseUrl.url, extraBody: parsed.value },
      new AbortController().signal,
    );
  } catch (error) {
    checkResult.value = { ok: false, latencyMs: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    checking.value = false;
  }
}

function chipLabels(id: string): string | undefined {
  const node = state.thread?.forest.byId.get(id) ?? state.subject?.forest.byId.get(id);
  return node?.comment.author.name;
}

const fallacyNotes = computed(() => state.diagnosis?.fallacies ?? []);
</script>

<template>
  <div class="stack view">
    <div class="columns">
      <section class="card stack">
        <div class="card-head">
          <h2 class="card-title"><IconSparkle /> AI 设置</h2>
          <span v-if="permission !== null" class="chip" :class="permission ? 'chip-success' : 'chip-warning'">
            {{ permission ? '已授权' : '未授权' }}
          </span>
        </div>

        <label class="checkbox">
          <input v-model="settings.enabled" type="checkbox" />
          启用 AI 解读
        </label>

        <div class="row wrap">
          <button
            v-for="preset in PRESETS"
            :key="preset.id"
            type="button"
            class="btn btn-sm btn-tonal"
            @click="applyPreset(preset)"
          >
            {{ preset.label }}
          </button>
        </div>

        <div class="field">
          <label for="ai-base">接口地址</label>
          <input id="ai-base" v-model="settings.baseUrl" class="input" type="url" placeholder="https://api.deepseek.com/v1" />
          <span class="hint">不含 /chat/completions，会自动补上</span>
        </div>

        <div class="field">
          <label for="ai-key">API 密钥</label>
          <div class="row">
            <input
              id="ai-key"
              v-model="apiKeyInput"
              class="input grow"
              :type="revealKey ? 'text' : 'password'"
              autocomplete="off"
              :placeholder="settings.apiKey ? '已保存（留空则不修改）' : 'sk-…'"
              @input="apiKeyDirty = true"
            />
            <button
              type="button"
              class="btn btn-icon"
              :title="revealKey ? '隐藏' : '显示输入内容'"
              @click="revealKey = !revealKey"
            >
              <IconEyeSlash v-if="revealKey" />
              <IconEye v-else />
            </button>
          </div>
          <span class="hint">密钥只写入 chrome.storage.local，不进缓存、不进日志</span>
        </div>

        <div class="row">
          <div class="field grow">
            <label for="ai-model">模型</label>
            <input id="ai-model" v-model="settings.model" class="input" type="text" />
          </div>
          <div class="field grow">
            <label for="ai-max">输入字符上限</label>
            <input id="ai-max" v-model.number="settings.maxInputChars" class="input tnum" type="number" min="500" step="500" />
          </div>
        </div>

        <div class="field">
          <label for="ai-extra" class="row">
            额外请求体
            <InfoTip text="合并进 /chat/completions 请求体的 JSON 对象。例如 DeepSeek 关闭思考：{&quot;thinking&quot;:{&quot;type&quot;:&quot;disabled&quot;}}" />
          </label>
          <textarea id="ai-extra" v-model="extraBodyText" class="textarea" spellcheck="false" @input="onExtraBodyInput" />
          <span v-if="extraBodyError" class="hint error-text">{{ extraBodyError }}</span>
        </div>

        <div class="row wrap">
          <button type="button" class="btn btn-primary" :disabled="saving || !!extraBodyError" @click="save">
            <IconFloppyDisk />
            保存
          </button>
          <button type="button" class="btn" :disabled="checking || !settings.baseUrl" @click="test">
            <IconPlug />
            测试连接
          </button>
          <span v-if="message" class="small" :class="messageTone === 'error' ? 'error-text' : 'subtle'">{{ message }}</span>
        </div>

        <p v-if="checkResult" class="small" :class="checkResult.ok ? 'ok-text' : 'error-text'">
          {{ checkResult.ok ? `连接正常 · ${checkResult.latencyMs} 毫秒` : `连接失败：${checkResult.error ?? '未知原因'}` }}
        </p>
      </section>

      <div class="stack column">
        <section class="card stack">
          <div class="card-head">
            <h2 class="card-title"><IconChatCircleText /> 评论区解读</h2>
            <span v-if="state.insight?.cached" class="chip chip-info">缓存命中</span>
          </div>
          <p v-if="!state.subject" class="empty">先分析一个视频的评论区，再回来生成解读。</p>
          <template v-else>
            <div class="row wrap">
              <button type="button" class="btn btn-tonal" :disabled="!settings.enabled || !!state.ai.busy" @click="generateInsight">
                <IconSparkle />
                生成解读
              </button>
              <button v-if="state.ai.busy === 'insight'" type="button" class="btn btn-sm btn-danger" @click="cancelAi">
                停止
              </button>
              <span v-if="!settings.enabled" class="hint">先在左侧启用 AI</span>
            </div>
            <p v-if="state.ai.error" class="small error-text">{{ state.ai.error }}</p>
            <MarkdownView
              v-if="state.insight"
              :markdown="state.insight.markdown"
              :label-of="chipLabels"
              @open-comment="openComment"
            />
            <p v-else class="empty">解读会以流式 Markdown 出现；其中的评论引用可以直接点击跳转。</p>
          </template>
        </section>

        <section class="card stack">
          <div class="card-head">
            <h2 class="card-title"><IconBrain /> 评论树诊断</h2>
            <span v-if="state.diagnosis?.cached" class="chip chip-info">缓存命中</span>
          </div>
          <p v-if="!state.thread" class="empty">先分析一条评论的评论树，再回来诊断讨论走向。</p>
          <template v-else>
            <div class="row wrap">
              <button type="button" class="btn btn-tonal" :disabled="!settings.enabled || !!state.ai.busy" @click="diagnoseThread">
                <IconBrain />
                诊断讨论
              </button>
              <span v-if="state.diagnosis" class="chip">{{ state.diagnosis.model }}</span>
            </div>
            <template v-if="state.diagnosis">
              <p class="summary">{{ state.diagnosis.summary }}</p>
              <StanceLegend :stances="state.diagnosis.stances" />
              <p v-if="state.diagnosis.consensus" class="small muted">共识：{{ state.diagnosis.consensus }}</p>

              <div v-if="state.diagnosis.turningPoints.length" class="stack">
                <span class="small subtle"><IconFlag class="inline-icon" /> 讨论转折点</span>
                <div class="row wrap">
                  <button
                    v-for="id in state.diagnosis.turningPoints"
                    :key="id"
                    type="button"
                    class="chip chip-warning ref-chip"
                    @click="openComment(id)"
                  >
                    <IconChatCircleText />
                    {{ chipLabels(id) ?? id }}
                  </button>
                </div>
              </div>

              <ul v-if="fallacyNotes.length" class="notes">
                <li v-for="note in fallacyNotes" :key="note.commentId + note.type" class="row wrap">
                  <button type="button" class="chip chip-accent ref-chip" @click="openComment(note.commentId)">
                    <IconChatCircleText />
                    {{ chipLabels(note.commentId) ?? note.commentId }}
                  </button>
                  <span class="chip chip-warning">{{ note.type }}</span>
                  <span class="small">{{ note.note }}</span>
                </li>
              </ul>
            </template>
            <p v-else class="empty">诊断会给出立场分组（同时给评论树着色）、谬误标注与讨论转折点。</p>
          </template>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view {
  gap: var(--sp-3);
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--sp-3);
  align-items: start;
}

@media (min-width: 720px) {
  .columns {
    grid-template-columns: minmax(280px, 1fr) minmax(0, 1.2fr);
  }
}

.summary {
  margin: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-normal);
}

.notes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.ref-chip {
  border: 0;
  cursor: pointer;
}

.inline-icon {
  width: 13px;
  height: 13px;
  vertical-align: -2px;
}

.error-text {
  color: var(--error);
}

.ok-text {
  color: var(--success);
}
</style>

<script setup lang="ts">
/** 平台登录态：已登录显示昵称与等级；未登录给出「登录」动作；点击可刷新。 */
import IconUserCircle from '~icons/ph/user-circle';
import IconSignIn from '~icons/ph/sign-in';
import IconCircleNotch from '~icons/ph/circle-notch';
import { loadSession, openLoginPage, state } from '../store';

function onChipClick(): void {
  void loadSession();
}
</script>

<template>
  <span class="row session">
    <span v-if="state.sessionError" class="chip chip-error" :title="state.sessionError">登录态读取失败</span>
    <button v-else-if="!state.session" type="button" class="chip" title="重新读取登录态" @click="onChipClick">
      <IconCircleNotch class="spinner" />
      读取登录态
    </button>
    <button v-else-if="state.session.loggedIn" type="button" class="chip chip-success" title="点击刷新登录态" @click="onChipClick">
      <IconUserCircle />
      {{ state.session.user?.name ?? '已登录' }}
      <span v-if="state.session.user?.level !== undefined" class="tnum">Lv{{ state.session.user.level }}</span>
    </button>
    <template v-else>
      <button type="button" class="chip" title="点击刷新登录态" @click="onChipClick">未登录</button>
      <button type="button" class="btn btn-sm btn-tonal" @click="openLoginPage">
        <IconSignIn />
        登录
      </button>
    </template>
  </span>
</template>

<style scoped>
.session {
  gap: var(--sp-1);
}

.session button.chip {
  border: 0;
  cursor: pointer;
}
</style>

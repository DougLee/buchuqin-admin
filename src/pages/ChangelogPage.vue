<script setup lang="ts">
import { onMounted, ref } from "vue";
import { markRead, sortedEntries, isUnread } from "../changelog";

/**
 * 更新日志（道哥 2026-09-22）：内容随代码内置、倒序列表只读。
 * 进入本页即标记已读（消侧栏菜单红点，判定逻辑在 changelog.ts 共用）。
 */
const entries = sortedEntries();
const unread = ref(false);
onMounted(() => {
  unread.value = isUnread();
  if (unread.value) markRead();
});
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <p class="eyebrow">CHANGELOG</p>
        <h1>更新日志</h1>
        <p>系统一直在迭代——每次发版这里都会记录改了什么。</p>
      </div>
    </div>
    <div class="cl-list">
      <article v-for="e in entries" :key="e.date + e.title" class="cl-item">
        <header>
          <span class="cl-date">{{ e.date }}</span>
          <strong>{{ e.title }}</strong>
        </header>
        <ul>
          <li v-for="it in e.items" :key="it">{{ it }}</li>
        </ul>
      </article>
    </div>
  </div>
</template>
<style scoped>
.cl-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}
.cl-item {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 18px 22px;
}
.cl-item header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 8px;
}
.cl-date {
  font-size: 13px;
  color: #07883b;
  font-variant-numeric: tabular-nums;
}
.cl-item ul {
  margin: 0;
  padding-left: 20px;
}
.cl-item li {
  font-size: 14px;
  line-height: 1.9;
  color: #334155;
}
</style>

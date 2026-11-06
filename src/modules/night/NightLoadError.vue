<script setup lang="ts">
defineProps<{ message: string; loading?: boolean }>();
defineEmits<{ (event: 'retry'): void }>();
</script>
<template>
  <ElAlert v-if="message" class="night-load-error" title="数据加载失败" type="error" :closable="false" show-icon>
    <p>{{ message }}。已有内容可能不是最新结果。</p>
    <ElButton :loading="loading" @click="$emit('retry')">重新加载</ElButton>
  </ElAlert>
</template>
<style scoped>
.night-load-error { margin: 16px 0; }
.night-load-error p { margin: 4px 0 12px; }
</style>

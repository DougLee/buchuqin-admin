<script setup lang="ts">
import { useRoute } from "vue-router";
import { menuTree } from "../session";
const route = useRoute();
</script>
<template><div class="workspace"><h1>{{ route.meta.configurationError ? '页面尚未配置' : '当前页面不可访问' }}</h1><p>{{ route.meta.configurationError ? '该菜单未绑定有效页面，请联系超级管理员修改页面组件。' : '页面可能尚未授权或权限已变更，请选择已授权菜单或联系超级管理员。' }}</p><RouterLink v-if="menuTree.some(m => m.type === 1 && m.authorized !== false)" class="btn ghost" :to="menuTree.find(m => m.type === 1 && m.authorized !== false)?.path || '/'">打开已授权页面</RouterLink></div></template>

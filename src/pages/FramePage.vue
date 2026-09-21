<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
// Cached frames belong to this route; background navigation must not reload them.
const url = String(route.meta.frameUrl || '');
const title = String(route.meta.title || '外链页面');
</script>
<template><iframe :src="url" :title="title" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" referrerpolicy="no-referrer" style="width:100%;height:calc(100vh - 100px);border:0" /></template>

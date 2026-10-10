<script setup lang="ts">
import DataPage from "../../pages/DataPage.vue";

/**
 * Temporary migration adapter for sections not yet extracted from DataPage.
 * It is intentionally internal: new business modules must not import DataPage directly.
 */
defineProps<{ section: string }>();
</script>

<template><DataPage :fixed-section="section" /></template>

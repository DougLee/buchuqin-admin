<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchOperationalCampuses, type CampusOption } from "../../dicts";
import { isPlatform, switchableCampuses } from "../../session";

defineProps<{ modelValue: string }>();
const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "change", value: string): void;
}>();
const options = ref<CampusOption[]>([]);
const ready = ref(false);
const visible = computed(() => isPlatform.value || switchableCampuses.value.length > 1);
onMounted(async () => {
  if (!visible.value) return;
  try { options.value = await fetchOperationalCampuses(); ready.value = true; }
  catch { ready.value = false; }
});
function change(value: string) {
  emit("update:modelValue", value);
  emit("change", value);
}
</script>

<template>
  <ElSelect v-if="visible && ready" class="filter-btn" :model-value="modelValue" placeholder="全部授权校区" clearable aria-label="选择校区" @change="change(String($event ?? ''))">
    <ElOption label="全部授权校区" value="" />
    <ElOption v-for="campus in options" :key="campus.id" :label="campus.shortName || campus.name" :value="campus.id" />
  </ElSelect>
</template>

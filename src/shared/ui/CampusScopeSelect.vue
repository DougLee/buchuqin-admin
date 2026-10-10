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
  <select v-if="visible && ready" class="filter-btn" :value="modelValue" aria-label="选择校区" @change="change(($event.target as HTMLSelectElement).value)">
    <option value="">全部授权校区</option>
    <option v-for="campus in options" :key="campus.id" :value="campus.id">{{ campus.shortName || campus.name }}</option>
  </select>
</template>

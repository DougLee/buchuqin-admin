<script setup lang="ts">
import type { PickingLine } from "../model";

defineProps<{ lines: PickingLine[]; modelValue: number[] }>();
const emit = defineEmits<{ (event: "update:modelValue", value: number[]): void }>();
function toggle(index: number, selected: number[]) {
  emit("update:modelValue", selected.includes(index) ? selected.filter((item) => item !== index) : [...selected, index]);
}
</script>

<template>
  <div class="picking-checklist">
    <span class="field-label picking-checklist__title"><b>拣货清单（按库位排序）</b><em>{{ modelValue.length }} / {{ lines.length }}</em></span>
    <ul>
      <li v-for="line in lines" :key="line.sourceIndex" :class="{ picked: modelValue.includes(line.sourceIndex) }">
        <label><input type="checkbox" :checked="modelValue.includes(line.sourceIndex)" @change="toggle(line.sourceIndex, modelValue)" /><em v-if="line.location">{{ line.location }}</em><span>{{ line.name }} ×{{ line.quantity }}</span></label>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.picking-checklist { display: grid; gap: 8px; margin-top: 6px; }
.picking-checklist__title { display: flex; justify-content: space-between; align-items: center; }
.picking-checklist__title em { color: var(--brand); font-style: normal; font-weight: 800; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
li { padding: 8px 10px; background: #f6faf7; border: 1px solid #e2eae5; border-radius: 10px; font-size: 14px; }
li.picked { background: #e6f5eb; border-color: #94cdaa; }
li.picked label > span { color: #527064; text-decoration: line-through; }
label { width: 100%; min-height: 38px; display: flex; align-items: center; gap: 10px; cursor: pointer; }
input { width: 22px; height: 22px; flex: none; accent-color: var(--brand); }
label > em { flex: none; padding: 2px 8px; border-radius: 6px; background: #e3f0ea; color: #2c6350; font-size: 12px; font-style: normal; font-weight: 700; }
</style>

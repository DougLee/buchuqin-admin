<script setup lang="ts">
import { ref } from "vue";
import { uploadImage } from "../api";
import { resolveImageUrl } from "../utils/image";
/**
 * 身份证照片字段（IKEAGE 楼长招募）：人像面 / 国徽面双槽位上传。
 * 运营线下收集后代录，C 端不采集、候选人不可见——不复用 ProductImagesField
 * （其文案为商品详情页语境，且上移/下移排序语义不适用于两证面）。
 * v-model 绑定 URL 数组：[0]=人像面、[1]=国徽面；更新时仅裁「尾部空位」，
 * 保留「人像空、国徽有」的占位（["", url]），重开抽屉槽位不错位。
 */
const props = defineProps<{ modelValue: string[]; folder?: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void;
}>();

const SLOTS = [
  { key: "front", label: "人像面", tip: "头像信息一面" },
  { key: "back", label: "国徽面", tip: "国徽图案一面" },
] as const;

const fileInput = ref<HTMLInputElement>();
const activeSlot = ref(0),
  uploadingSlot = ref(-1),
  error = ref("");

function urlAt(index: number): string {
  return props.modelValue[index] ?? "";
}
function pick(index: number) {
  if (uploadingSlot.value !== -1) return;
  activeSlot.value = index;
  error.value = "";
  fileInput.value?.click();
}
async function onChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重选同一文件
  if (!file) return;
  uploadingSlot.value = activeSlot.value;
  try {
    setAt(activeSlot.value, await uploadImage(file, props.folder));
  } catch (err) {
    error.value = err instanceof Error ? err.message : "上传失败";
  } finally {
    uploadingSlot.value = -1;
  }
}
function setAt(index: number, url: string) {
  const next = [urlAt(0), urlAt(1)];
  next[index] = url;
  while (next.length > 0 && !next[next.length - 1]) next.pop();
  emit("update:modelValue", next);
}
</script>
<template>
  <div class="idcard-field">
    <p class="idcard-field__hint">
      上传身份证人像面与国徽面；运营线下收集后代录，候选人不可见。
    </p>
    <div class="idcard-field__slots">
      <div
        v-for="(slot, i) in SLOTS"
        :key="slot.key"
        class="idcard-field__slot"
      >
        <span class="idcard-field__tag">{{ slot.label }}</span>
        <img
          v-if="urlAt(i)"
          class="idcard-field__img"
          :src="resolveImageUrl(urlAt(i))"
          :alt="`身份证${slot.label}`"
          loading="lazy"
        />
        <button
          v-else
          type="button"
          class="idcard-field__empty"
          :disabled="uploadingSlot === i"
          @click="pick(i)"
        >
          {{ uploadingSlot === i ? "上传中…" : `＋ 上传${slot.label}` }}
          <small>{{ slot.tip }}</small>
        </button>
        <div v-if="urlAt(i)" class="idcard-field__ops">
          <button
            type="button"
            :disabled="uploadingSlot === i"
            @click="pick(i)"
          >
            {{ uploadingSlot === i ? "上传中…" : "重传" }}
          </button>
          <button type="button" class="danger" @click="setAt(i, '')">
            删除
          </button>
        </div>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/jpg,image/webp"
      hidden
      @change="onChange"
    />
    <p v-if="error" class="idcard-field__error">{{ error }}</p>
  </div>
</template>
<style scoped>
.idcard-field {
  display: grid;
  gap: 8px;
}
.idcard-field__hint {
  margin: 0;
  font-size: 12px;
  color: #7a8a83;
}
.idcard-field__slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.idcard-field__slot {
  display: grid;
  gap: 7px;
  padding: 8px;
  border: 1px solid #e3e9e5;
  border-radius: 12px;
  background: #fbfdfc;
  min-width: 0;
}
.idcard-field__tag {
  justify-self: start;
  font-size: 11px;
  font-weight: 700;
  color: #0c7a3e;
  background: #e7f5ec;
  border-radius: 999px;
  padding: 2px 9px;
}
.idcard-field__empty {
  aspect-ratio: 1.586; /* 二代身份证 85.6×54mm 同比例占位 */
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px dashed #9db3aa;
  border-radius: 10px;
  background: #f4f8f6;
  color: #2c4a42;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.idcard-field__empty small {
  font-size: 10px;
  font-weight: 400;
  color: #7a8a83;
}
.idcard-field__empty:disabled {
  opacity: 0.5;
  cursor: default;
}
.idcard-field__img {
  display: block;
  width: 100%;
  aspect-ratio: 1.586;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid #e3e9e5;
  background: #fff;
}
.idcard-field__ops {
  display: flex;
  gap: 6px;
}
.idcard-field__ops button {
  flex: 1;
  border: 1px solid #d5ded9;
  background: #fff;
  border-radius: 8px;
  padding: 5px 0;
  font-size: 12px;
  cursor: pointer;
  color: #33504a;
}
.idcard-field__ops button:disabled {
  opacity: 0.4;
  cursor: default;
}
.idcard-field__ops button.danger {
  color: #b0392f;
  border-color: #e7c4c0;
}
.idcard-field__error {
  margin: 0;
  font-size: 12px;
  color: #b0392f;
}
@media (max-width: 400px) {
  .idcard-field__slots {
    grid-template-columns: 1fr;
  }
}
</style>

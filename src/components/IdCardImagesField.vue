<script setup lang="ts">
import { ref } from "vue";
import type { UploadFile } from "element-plus";
import { uploadImage } from "../api";
import { resolveImageUrl } from "../utils/image";
/**
 * 身份证照片字段（IKEAGE 楼长招募）：人像面 / 国徽面双槽位上传。
 * 运营线下收集后代录，C 端不采集、候选人不可见——不复用 ProductImagesField
 * （其文案为商品详情页语境，且上移/下移排序语义不适用于两证面）。
 * v-model 绑定 URL 数组：[0]=人像面、[1]=国徽面；更新时仅裁「尾部空位」，
 * 保留「人像空、国徽有」的占位（["", url]），重开抽屉槽位不错位。
 */
const props = defineProps<{ modelValue: string[] }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void;
}>();

const SLOTS = [
  { key: "front", label: "人像面", tip: "头像信息一面" },
  { key: "back", label: "国徽面", tip: "国徽图案一面" },
] as const;

const uploadingSlot = ref(-1),
  error = ref("");

function urlAt(index: number): string {
  return props.modelValue[index] ?? "";
}
async function onChange(uploadFile: UploadFile, index: number) {
  const file = uploadFile.raw;
  if (!file) return;
  error.value = "";
  uploadingSlot.value = index;
  try {
    setAt(index, await uploadImage(file, "app/idcard"));
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
        <ElImage
          v-if="urlAt(i)"
          class="idcard-field__img"
          :src="resolveImageUrl(urlAt(i))"
          :preview-src-list="[resolveImageUrl(urlAt(i))]"
          preview-teleported
          hide-on-click-modal
          fit="cover"
          :alt="`身份证${slot.label}`"
        />
        <ElUpload
          v-else
          class="idcard-field__uploader"
          :auto-upload="false"
          :show-file-list="false"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          :disabled="uploadingSlot !== -1"
          :on-change="(file: UploadFile) => onChange(file, i)"
        ><ElButton class="idcard-field__empty" :loading="uploadingSlot === i">＋ 上传{{ slot.label }}<small>{{ slot.tip }}</small></ElButton></ElUpload>
        <div v-if="urlAt(i)" class="idcard-field__ops">
          <ElUpload :auto-upload="false" :show-file-list="false" accept="image/png,image/jpeg,image/jpg,image/webp" :disabled="uploadingSlot !== -1" :on-change="(file: UploadFile) => onChange(file, i)"><ElButton size="small" :loading="uploadingSlot === i">重传</ElButton></ElUpload>
          <ElButton size="small" type="danger" plain @click="setAt(i, '')">删除</ElButton>
        </div>
      </div>
    </div>
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
.idcard-field__uploader,
.idcard-field__uploader :deep(.el-upload) { width: 100%; }
.idcard-field__empty :deep(span) { display: flex; flex-direction: column; align-items: center; gap: 4px; }
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

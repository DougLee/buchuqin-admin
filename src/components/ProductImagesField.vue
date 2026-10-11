<script setup lang="ts">
import { ref } from "vue";
import type { UploadFile } from "element-plus";
import { uploadImage } from "../api";
import { resolveImageUrl } from "../utils/image";
/**
 * 商品详情多图（IK9SNS）：v-model 绑定 URL 数组（顺序即小程序详情页轮播顺序）。
 * 追加走 COS 上传；每张可上移/下移/删除，上限 9 张。
 * folder 缺省 uploads/，商品素材传 app/product（IK9VBM）。
 */
const props = defineProps<{ modelValue: string[]; folder?: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string[]): void;
}>();
const MAX_IMAGES = 9;
const uploading = ref(false),
  error = ref("");
function mutate(next: string[]) {
  emit("update:modelValue", next);
}
async function onPick(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file || props.modelValue.length >= MAX_IMAGES) return;
  uploading.value = true;
  error.value = "";
  try {
    mutate([...props.modelValue, await uploadImage(file, props.folder)]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}
function move(index: number, delta: -1 | 1) {
  const target = index + delta;
  if (target < 0 || target >= props.modelValue.length) return;
  const next = [...props.modelValue];
  [next[index], next[target]] = [next[target], next[index]];
  mutate(next);
}
function remove(index: number) {
  mutate(props.modelValue.filter((_, i) => i !== index));
}
</script>
<template>
  <div class="multi-img">
    <p class="multi-img__hint">
      共 {{ modelValue.length }}/{{ MAX_IMAGES }} 张；首张为详情页首屏，空则回退商品头图。
    </p>
    <ul v-if="modelValue.length" class="multi-img__list">
      <li v-for="(url, i) in modelValue" :key="`${i}-${url}`">
        <img :src="resolveImageUrl(url)" :alt="`详情图 ${i + 1}`" loading="lazy" />
        <div class="multi-img__ops">
          <ElButton size="small" :disabled="i === 0" @click="move(i, -1)">上移</ElButton>
          <ElButton
            size="small"
            :disabled="i === modelValue.length - 1"
            @click="move(i, 1)"
          >
            下移
          </ElButton>
          <ElButton size="small" type="danger" plain @click="remove(i)">删除</ElButton>
        </div>
      </li>
    </ul>
    <p v-else class="multi-img__empty">未配置详情多图，用户端详情页仅展示头图。</p>
    <div v-if="modelValue.length < MAX_IMAGES" class="multi-img__append">
      <ElUpload
        :auto-upload="false"
        :show-file-list="false"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        :on-change="onPick"
      ><ElButton class="multi-img__upload" :loading="uploading">＋ 上传详情图</ElButton></ElUpload>
      <span v-if="error" class="multi-img__error">{{ error }}</span>
    </div>
  </div>
</template>
<style scoped>
.multi-img__hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #7a8a83;
}
.multi-img__list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: grid;
  gap: 8px;
}
.multi-img__list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 1px solid #e3e9e5;
  border-radius: 10px;
  background: #fbfdfc;
}
.multi-img__list img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 8px;
  flex: none;
}
.multi-img__ops {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.multi-img__empty {
  margin: 0 0 10px;
  font-size: 12px;
  color: #93a29b;
}
.multi-img__append {
  border-top: 1px dashed #dfe7e2;
  padding-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.multi-img__upload { border-style: dashed; }
.multi-img__error {
  font-size: 12px;
  color: #b0392f;
}
</style>

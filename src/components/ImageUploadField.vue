<script setup lang="ts">
import { ref } from "vue";
import type { UploadFile } from "element-plus";
import { uploadImage } from "../api";
import { resolveImageUrl } from "../utils/image";
/**
 * COS 图片上传字段（IK9RWX，ADR-0003）：上传按钮 + URL 手输兜底 + 缩略预览。
 * v-model 绑定 URL 字符串；商品头图 / 类别图 / Banner 图三处复用。
 * folder=app 时落 COS app/ 目录（Banner 背景图等小程序素材，IK9VBI）。
 */
const props = defineProps<{ modelValue: string; folder?: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();
const uploading = ref(false),
  error = ref("");
async function onPick(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    emit("update:modelValue", await uploadImage(file, props.folder));
  } catch (err) {
    error.value = err instanceof Error ? err.message : "上传失败";
  } finally {
    uploading.value = false;
  }
}
</script>
<template>
  <div class="img-field">
    <div class="img-field__row">
      <ElUpload
        :auto-upload="false"
        :show-file-list="false"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        :on-change="onPick"
      ><ElButton class="img-field__btn" :loading="uploading">上传图片</ElButton></ElUpload>
      <ElInput
        class="img-field__url"
        :model-value="modelValue"
        clearable
        placeholder="或直接粘贴图片 URL"
        @input="emit('update:modelValue', String($event).trim())"
      />
    </div>
    <div v-if="modelValue" class="img-field__preview">
      <ElImage
        class="img-field__thumb"
        :src="resolveImageUrl(modelValue)"
        :preview-src-list="[resolveImageUrl(modelValue)]"
        preview-teleported
        hide-on-click-modal
        fit="cover"
        alt="图片预览"
      />
      <!-- IKC1AA：一键清除（保存后即落「恢复默认」语义，如类别图回退默认图标） -->
      <ElButton
        plain
        type="danger"
        class="img-field__clear"
        @click="emit('update:modelValue', '')"
      >
        清除
      </ElButton>
    </div>
    <p v-if="error" class="form-hint">{{ error }}</p>
  </div>
</template>
<style scoped>
.img-field {
  display: grid;
  gap: 8px;
}
.img-field__row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.img-field__btn {
  flex: none;
}
.img-field__url { flex: 1; min-width: 0; }
.img-field__thumb {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--line, #e3e8e4);
}
.img-field__preview {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>

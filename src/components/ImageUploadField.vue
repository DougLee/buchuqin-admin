<script setup lang="ts">
import { ref } from "vue";
import { uploadImage } from "../api";
import { resolveImageUrl } from "../utils/image";
/**
 * COS 图片上传字段（IK9RWX，ADR-0003）：上传按钮 + URL 手输兜底 + 缩略预览。
 * v-model 绑定 URL 字符串；商品头图 / 类别图 / Banner 图三处复用。
 * folder=app 时落 COS app/ 目录（Banner 背景图等小程序素材，IK9VBI）。
 * cropRatio（IKDEUR 三修配套）：C 端 banner 改 scaleToFill 严格铺满后，
 * 比例不符的图会被拉伸变形——传目标宽高比（如 2.55），上传前 canvas
 * 居中裁切，运营无感。
 */
const props = defineProps<{
  modelValue: string;
  folder?: string;
  cropRatio?: number;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();
const fileInput = ref<HTMLInputElement>(),
  uploading = ref(false),
  error = ref("");
/** 居中裁切到目标宽高比（比例已吻合则原样返回不重编码）。 */
async function cropToRatio(file: File, ratio: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  let sx = 0,
    sy = 0,
    sw = bitmap.width,
    sh = bitmap.height;
  const cur = sw / sh;
  if (Math.abs(cur - ratio) > 0.01) {
    if (cur > ratio) {
      // 图偏宽：居中裁左右
      sw = Math.round(sh * ratio);
      sx = Math.round((bitmap.width - sw) / 2);
    } else {
      // 图偏高：居中裁上下
      sh = Math.round(sw / ratio);
      sy = Math.round((bitmap.height - sh) / 2);
    }
  } else {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, 0.92),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.\w+$/, mime === "image/png" ? ".png" : ".jpg"), {
    type: mime,
  });
}
async function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重选同一文件
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    const picked = props.cropRatio ? await cropToRatio(file, props.cropRatio) : file;
    emit("update:modelValue", await uploadImage(picked, props.folder));
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
      <button
        type="button"
        class="btn ghost img-field__btn"
        :disabled="uploading"
        @click="fileInput?.click()"
      >
        {{ uploading ? "上传中..." : "上传图片" }}
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        hidden
        @change="onPick"
      />
      <input
        class="img-field__url"
        :value="modelValue"
        placeholder="或直接粘贴图片 URL"
        @input="
          emit(
            'update:modelValue',
            ($event.target as HTMLInputElement).value.trim(),
          )
        "
      />
    </div>
    <div v-if="modelValue" class="img-field__preview">
      <img
        class="img-field__thumb"
        :src="resolveImageUrl(modelValue)"
        alt="图片预览"
        loading="lazy"
      />
      <!-- IKC1AA：一键清除（保存后即落「恢复默认」语义，如类别图回退默认图标） -->
      <button
        type="button"
        class="img-field__clear"
        @click="emit('update:modelValue', '')"
      >
        清除
      </button>
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
.img-field__url {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: #fff;
  padding: 0 11px;
  outline: 0;
  color: #153628;
}
.img-field__url:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px #159c5515;
}
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
.img-field__clear {
  border: 1px solid #f1d2bf;
  background: #fff5ef;
  color: #b65322;
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
</style>

/**
 * 图片地址归一化：COS 绝对地址（http/https/协议相对）原样使用；
 * 相对路径拼当前源（与 /api 同域，生产环境后台与 API 同站部署）。
 * DataPage 凭证大图与图片上传字段的预览共用。
 */
export function resolveImageUrl(src: string): string {
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;
  const origin = window.location.origin;
  return `${origin}${src.startsWith("/") ? "" : "/"}${src}`;
}

/**
 * 上传前压缩转 webp（IKE9Q5）：banner/商品图等展示图原图直传 COS 太大，
 * 前端 canvas 重绘统一转 webp（quality 0.85，体积通常减 50-80%）。
 * - 宽 > 1500px 等比缩到 1500（小程序渲染足够；长图按宽缩不糊）
 * - gif 跳过（canvas 重绘丢动画）；webp 跳过（已最优，避免二压劣化）
 * - 降级兜底：浏览器不支持 webp 编码 / 任何异常 → 原样返回，不阻塞上传
 * 后端 MIME 白名单已含 image/webp，零改动。
 */
export async function compressToWebp(file: File): Promise<File> {
  if (file.type === "image/gif" || file.type === "image/webp") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const MAX_WIDTH = 1500;
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    // toBlob 不支持 webp 时返回 null 或 png → 原样上传
    if (!blob || blob.type !== "image/webp") return file;
    const name = `${file.name.replace(/\.[^.]+$/, "")}.webp`;
    return new File([blob], name, { type: "image/webp" });
  } catch {
    return file;
  }
}

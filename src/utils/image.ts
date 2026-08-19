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

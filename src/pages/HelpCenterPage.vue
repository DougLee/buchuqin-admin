<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { HELP_MANUAL } from "../helpManual";
import { canSee } from "../session";

/**
 * 帮助中心（道哥 2026-09-22）：内置 markdown 手册只读渲染。
 * - marked 转 HTML + DOMPurify 白名单清洗（防脚本注入）
 * - 左侧目录取 `##` 标题锚点跳转
 * - 内链权限适配（道哥拍板）：`[菜单](/path)` 按登录权限过滤——
 *   有权限保留可点（router 跳转），无权限降级纯文本，避免点过去被守卫踢回首页的困惑
 */
const router = useRouter();
const bodyEl = ref<HTMLElement>();

const cleanedHtml = computed(() => {
  const raw = marked.parse(HELP_MANUAL, { async: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
});

/** 目录：解析 `## xxx` 行（与 anchorId 同一算法） */
const toc = computed(() =>
  HELP_MANUAL.split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => {
      const text = l.slice(3).trim();
      return { text, id: anchorId(text) };
    }),
);
function anchorId(text: string) {
  return (
    "h-" +
    Array.from(text)
      .map((c) =>
        /\w/.test(c) ? c.toLowerCase() : c.charCodeAt(0).toString(36),
      )
      .join("")
      .slice(0, 40)
  );
}

/** 渲染后处理：h2 挂锚点 + 内链权限降级/拦截原生跳转改 router */
function enhance() {
  const el = bodyEl.value;
  if (!el) return;
  for (const h of Array.from(el.querySelectorAll("h2")))
    h.id = anchorId(h.textContent ?? "");
  for (const a of Array.from(el.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("/")) {
      // 站内链接：按登录权限决定保留或降级为纯文本
      if (!canSee(href.slice(1))) {
        const span = document.createElement("span");
        span.textContent = a.textContent;
        a.replaceWith(span);
        continue;
      }
      a.addEventListener("click", (e) => {
        e.preventDefault();
        router.push(href);
      });
    } else {
      // 外链新窗打开 + 防钓鱼 rel
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }
}
function jump(id: string) {
  bodyEl.value?.querySelector(`#${id}`)?.scrollIntoView({ behavior: "smooth" });
}
onMounted(() => nextTick(enhance));
watch(cleanedHtml, () => nextTick(enhance));
</script>
<template>
  <div class="workspace help-page">
    <div class="page-head">
      <div>
        <p class="eyebrow">HELP CENTER</p>
        <h1>帮助中心</h1>
        <p>系统操作说明；随版本更新，如与页面不一致以页面为准。</p>
      </div>
    </div>
    <div class="help-layout">
      <nav class="help-toc" aria-label="手册目录">
        <p class="help-toc__title">目录</p>
        <a
          v-for="t in toc"
          :key="t.id"
          :href="'#' + t.id"
          @click.prevent="jump(t.id)"
          >{{ t.text }}</a
        >
      </nav>
      <!-- v-html 来源=内置常量且经 DOMPurify 清洗，安全可控 -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <article ref="bodyEl" class="help-body help-md" v-html="cleanedHtml" />
    </div>
  </div>
</template>
<style scoped>
.help-layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}
.help-toc {
  width: 200px;
  flex-shrink: 0;
  position: sticky;
  top: 24px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.help-toc__title {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 6px;
}
.help-toc a {
  font-size: 13px;
  color: #475569;
  padding: 6px 8px;
  border-radius: 6px;
  text-decoration: none;
}
.help-toc a:hover {
  background: #f1f5f9;
  color: #07883b;
}
.help-body {
  flex: 1;
  min-width: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 28px 32px;
}
.help-md :deep(h1) {
  font-size: 22px;
  margin-bottom: 16px;
}
.help-md :deep(h2) {
  font-size: 17px;
  margin: 24px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #f1f5f9;
}
.help-md :deep(p),
.help-md :deep(li) {
  font-size: 14px;
  line-height: 1.8;
  color: #334155;
}
.help-md :deep(ul),
.help-md :deep(ol) {
  padding-left: 22px;
  margin: 8px 0;
}
.help-md :deep(a) {
  color: #07883b;
  text-decoration: underline;
  cursor: pointer;
}
.help-md :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  margin: 8px 0;
}
.help-md :deep(code) {
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
}
.help-md :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
}
.help-md :deep(th),
.help-md :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 6px 12px;
  font-size: 13px;
}
</style>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { HELP_MANUAL } from "../helpManual";

/**
 * 帮助中心（道哥 2026-09-22 二轮定稿）：内置 markdown 手册只读渲染。
 * - marked 转 HTML + DOMPurify 白名单清洗（防脚本注入）
 * - 左侧目录取 `##` 标题锚点跳转
 * - 二轮：去掉菜单联动跳转；每菜单详解 + 截图（COS 外链）
 */
const bodyEl = ref<HTMLElement>();

const cleanedHtml = computed(() => {
  const raw = marked.parse(HELP_MANUAL, { async: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
});

/** 两级目录（道哥三轮定稿）：`##` 分组（一级）/ `###` 菜单（二级） */
interface TocItem {
  text: string;
  id: string;
  children: { text: string; id: string }[];
}
const toc = computed<TocItem[]>(() => {
  const groups: TocItem[] = [];
  for (const line of HELP_MANUAL.split("\n")) {
    if (line.startsWith("## ")) {
      const text = line.slice(3).trim();
      groups.push({ text, id: anchorId(text), children: [] });
    } else if (line.startsWith("### ") && groups.length) {
      const text = line.slice(4).trim();
      groups[groups.length - 1].children.push({
        text,
        id: anchorId(text),
      });
    }
  }
  return groups;
});
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

/** 渲染后处理：h2/h3 挂锚点；外链统一新窗+防钓鱼 */
function enhance() {
  const el = bodyEl.value;
  if (!el) return;
  for (const h of Array.from(el.querySelectorAll("h2, h3")))
    h.id = anchorId(h.textContent ?? "");
  for (const a of Array.from(el.querySelectorAll("a"))) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
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
        <template v-for="g in toc" :key="g.id">
          <a
            class="help-toc__group"
            :href="'#' + g.id"
            @click.prevent="jump(g.id)"
            >{{ g.text }}</a
          >
          <a
            v-for="c in g.children"
            :key="c.id"
            class="help-toc__sub"
            :href="'#' + c.id"
            @click.prevent="jump(c.id)"
            >{{ c.text }}</a
          >
        </template>
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
/* 三轮定稿：两级目录——分组加粗、子项缩进 */
.help-toc__group {
  font-weight: 600;
  color: #1e293b !important;
  margin-top: 4px;
}
.help-toc__sub {
  padding-left: 22px !important;
  font-size: 12.5px !important;
  color: #64748b !important;
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

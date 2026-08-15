<script setup lang="ts">
import { ref } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import AppIcon from "./components/AppIcon.vue";
const route = useRoute(),
  router = useRouter(),
  collapsed = ref(false),
  globalKeyword = ref("");
function search() {
  const value = globalKeyword.value.trim();
  if (!value) return;
  const path = /^(SKU|p\d|\d{8,14})/i.test(value)
    ? "/products"
    : /^BCQ|order/i.test(value)
      ? "/orders"
      : "/staff";
  router.push({ path, query: { q: value } });
}
const groups = [
  {
    label: "运营中心",
    items: [
      ["/", "dashboard", "经营总览"],
      ["/orders", "orders", "订单履约"],
      ["/after-sales", "after", "售后退款"],
    ],
  },
  {
    label: "商品仓储",
    items: [
      ["/products", "products", "商品管理"],
      ["/inventory", "inventory", "库存与批次"],
    ],
  },
  {
    label: "组织营销",
    items: [
      ["/staff", "staff", "履约人员"],
      ["/campuses", "campus", "校园组织"],
      ["/marketing", "marketing", "营销活动"],
    ],
  },
  {
    label: "财务系统",
    items: [
      ["/finance", "finance", "结算中心"],
      ["/audit", "audit", "审计日志"],
    ],
  },
];
</script>
<template>
  <div class="shell" :class="{ collapsed }">
    <aside>
      <div class="brand">
        <div class="brand-mark"><span></span></div>
        <div class="brand-copy"><b>不出寝</b><small>OPERATIONS</small></div>
      </div>
      <nav>
        <section v-for="group in groups" :key="group.label">
          <p>{{ group.label }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item[0]"
            :to="item[0]"
            :class="{ active: route.path === item[0] }"
            ><AppIcon :name="item[1]" /><span>{{ item[2] }}</span
            ><i v-if="item[0] === '/after-sales'">2</i></RouterLink
          >
        </section>
      </nav>
      <div class="operator">
        <div class="avatar">管</div>
        <div><b>平台管理员</b><small>湖北工业大学</small></div>
      </div>
    </aside>
    <main>
      <header>
        <button
          class="icon-button"
          aria-label="折叠菜单"
          @click="collapsed = !collapsed"
        >
          <span></span><span></span><span></span>
        </button>
        <div class="campus-select">
          <span class="live-dot"></span>
          <div><small>当前运营校园</small><b>湖北工业大学</b></div>
          <strong>⌄</strong>
        </div>
        <div class="header-actions">
          <input
            v-model="globalKeyword"
            class="search"
            aria-label="全局搜索"
            placeholder="搜索订单 / SKU / 人员"
            @keyup.enter="search"
          />
          <button
            class="notification"
            aria-label="查看待处理售后"
            @click="router.push('/after-sales')"
          >
            <span></span><i>2</i>
          </button>
        </div>
      </header>
      <RouterView />
    </main>
  </div>
</template>

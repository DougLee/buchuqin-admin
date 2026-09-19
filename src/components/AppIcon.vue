<script setup lang="ts">
defineProps<{ name: string }>();
const paths: Record<string, string> = {
  dashboard: "M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z",
  orders: "M6 2h12l3 5-9 5L3 7zM5 10v9h14v-9M9 15h6",
  products: "M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10",
  inventory: "M3 6h18v14H3zM7 6V3h10v3M8 11h8M8 15h5",
  staff:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  // IKEAGE 楼长招募：人员 + 添加（招募进来）
  recruit:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M19 8v6M22 11h-6",
  after:
    "M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h7M16 2h6v6M10 14L22 2",
  finance: "M3 6h18M5 6l1-3h12l1 3M5 10v8M10 10v8M15 10v8M20 10v8M3 21h18",
  campus: "M3 21h18M6 21V8l6-5 6 5v13M9 12h2M13 12h2M9 16h2M13 16h2",
  marketing: "M3 11l18-5v12L3 14zM7 15l1 6h4l-1-7",
  audit: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  dispatch: "M4 7h11M14 4l3 3-3 3M20 17H9M10 14l-3 3 3 3",
  rules: "M3 17L17 3l4 4L7 21H3zM9 12l3 3M13 8l3 3",
  accounts:
    "M8 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 016-6h1a6 6 0 016 6v1M17 8l4 4m0-4l-4 4",
  // RBAC V1：系统分组——角色（盾牌）/权限目录（盾牌勾）/权限审计（搜索列表）
  "rbac-roles": "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z",
  "rbac-permissions": "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4zM8.5 12l2.5 2.5 4.5-4.5",
  "rbac-audit": "M4 4h16v16H4zM8 9h8M8 13h5M15 17l4 4",
  password:
    "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  logout: "M18.36 6.64a9 9 0 11-12.73 0M12 2v10",
  chevron: "M6 9l6 6 6-6",
};
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.dashboard" />
  </svg>
</template>

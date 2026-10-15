<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { loadRbac } from "../session";
import type { RbacMenuRow } from "../types";
const rows = ref<RbacMenuRow[]>([]);
const catalog = ref<Awaited<ReturnType<typeof api.rbacCatalog>>>({
  views: [],
  permissions: [],
});
const search = ref(""),
  permissionSearch = ref(""),
  error = ref(""),
  notice = ref("");
const opened = ref(false),
  saving = ref(false),
  editing = ref<string | null>(null);
const defaults = () => ({
  name: "",
  parentId: "",
  type: 1 as 0 | 1 | 2,
  path: "",
  viewPath: "",
  icon: "",
  orderNum: 0,
  isShow: true,
  keepAlive: false,
  perms: [] as string[],
});
const form = ref(defaults());
const external = ref(false);
const types = ["目录", "菜单", "按钮"];
async function load() {
  try {
    [rows.value, catalog.value] = await Promise.all([
      api.rbacMenus(),
      api.rbacCatalog(),
    ]);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  }
}
onMounted(load);
const flat = computed(() => {
  const out: { row: RbacMenuRow; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const row of [...rows.value]
      .sort((a, b) => (a.orderNum ?? 0) - (b.orderNum ?? 0))
      .filter((r) => r.parentId === parentId)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.filter(
    ({ row }) =>
      !search.value ||
      `${row.name} ${row.path} ${row.code}`.includes(search.value),
  );
});
const permissions = computed(() =>
  catalog.value.permissions.filter((p) =>
    `${p.name} ${p.pattern}`
      .toLowerCase()
      .includes(permissionSearch.value.toLowerCase()),
  ),
);
function open(row?: RbacMenuRow, parent?: string) {
  editing.value = row?.id ?? null;
  form.value = row
    ? {
        ...defaults(),
        ...row,
        parentId: row.parentId ?? "",
        path: row.path ?? "",
        viewPath: row.viewPath ?? "",
        icon: row.icon ?? "",
        orderNum: row.orderNum ?? 0,
        isShow: row.isShow !== false,
        keepAlive: row.keepAlive ?? false,
        perms: [...(row.perms ?? [])],
      }
    : { ...defaults(), parentId: parent ?? "" };
  external.value = form.value.viewPath.startsWith("https://");
  error.value = "";
  permissionSearch.value = "";
  opened.value = true;
}
async function save() {
  saving.value = true;
  error.value = "";
  try {
    const payload = { ...form.value, parentId: form.value.parentId || null };
    if (editing.value) await api.rbacUpdateMenu(editing.value, payload);
    else await api.rbacCreateMenu(payload);
    opened.value = false;
    notice.value = "菜单已保存，导航和页面权限已刷新";
    await load();
    await loadRbac();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存失败";
  } finally {
    saving.value = false;
  }
}
/** IKLUV9：删除确认改 ElMessageBox（统一卡片形态），弃最后一批自绘 mask */
async function remove(row: RbacMenuRow) {
  try {
    await ElMessageBox.confirm(
      `确认删除「${row.name}」？将删除整个子树（含下级菜单与按钮），挂在角色上的对应授权一并失效。`,
      "删除菜单",
      { type: "warning", confirmButtonText: "确认删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  try {
    await api.rbacDeleteMenu(row.id);
    notice.value = "菜单已删除";
    await load();
    await loadRbac();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "删除失败";
  }
}
</script>
<template>
  <div class="workspace rbac-workspace">
    <div class="page-head">
      <div>
        <h1>菜单管理</h1>
        <p>配置目录、页面和操作权限。保存后生效，隐藏导航不会撤销授权。</p>
      </div>
      <button class="btn primary" @click="open()">＋ 新建菜单</button>
    </div>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error && !opened" class="form-hint" role="alert">{{ error }}</p>
    <ElForm class="rbac-toolbar" label-position="top"
      ><ElRow :gutter="16" align="bottom"
        ><ElCol :xs="24" :sm="18"
          ><ElInput
            v-model="search"
            clearable
            placeholder="输入菜单名称、路由或编码" /></ElCol></ElRow
    ></ElForm>
    <div class="data-panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>路由 / 页面</th>
            <th>显示</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ row, depth } in flat" :key="row.id">
            <td :style="{ paddingLeft: `${16 + depth * 20}px` }">
              {{ row.name }}
            </td>
            <td>
              <span class="rbac-node-kind" :data-kind="row.type">{{
                types[row.type]
              }}</span>
            </td>
            <td>
              {{ row.path }}<small class="view-key">{{ row.viewPath }}</small>
            </td>
            <td>{{ row.isShow ? "显示" : "隐藏" }}</td>
            <td>
              <button class="btn mini" @click="open(row)">编辑</button
              ><button
                v-if="row.type !== 2"
                class="btn mini"
                @click="open(undefined, row.id)"
              >
                添加子项</button
              ><button class="btn mini danger-btn" @click="remove(row)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ElDialog
      v-model="opened"
      :title="editing ? '编辑菜单' : '新建菜单'"
      width="min(880px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm label-position="top" @submit.prevent="save"
        ><ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="名称" required
              ><ElInput v-model.trim="form.name" maxlength="30" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="类型"
              ><ElSelect v-model="form.type"
                ><ElOption label="目录" :value="0" /><ElOption
                  label="菜单"
                  :value="1" /><ElOption
                  label="按钮"
                  :value="2" /></ElSelect></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="上级节点"
              ><ElSelect v-model="form.parentId"
                ><ElOption label="根目录" value="" /><ElOption
                  v-for="r in rows.filter(
                    (r) => r.type !== 2 && r.id !== editing,
                  )"
                  :key="r.id"
                  :label="r.name"
                  :value="r.id" /></ElSelect></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="排序"
              ><ElInputNumber v-model="form.orderNum" :min="0" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="图标"
              ><ElInput
                v-model="form.icon"
                placeholder="例如 orders" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="导航显示"
              ><ElSwitch
                v-model="form.isShow"
                active-text="显示"
                inactive-text="隐藏" /></ElFormItem
          ></ElCol>
          <template v-if="form.type === 1">
            <ElCol :xs="24" :sm="12"
              ><ElFormItem label="页面路由" required
                ><ElInput
                  v-model.trim="form.path"
                  placeholder="/products" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12"
              ><ElFormItem label="页面来源"
                ><ElSwitch
                  v-model="external"
                  active-text="外链"
                  inactive-text="内部页面"
                  @change="form.viewPath = ''" /></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12"
              ><ElFormItem v-if="external" label="HTTPS 外链" required
                ><ElInput
                  v-model.trim="form.viewPath"
                  type="url"
                  placeholder="https://…" /></ElFormItem
              ><ElFormItem v-else label="页面组件" required
                ><ElSelect v-model="form.viewPath" placeholder="选择已有页面"
                  ><ElOption
                    v-for="v in catalog.views"
                    :key="v.key"
                    :label="v.name"
                    :value="v.key" /></ElSelect></ElFormItem
            ></ElCol>
            <ElCol :xs="24" :sm="12"
              ><ElFormItem label="页面缓存"
                ><ElSwitch
                  v-model="form.keepAlive"
                  active-text="保留状态"
                  inactive-text="不缓存" /></ElFormItem
            ></ElCol>
          </template>
          <ElCol :span="24"
            ><ElFormItem :label="`接口权限（已选 ${form.perms.length} 项）`"
              ><ElInput
                v-model="permissionSearch"
                clearable
                placeholder="搜索操作名称或接口"
              /><ElCheckboxGroup v-model="form.perms" class="permission-options"
                ><ElCheckbox
                  v-for="p in permissions"
                  :key="p.pattern"
                  :value="p.pattern"
                  ><span
                    >{{ p.name }}<small>{{ p.pattern }}</small></span
                  ></ElCheckbox
                ></ElCheckboxGroup
              ></ElFormItem
            ></ElCol
          >
          <ElCol v-if="error" :span="24"
            ><p class="form-hint" role="alert">{{ error }}</p></ElCol
          >
        </ElRow></ElForm
      >
      <template #footer
        ><ElButton @click="opened = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      >
    </ElDialog>

  </div>
</template>
<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: #10201966;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.menu-dialog {
  width: min(840px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: white;
  border-radius: 16px;
  padding: 24px;
}
input[type="checkbox"] {
  width: auto;
  min-height: 0;
}
.permission-options {
  max-height: 240px;
  overflow: auto;
  padding: 12px 0;
}
.permission-options label {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
}
small {
  display: block;
  color: #64746b;
  font-size: 12px;
}
.view-key {
  margin-top: 4px;
}
fieldset {
  border: 1px solid #dce5df;
  border-radius: 8px;
}
@media (max-width: 640px) {
  .modal-backdrop {
    padding: 8px;
  }
}
/* 删除确认弹窗：全局 mask+toast 复用；卡片站点 token */
.confirm-card {
  width: min(400px, 92vw);
  background: #fff;
  border-radius: 16px;
  padding: 22px 24px 18px;
  box-shadow: 0 18px 48px #062e2326;
}
.confirm-card h3 {
  margin: 0 0 10px;
  font-size: 15px;
  color: #153628;
}
.confirm-card p {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: #4c5c53;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

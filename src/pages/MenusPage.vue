<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { loadRbac } from "../session";
import type { RbacMenuRow } from "../types";
const rows = ref<RbacMenuRow[]>([]);
const catalog = ref<Awaited<ReturnType<typeof api.rbacCatalog>>>({ views: [], permissions: [] });
const search = ref(""), permissionSearch = ref(""), error = ref(""), notice = ref("");
const opened = ref(false), saving = ref(false), editing = ref<string | null>(null);
const defaults = () => ({ name: "", parentId: "", type: 1 as 0 | 1 | 2, path: "", viewPath: "", icon: "", orderNum: 0, isShow: true, keepAlive: false, perms: [] as string[] });
const form = ref(defaults());
const external = ref(false);
const types = ["目录", "菜单", "按钮"];
async function load() {
  try { [rows.value, catalog.value] = await Promise.all([api.rbacMenus(), api.rbacCatalog()]); }
  catch (e) { error.value = e instanceof Error ? e.message : "加载失败"; }
}
onMounted(load);
const flat = computed(() => {
  const out: { row: RbacMenuRow; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const row of [...rows.value].sort((a,b) => (a.orderNum ?? 0) - (b.orderNum ?? 0)).filter(r => r.parentId === parentId)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id); out.push({ row, depth }); walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.filter(({row}) => !search.value || `${row.name} ${row.path} ${row.code}`.includes(search.value));
});
const permissions = computed(() => catalog.value.permissions.filter(p => `${p.name} ${p.pattern}`.toLowerCase().includes(permissionSearch.value.toLowerCase())));
function open(row?: RbacMenuRow, parent?: string) {
  editing.value = row?.id ?? null;
  form.value = row ? { ...defaults(), ...row, parentId: row.parentId ?? "", path: row.path ?? "", viewPath: row.viewPath ?? "", icon: row.icon ?? "", orderNum: row.orderNum ?? 0, isShow: row.isShow !== false, keepAlive: row.keepAlive ?? false, perms: [...(row.perms ?? [])] } : { ...defaults(), parentId: parent ?? "" };
  external.value = form.value.viewPath.startsWith("https://");
  error.value = ""; permissionSearch.value = ""; opened.value = true;
}
async function save() {
  saving.value = true; error.value = "";
  try {
    const payload = { ...form.value, parentId: form.value.parentId || null };
    if (editing.value) await api.rbacUpdateMenu(editing.value, payload);
    else await api.rbacCreateMenu(payload);
    opened.value = false; notice.value = "菜单已保存，导航和页面权限已刷新";
    await load(); await loadRbac();
  } catch(e) { error.value = e instanceof Error ? e.message : "保存失败"; }
  finally { saving.value = false; }
}
const deleting = ref("");
async function remove(row: RbacMenuRow) {
  if (deleting.value !== row.id) { deleting.value = row.id; return; }
  try { await api.rbacDeleteMenu(row.id); deleting.value = ""; await load(); await loadRbac(); }
  catch(e) { error.value = e instanceof Error ? e.message : "删除失败"; }
}
</script>
<template>
  <div class="workspace rbac-workspace">
    <div class="page-head"><div><h1>菜单管理</h1><p>配置目录、页面和操作权限。保存后生效，隐藏导航不会撤销授权。</p></div><button class="btn primary" @click="open()">＋ 新建菜单</button></div>
    <p v-if="notice" role="status">{{ notice }}</p><p v-if="error && !opened" class="form-hint" role="alert">{{ error }}</p>
    <div class="rbac-toolbar"><label class="rbac-search"><span>查找菜单</span><input v-model="search" placeholder="输入菜单名称、路由或编码" aria-label="搜索菜单" /></label><span class="rbac-count">{{ flat.length }} 个节点</span></div>
    <div class="data-panel table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>路由 / 页面</th><th>显示</th><th>操作</th></tr></thead><tbody>
      <tr v-for="{row,depth} in flat" :key="row.id"><td :style="{paddingLeft: `${16 + depth * 20}px`}">{{ row.name }}</td><td><span class="rbac-node-kind" :data-kind="row.type">{{ types[row.type] }}</span></td><td>{{ row.path }}<small class="view-key">{{ row.viewPath }}</small></td><td>{{ row.isShow ? '显示' : '隐藏' }}</td><td>
        <button class="btn mini" @click="open(row)">编辑</button><button v-if="row.type !== 2" class="btn mini" @click="open(undefined, row.id)">添加子项</button><button v-if="!row.builtin" class="btn mini" @click="remove(row)">{{ deleting === row.id ? '确认删除整个子树？' : '删除' }}</button>
      </td></tr>
    </tbody></table></div>
    <div v-if="opened" class="modal-backdrop" @click.self="opened = false"><form class="menu-dialog" @submit.prevent="save">
      <div class="rbac-dialog-heading"><div><p class="eyebrow">菜单与访问权限</p><h2>{{ editing ? '编辑菜单' : '新建菜单' }}</h2></div><button type="button" class="btn ghost" aria-label="关闭菜单编辑" @click="opened = false">关闭</button></div>
      <div class="menu-fields">
        <label>名称<input v-model.trim="form.name" required maxlength="30" /></label>
        <label>类型<select v-model="form.type"><option :value="0">目录</option><option :value="1">菜单</option><option :value="2">按钮</option></select></label>
        <label>上级节点<select v-model="form.parentId"><option value="">根目录</option><option v-for="r in rows.filter(r => r.type !== 2 && r.id !== editing)" :key="r.id" :value="r.id">{{ r.name }}</option></select></label>
        <label>排序<input v-model.number="form.orderNum" type="number" /></label>
        <label>图标<input v-model="form.icon" placeholder="例如 orders" /></label>
        <label><input v-model="form.isShow" type="checkbox" />在导航中显示</label>
        <template v-if="form.type === 1">
          <label>页面路由<input v-model.trim="form.path" required placeholder="/products" /></label>
          <label><input v-model="external" type="checkbox" @change="form.viewPath = ''" />使用外链页面</label>
          <label v-if="external">HTTPS 外链<input v-model.trim="form.viewPath" type="url" required placeholder="https://…" /></label>
          <label v-else>页面组件<select v-model="form.viewPath" required><option value="" disabled>选择已有页面</option><option v-for="v in catalog.views" :key="v.key" :value="v.key">{{ v.name }}</option></select></label>
          <label><input v-model="form.keepAlive" type="checkbox" />保留页面状态</label>
        </template>
      </div>
      <fieldset><legend>接口权限（已选 {{ form.perms.length }} 项）</legend><input v-model="permissionSearch" placeholder="搜索操作名称或接口" aria-label="搜索接口权限" />
        <div class="permission-options"><label v-for="p in permissions" :key="p.pattern"><input v-model="form.perms" type="checkbox" :value="p.pattern" /><span>{{ p.name }}<small>{{ p.pattern }}</small></span></label></div>
      </fieldset>
      <p v-if="error" class="form-hint" role="alert">{{ error }}</p><div class="drawer-actions"><button type="button" class="btn ghost" @click="opened = false">取消</button><button type="submit" class="btn primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div>
    </form></div>
  </div>
</template>
<style scoped>
.modal-backdrop { position:fixed; inset:0; z-index:120; background:#10201966; display:flex; align-items:center; justify-content:center; padding:24px }
.menu-dialog { width:min(840px,100%); max-height:90vh; overflow:auto; background:white; border-radius:16px; padding:24px }
.menu-fields { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin:20px 0 }
.menu-fields label { display:flex; flex-direction:column; gap:8px }
input[type=checkbox] { width:auto; min-height:0 }
.permission-options { max-height:240px; overflow:auto; padding:12px 0 }
.permission-options label { display:flex; align-items:center; gap:10px; margin:8px 0 }
small { display:block; color:#64746b; font-size:12px }.view-key { margin-top:4px } fieldset { border:1px solid #dce5df; border-radius:8px }
@media(max-width:640px) { .menu-fields { grid-template-columns:1fr } .modal-backdrop { padding:8px } }
</style>

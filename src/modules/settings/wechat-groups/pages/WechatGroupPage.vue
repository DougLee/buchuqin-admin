<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import type { Building, WechatGroup } from "../../../../types";
import { fmtDateTime } from "../../../../utils/datetime";
import { resolveImageUrl } from "../../../../utils/image";

const rows = ref<WechatGroup[]>([]),
  buildings = ref<Building[]>([]);
const loading = ref(false),
  saving = ref(false),
  editorOpen = ref(false);
const editing = ref<WechatGroup | null>(null);
const form = reactive({ buildingId: "", image: "" });
const canSave = () => hasPerm("POST /admin/wechat-groups");
const canDelete = () => hasPerm("DELETE /admin/wechat-groups/:id");
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
function asGroup(row: unknown) {
  return row as WechatGroup;
}
async function load() {
  loading.value = true;
  try {
    const [groups, buildingResult] = await Promise.all([
      api.wechatGroups(),
      api.buildings({ page: 1, pageSize: 1000 }),
    ]);
    rows.value = groups;
    buildings.value = buildingResult.items;
  } catch (error) {
    notify(error instanceof Error ? error.message : "群码加载失败", "error");
  } finally {
    loading.value = false;
  }
}
function openEditor(row?: WechatGroup) {
  editing.value = row ?? null;
  form.buildingId = row?.buildingId ?? "";
  form.image = row?.image ?? "";
  editorOpen.value = true;
}
async function save() {
  if (!form.image) {
    notify("请上传群二维码图片", "error");
    return;
  }
  saving.value = true;
  try {
    await api.upsertWechatGroup({
      buildingId: form.buildingId || undefined,
      image: form.image,
    });
    editorOpen.value = false;
    notify(editing.value ? "群二维码已替换" : "群二维码已保存");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function remove(row: WechatGroup) {
  try {
    await ElMessageBox.confirm(
      `确认删除“${row.buildingName || "校级大群"}”二维码？`,
      "删除群码",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      },
    );
  } catch {
    return;
  }
  try {
    await api.deleteWechatGroup(row.id);
    notify("群码已删除");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", "error");
  }
}
onMounted(load);
watch(effectiveCampusId, load);
</script>
<template>
  <AdminPageShell
    title="微信群码"
    eyebrow="WECHAT GROUPS"
    description="维护校级大群及楼栋群二维码，用户端按寝室自动匹配。"
  >
    <template #actions
      ><ElButton v-if="canSave()" type="primary" @click="openEditor()"
        >上传群二维码</ElButton
      ></template
    >
    <section class="admin-table-panel" aria-label="微信群码列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        empty-text="暂无群二维码"
      >
        <ElTableColumn label="二维码" width="100"
          ><template #default="{ row }"
            ><ElImage :src="resolveImageUrl(row.image)" fit="cover" class="qr"
              ><template #error>—</template></ElImage
            ></template
          ></ElTableColumn
        >
        <ElTableColumn label="所属群" min-width="180"
          ><template #default="{ row }">{{
            row.buildingName || "校级大群"
          }}</template></ElTableColumn
        >
        <ElTableColumn label="更新时间" min-width="180"
          ><template #default="{ row }">{{
            fmtDateTime(row.updatedAt)
          }}</template></ElTableColumn
        >
        <ElTableColumn label="操作" width="180"
          ><template #default="{ row }"
            ><ElButton
              v-if="canSave()"
              size="small"
              type="primary"
              @click="openEditor(asGroup(row))"
              >替换</ElButton
            ><ElButton
              v-if="canDelete()"
              size="small"
              type="danger"
              plain
              @click="remove(asGroup(row))"
              >删除</ElButton
            ></template
          ></ElTableColumn
        >
      </ElTable>
    </section>
    <ElDialog
      v-model="editorOpen"
      :title="editing ? '替换群二维码' : '上传群二维码'"
      width="min(560px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow
          ><ElCol :span="24"
            ><ElFormItem label="所属群"
              ><ElSelect
                v-model="form.buildingId"
                clearable
                placeholder="校级大群"
                ><ElOption label="校级大群" value="" /><ElOption
                  v-for="item in buildings"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></ElSelect></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="群二维码"
              ><ImageUploadField
                v-model="form.image"
                folder="app/wechat-group" /></ElFormItem></ElCol></ElRow></ElForm
      ><template #footer
        ><ElButton @click="editorOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      ></ElDialog
    >
  </AdminPageShell>
</template>
<style scoped>
.qr {
  width: 56px;
  height: 56px;
  border-radius: 8px;
}
.el-select {
  width: 100%;
}
</style>

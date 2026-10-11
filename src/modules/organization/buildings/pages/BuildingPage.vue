<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, downloadRoomTemplate, fetchAllPages } from "../../../../api";
import { activeCampus, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Building, Room } from "../../../../types";
const rows = ref<Building[]>([]),
  rooms = ref<Room[]>([]),
  loading = ref(false),
  saving = ref(false),
  editorOpen = ref(false),
  roomsOpen = ref(false),
  roomLoading = ref(false),
  importing = ref(false),
  editing = ref<Building | null>(null),
  roomBuilding = ref<Building | null>(null),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0),
  keyword = ref("");
const form = reactive({
  name: "",
  floors: 6,
  gender: "mixed",
  hasElevator: false,
});
const roomForm = reactive({ floor: 1, roomNo: "" });
let timer: number | undefined;
function asBuilding(row: unknown) {
  return row as Building;
}
function asRoom(row: unknown) {
  return row as Room;
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
async function load() {
  loading.value = true;
  try {
    const result = await api.buildings({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      campusId: activeCampus.value || undefined,
    });
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    notify(error instanceof Error ? error.message : "楼栋加载失败", "error");
  } finally {
    loading.value = false;
  }
}
function edit(row?: Building) {
  editing.value = row ?? null;
  Object.assign(form, {
    name: row?.name ?? "",
    floors: row?.floors ?? 6,
    gender: row?.gender ?? "mixed",
    hasElevator: !!row?.hasElevator,
  });
  editorOpen.value = true;
}
async function save() {
  if (!form.name.trim()) {
    notify("请填写楼栋名称", "error");
    return;
  }
  saving.value = true;
  try {
    const data = {
      name: form.name.trim(),
      floors: form.floors,
      gender: form.gender,
      hasElevator: form.hasElevator,
    };
    editing.value
      ? await api.updateBuilding(editing.value.id, data)
      : await api.createBuilding(data);
    editorOpen.value = false;
    notify(editing.value ? "楼栋已更新" : "楼栋已创建");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function remove(row: Building) {
  try {
    await ElMessageBox.confirm(
      `确认删除“${row.name}”？楼栋存在寝室或业务数据时后端会拒绝。`,
      "删除楼栋",
      { type: "warning" },
    );
  } catch {
    return;
  }
  try {
    await api.deleteBuilding(row.id);
    notify("楼栋已删除");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", "error");
  }
}
async function openRooms(row: Building) {
  roomBuilding.value = row;
  roomsOpen.value = true;
  roomForm.floor = 1;
  roomForm.roomNo = "";
  await loadRooms();
}
async function loadRooms() {
  if (!roomBuilding.value) return;
  roomLoading.value = true;
  try {
    rooms.value = await fetchAllPages((q) =>
      api.rooms(roomBuilding.value!.id, q),
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : "寝室加载失败", "error");
  } finally {
    roomLoading.value = false;
  }
}
async function addRoom() {
  if (!roomBuilding.value || !roomForm.roomNo.trim()) return;
  try {
    await api.createRoom(roomBuilding.value.id, {
      floor: roomForm.floor,
      roomNo: roomForm.roomNo.trim(),
    });
    roomForm.roomNo = "";
    notify("寝室已添加");
    await loadRooms();
  } catch (error) {
    notify(error instanceof Error ? error.message : "添加失败", "error");
  }
}
async function removeRoom(row: Room) {
  if (!roomBuilding.value) return;
  try {
    await ElMessageBox.confirm(`删除 ${row.roomNo} 寝？`, "删除寝室", {
      type: "warning",
    });
  } catch {
    return;
  }
  try {
    await api.deleteRoom(roomBuilding.value.id, row.id);
    notify("寝室已删除");
    await loadRooms();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", "error");
  }
}
async function pickFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!roomBuilding.value || !file) return;
  importing.value = true;
  try {
    const result = await api.importRooms(roomBuilding.value.id, file);
    notify(`成功导入 ${result.imported} 间寝室`);
    await loadRooms();
  } catch (error) {
    notify(error instanceof Error ? error.message : "导入失败", "error");
  } finally {
    importing.value = false;
  }
}
watch([page, pageSize, activeCampus], load);
watch(keyword, () => {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 280);
});
onMounted(load);
</script>
<template>
  <AdminPageShell
    title="楼栋管理"
    eyebrow="CAMPUS NETWORK"
    description="管理当前顶部校区的楼栋、寝室和配送范围。"
    ><template #actions
      ><ElButton
        v-if="hasPerm('POST /admin/buildings')"
        type="primary"
        @click="edit()"
        >新建楼栋</ElButton
      ></template
    >
    <div class="toolbar">
      <ElInput
        v-model="keyword"
        clearable
        placeholder="搜索楼栋"
        class="search"
      />
      <div class="toolbar-spacer" />
      <ElButton :loading="loading" @click="load">刷新</ElButton>
    </div>
    <ElTable v-loading="loading" :data="rows" row-key="id"
      ><ElTableColumn prop="name" label="楼栋" min-width="160" /><ElTableColumn
        prop="floors"
        label="楼层"
        width="90"
      /><ElTableColumn label="电梯" width="100"
        ><template #default="{ row }">{{
          row.hasElevator ? "有电梯" : "无电梯"
        }}</template></ElTableColumn
      ><ElTableColumn label="性别分区" width="110"
        ><template #default="{ row }">{{
          row.gender === "male"
            ? "男生"
            : row.gender === "female"
              ? "女生"
              : "混合"
        }}</template></ElTableColumn
      ><ElTableColumn
        prop="roomsCount"
        label="寝室数"
        width="100"
      /><ElTableColumn
        prop="staffName"
        label="楼长"
        min-width="130"
      /><ElTableColumn label="操作" fixed="right" width="230"
        ><template #default="{ row }"
          ><ElButton
            v-if="hasPerm('PATCH /admin/buildings/:id')"
            size="small"
            type="primary"
            @click="edit(asBuilding(row))"
            >编辑</ElButton
          ><ElButton
            v-if="hasPerm('GET /admin/buildings/:id/rooms')"
            size="small"
            @click="openRooms(asBuilding(row))"
            >寝室</ElButton
          ><ElButton
            v-if="hasPerm('DELETE /admin/buildings/:id')"
            size="small"
            type="danger"
            plain
            @click="remove(asBuilding(row))"
            >删除</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    ><AdminPagination
      v-model:page="page"
      v-model:page-size="pageSize"
      :total="total"
    /><ElDialog
      v-model="editorOpen"
      :title="editing ? '编辑楼栋' : '新建楼栋'"
      width="min(560px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElFormItem label="楼栋名称"
          ><ElInput v-model="form.name" /></ElFormItem
        ><ElFormItem label="楼层数"
          ><ElInputNumber v-model="form.floors" :min="1" /></ElFormItem
        ><ElFormItem label="性别分区"
          ><ElSelect v-model="form.gender"
            ><ElOption label="男生" value="male" /><ElOption
              label="女生"
              value="female" /><ElOption
              label="混合"
              value="mixed" /></ElSelect></ElFormItem
        ><ElFormItem
          ><ElCheckbox v-model="form.hasElevator"
            >有电梯</ElCheckbox
          ></ElFormItem
        ></ElForm
      ><template #footer
        ><ElButton @click="editorOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      ></ElDialog
    ><ElDialog
      v-model="roomsOpen"
      :title="`寝室管理 · ${roomBuilding?.name || ''}`"
      width="min(820px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><div class="room-tools">
        <ElInputNumber v-model="roomForm.floor" :min="1" /><ElInput
          v-model="roomForm.roomNo"
          placeholder="寝室号，如 612"
          @keyup.enter="addRoom"
        /><ElButton
          v-if="hasPerm('POST /admin/buildings/:id/rooms')"
          type="primary"
          @click="addRoom"
          >添加</ElButton
        ><ElButton
          v-if="
            roomBuilding && hasPerm('GET /admin/buildings/:id/rooms/template')
          "
          @click="downloadRoomTemplate(roomBuilding.id)"
          >下载模板</ElButton
        ><label
          v-if="hasPerm('POST /admin/buildings/:id/rooms/import')"
          class="upload"
          ><ElButton :loading="importing">批量导入</ElButton
          ><input type="file" accept=".xlsx,.csv" hidden @change="pickFile"
        /></label>
      </div>
      <ElTable v-loading="roomLoading" :data="rooms" max-height="420"
        ><ElTableColumn prop="floor" label="楼层" width="100" /><ElTableColumn
          prop="roomNo"
          label="寝室号"
        /><ElTableColumn label="操作" width="100"
          ><template #default="{ row }"
            ><ElButton
              v-if="hasPerm('DELETE /admin/buildings/:id/rooms/:roomId')"
              link
              type="danger"
              @click="removeRoom(asRoom(row))"
              >删除</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      ><template #footer
        ><ElButton @click="roomsOpen = false">关闭</ElButton></template
      ></ElDialog
    ></AdminPageShell
  >
</template>
<style scoped>
.search {
  width: min(360px, 100%);
}
.el-dialog .el-select,
.el-dialog .el-input-number {
  width: 100%;
}
.room-tools {
  display: grid;
  grid-template-columns: 120px minmax(180px, 1fr) repeat(3, auto);
  gap: 10px;
  margin-bottom: 14px;
}
.upload {
  display: inline-flex;
}
@media (max-width: 760px) {
  .room-tools {
    grid-template-columns: 1fr;
  }
}
</style>

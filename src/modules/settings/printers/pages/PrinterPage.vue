<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import { effectiveCampusId, canWrite, hasPerm } from "../../../../session";
import type { Printer } from "../../../../types";
import { fmtDateTime } from "../../../../utils/datetime";

const printer = ref<Printer>();
const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const dialogOpen = ref(false);
const form = reactive({ name: "", sn: "", copies: 1, copiesGapSeconds: 0 });
const writable = computed(() => canWrite("printers"));

const copiesOptions = [
  { value: 1, label: "1 联（单张小票）" },
  { value: 2, label: "2 联（商家联 + 客户联）" },
  { value: 3, label: "3 联（商家联 + 客户联 + 骑手联）" },
];
const gapOptions = Array.from({ length: 11 }, (_, value) => ({
  value,
  label: value ? `间隔 ${value} 秒` : "0 秒（连续出纸）",
}));

function notify(message: string, error = false) {
  ElMessage({ message, type: error ? "error" : "success", showClose: true });
}

async function load() {
  loading.value = true;
  try {
    printer.value = (await api.printers())[0];
  } catch (error) {
    printer.value = undefined;
    notify(error instanceof Error ? error.message : "打印机加载失败", true);
  } finally {
    loading.value = false;
  }
}

function openBind() {
  form.name = printer.value?.name ?? "";
  form.sn = printer.value?.sn ?? "";
  form.copies = printer.value?.copies ?? 1;
  form.copiesGapSeconds = printer.value?.copiesGapSeconds ?? 0;
  dialogOpen.value = true;
}

async function save() {
  if (!form.name.trim()) return notify("请填写名称", true);
  if (!form.sn.trim()) return notify("请填写终端号 (SN)", true);
  saving.value = true;
  try {
    await api.bindPrinter({
      name: form.name.trim(),
      sn: form.sn.trim(),
      copies: form.copies,
      copiesGapSeconds: form.copies >= 2 ? form.copiesGapSeconds : 0,
    });
    dialogOpen.value = false;
    notify("打印机已绑定");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", true);
  } finally {
    saving.value = false;
  }
}

async function testPrint() {
  if (!printer.value || testing.value) return;
  testing.value = true;
  try {
    await api.testPrintPrinter(printer.value.id);
    notify("测试小票已发送，请在打印机旁确认出纸");
  } catch (error) {
    notify(error instanceof Error ? error.message : "测试打印失败", true);
  } finally {
    testing.value = false;
  }
}

/** 解绑确认弹窗（对齐账号/角色管理删除确认统一形态：卡片 + 取消/危险主按钮） */
const unbindDialogOpen = ref(false);
const unbindSaving = ref(false);

function unbind() {
  if (!printer.value) return;
  unbindDialogOpen.value = true;
}

async function confirmUnbind() {
  if (!printer.value || unbindSaving.value) return;
  unbindSaving.value = true;
  try {
    await api.unbindPrinter(printer.value.id);
    unbindDialogOpen.value = false;
    notify("打印机已解绑");
    await load();
  } catch (error) {
    unbindDialogOpen.value = false;
    notify(error instanceof Error ? error.message : "解绑失败", true);
  } finally {
    unbindSaving.value = false;
  }
}

function copiesLabel(value: Printer) {
  return copiesOptions.find((item) => item.value === (value.copies ?? 1))?.label ?? "1 联（单张小票）";
}

onMounted(load);
watch(effectiveCampusId, load);
</script>

<template>
  <AdminPageShell
    title="打印机"
    eyebrow="RECEIPT PRINTER"
    description="绑定本校区小票打印机（芯烨云）：支付成功自动出票，绑定后请先测试打印。"
  >
    <div class="table-wrap">
      <div v-if="loading" class="row-skeleton" />
      <div v-else-if="!printer" class="printer-view card">
        <p class="printer-view__hint">本校区还未绑定小票打印机。绑定后支付成功自动出票，订单详情可补打。</p>
        <ElButton v-if="writable && hasPerm('POST /admin/printers')" type="primary" @click="openBind">＋ 绑定打印机</ElButton>
      </div>
      <div v-else class="printer-view card">
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem label="归属校区">{{ printer.campusName || "—" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="名称">{{ printer.name }}</ElDescriptionsItem>
          <ElDescriptionsItem label="终端号 (SN)">{{ printer.sn }}</ElDescriptionsItem>
          <ElDescriptionsItem label="状态"><ElTag :type="printer.status === 'active' ? 'success' : 'info'">{{ printer.status === "active" ? "已启用" : "已停用" }}</ElTag></ElDescriptionsItem>
          <ElDescriptionsItem label="打印联数">{{ copiesLabel(printer) }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="printer.copies >= 2" label="联间间隔">{{ printer.copiesGapSeconds ? `${printer.copiesGapSeconds} 秒` : "连续出纸" }}</ElDescriptionsItem>
          <ElDescriptionsItem label="绑定时间">{{ fmtDateTime(printer.createdAt) }}</ElDescriptionsItem>
        </ElDescriptions>
        <p class="printer-view__hint">与校区一对一绑定；多校区账号请用顶栏切换后分别管理。</p>
        <div v-if="writable" class="printer-view__actions">
          <ElButton v-if="hasPerm('POST /admin/printers/:id/test-print')" type="primary" :loading="testing" @click="testPrint">测试打印</ElButton>
          <ElButton v-if="hasPerm('POST /admin/printers')" @click="openBind">换绑 / 改名</ElButton>
          <ElButton v-if="hasPerm('DELETE /admin/printers/:id')" type="danger" plain @click="unbind">解绑打印机</ElButton>
        </div>
      </div>
    </div>

    <ElDialog v-model="dialogOpen" :title="printer ? '换绑 / 改名' : '绑定打印机'" width="min(560px, calc(100vw - 32px))" align-center :close-on-click-modal="false">
      <ElForm label-position="top" @submit.prevent="save">
        <ElRow :gutter="16"><ElCol :xs="24" :sm="12"><ElFormItem label="名称" required><ElInput v-model.trim="form.name" placeholder="例如：仓内前台小票机" /></ElFormItem></ElCol>
        <ElCol :xs="24" :sm="12"><ElFormItem label="终端号 (SN)" required><ElInput v-model.trim="form.sn" placeholder="机身底部标签 / 自检页上的 SN" /></ElFormItem></ElCol>
        <ElCol :xs="24" :sm="12"><ElFormItem label="打印联数"><ElSelect v-model="form.copies"><ElOption v-for="item in copiesOptions" :key="item.value" :label="item.label" :value="item.value" /></ElSelect></ElFormItem></ElCol>
        <ElCol v-if="form.copies >= 2" :xs="24" :sm="12"><ElFormItem label="联间间隔"><ElSelect v-model="form.copiesGapSeconds"><ElOption v-for="item in gapOptions" :key="item.value" :label="item.label" :value="item.value" /></ElSelect></ElFormItem></ElCol></ElRow>
      </ElForm>
      <template #footer><ElButton @click="dialogOpen = false">取消</ElButton><ElButton type="primary" :loading="saving" @click="save">保存绑定</ElButton></template>
    </ElDialog>

    <!-- 解绑确认弹窗（与账号管理「删除账号」同款卡片形态，文案不变） -->
    <ElDialog
      v-model="unbindDialogOpen"
      class="printer-unbind-dialog"
      title="解绑打印机"
      width="min(420px, 92vw)"
      align-center
      modal-class="printer-unbind-overlay"
      :show-close="!unbindSaving"
      :close-on-click-modal="!unbindSaving"
      :close-on-press-escape="!unbindSaving"
    >
      <p class="unbind-copy">确认解绑打印机「{{ printer?.name }}」？</p>
      <template #footer>
        <ElButton :disabled="unbindSaving" @click="unbindDialogOpen = false">取消</ElButton>
        <ElButton type="danger" :loading="unbindSaving" @click="confirmUnbind">确认解绑</ElButton>
      </template>
    </ElDialog>
  </AdminPageShell>
</template>

<style scoped>
.printer-view :deep(.el-descriptions) { margin-bottom: 16px; }
.printer-view__actions { flex-wrap: wrap; }
/* 解绑确认弹窗：Element Plus 承载行为与可访问性，视觉延续账号/角色管理删除确认卡片。 */
.unbind-copy {
  margin: 0;
  color: #4c5c53;
  font-size: 14px;
  line-height: 1.7;
}
:global(.printer-unbind-overlay) {
  background: #061d1680;
  backdrop-filter: blur(3px);
}
:global(.printer-unbind-dialog.el-dialog) {
  overflow: hidden;
  border-radius: 18px;
  box-shadow: 0 24px 70px #062e2340;
}
:global(.printer-unbind-dialog .el-dialog__header) {
  min-height: 64px;
  margin: 0;
  padding: 20px 26px 16px;
  border-bottom: 1px solid var(--line);
}
:global(.printer-unbind-dialog .el-dialog__title) {
  color: #153628;
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -0.3px;
}
:global(.printer-unbind-dialog .el-dialog__headerbtn) {
  top: 18px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #f0f4f1;
}
:global(.printer-unbind-dialog .el-dialog__headerbtn:hover) {
  background: #e3ece6;
}
:global(.printer-unbind-dialog .el-dialog__headerbtn .el-dialog__close) {
  color: #52645a;
  font-size: 20px;
}
:global(.printer-unbind-dialog .el-dialog__body) {
  padding: 18px 26px 8px;
}
:global(.printer-unbind-dialog .el-dialog__footer) {
  padding: 14px 26px 26px;
  border-top: 1px solid var(--line);
  background: #fff;
  box-shadow: 0 -10px 24px #163f2b0a;
}
@media (max-width: 760px) {
  .printer-view { max-width: none; padding: 18px; }
  .printer-view :deep(.el-descriptions__body) { overflow-x: auto; }
}
</style>

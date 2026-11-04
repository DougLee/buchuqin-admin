<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import type { NightCatalogRow } from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";

/**
 * 夜主档商品管理面板（IKSW1F）：Product 夜主档行（nightCatalog=true）的
 * 列表/创建/编辑/上下架。作为「夜宵店铺」页的 Tab 存在——registry 未给
 * 夜主档单列菜单，perms 归 night-stores / night-stores.write。
 * 售价为「统一夜宵售价」（分）：同校区同 SKU 统一执行（PRD B06）。
 */
const rows = ref<NightCatalogRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const open = ref(false);
const editing = ref<NightCatalogRow | null>(null);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const keyword = ref("");

const form = reactive({
  name: "",
  price: 0,
  originalPrice: 0,
  subtitle: "",
  image: "",
  barcode: "",
  status: "on-sale" as "on-sale" | "off-sale",
});

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

/** ElTable 作用域槽 row 兜底断言（同 CouponPage asCoupon 模式）。 */
function asCatalog(row: unknown) {
  return row as NightCatalogRow;
}

async function load() {
  if (!effectiveCampusId.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const r = await api.nightCatalog(
      keyword.value.trim() || undefined,
      page.value,
      pageSize.value,
    );
    rows.value = r.items;
    total.value = r.total;
  } catch (e) {
    notify(e instanceof Error ? e.message : "夜主档加载失败", "error");
  } finally {
    loading.value = false;
  }
}

function edit(row?: NightCatalogRow) {
  editing.value = row ?? null;
  Object.assign(form, {
    name: row?.name ?? "",
    price: Number(fenToYuan(row?.price ?? 0)),
    originalPrice: Number(fenToYuan(row?.originalPrice ?? 0)),
    subtitle: row?.subtitle ?? "",
    image: row?.image ?? "",
    barcode: row?.barcode ?? "",
    status: row?.status === "off-sale" ? "off-sale" : "on-sale",
  });
  open.value = true;
}

async function save() {
  if (!form.name.trim()) return notify("请填写商品名称", "error");
  if (!(form.price > 0)) return notify("夜宵售价必须大于 0", "error");
  saving.value = true;
  try {
    const priceFen = yuanToFen(form.price);
    const originalFen = form.originalPrice > 0 ? yuanToFen(form.originalPrice) : undefined;
    if (editing.value) {
      await api.updateNightCatalog(editing.value.id, {
        name: form.name.trim(),
        price: priceFen,
        ...(originalFen ? { originalPrice: originalFen } : {}),
        image: form.image,
        subtitle: form.subtitle.trim(),
        status: form.status,
      });
    } else {
      await api.createNightCatalog({
        name: form.name.trim(),
        price: priceFen,
        ...(originalFen ? { originalPrice: originalFen } : {}),
        image: form.image,
        subtitle: form.subtitle.trim(),
        barcode: form.barcode.trim() || undefined,
      });
    }
    open.value = false;
    notify(editing.value ? "夜主档已更新" : "夜主档已创建");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(row: NightCatalogRow) {
  try {
    await api.updateNightCatalog(row.id, {
      status: row.status === "on-sale" ? "off-sale" : "on-sale",
    });
    notify(row.status === "on-sale" ? "已下架（楼栋行不可再备货）" : "已上架");
    await load();
  } catch (e) {
    notify(e instanceof Error ? e.message : "操作失败", "error");
  }
}

watch([page, pageSize, effectiveCampusId], load);
onMounted(load);

defineExpose({ reload: load });
</script>
<template>
  <div>
    <div v-if="!effectiveCampusId" class="empty-hint">请先在顶部选择校区。</div>
    <template v-else>
      <section class="admin-filter-panel admin-filter-panel--split" aria-label="夜主档筛选">
        <div class="catalog-tip">
          夜主档是全校区统一的夜宵商品资料池（名称 / 图 / 条码 / 统一售价）。
          各夜宵店从这里勾选生成楼栋行，楼栋库存与售卖在各店铺详情内管理。
        </div>
        <div class="catalog-search">
          <ElInput
            v-model="keyword"
            clearable
            placeholder="搜索商品名称"
            @keyup.enter="
              page = 1;
              load();
            "
          /><ElButton
            @click="
              page = 1;
              load();
            "
            >查询</ElButton
          >
        </div>
      </section>
      <section class="admin-table-panel" aria-label="夜主档列表">
        <div class="catalog-actions">
          <ElButton
            v-if="hasPerm('POST /admin/night/catalog')"
            type="primary"
            @click="edit()"
            >新建夜主档商品</ElButton
          >
        </div>
        <ElTable v-loading="loading" :data="rows" row-key="id" empty-text="暂无夜主档商品——先建主档，再回各店铺配置楼栋商品">
          <ElTableColumn label="商品" min-width="240">
            <template #default="{ row }">
              <div class="catalog-name">
                <ElImage
                  v-if="row.image"
                  class="catalog-thumb"
                  :src="row.image"
                  fit="cover"
                  :preview-src-list="[row.image]"
                  preview-teleported
                  hide-on-click-modal
                />
                <div v-else class="catalog-thumb catalog-thumb--empty">无图</div>
                <div class="catalog-name-text">
                  <span>{{ row.name }}</span>
                  <span v-if="row.subtitle" class="muted">{{ row.subtitle }}</span>
                </div>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn label="条码" width="140">
            <template #default="{ row }">{{ row.barcode || "—" }}</template>
          </ElTableColumn>
          <ElTableColumn label="统一夜宵售价" width="130">
            <template #default="{ row }">¥{{ fenToYuan(row.price) }}</template>
          </ElTableColumn>
          <ElTableColumn label="划线价" width="100">
            <template #default="{ row }">{{
              row.originalPrice ? `¥${fenToYuan(row.originalPrice)}` : "—"
            }}</template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="100">
            <template #default="{ row }">
              <ElTag :type="row.status === 'on-sale' ? 'success' : 'info'">{{
                row.status === "on-sale" ? "在售" : "已下架"
              }}</ElTag>
            </template>
          </ElTableColumn>
          <ElTableColumn label="更新时间" min-width="150">
            <template #default="{ row }">{{
              row.updatedAt ? row.updatedAt.replace("T", " ").slice(0, 16) : "—"
            }}</template>
          </ElTableColumn>
          <ElTableColumn label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <ElButton
                v-if="hasPerm('PATCH /admin/night/catalog/:id')"
                link
                type="primary"
                @click="edit(asCatalog(row))"
                >编辑</ElButton
              >
              <ElButton
                v-if="hasPerm('PATCH /admin/night/catalog/:id')"
                link
                :type="row.status === 'on-sale' ? 'danger' : 'success'"
                @click="toggleStatus(asCatalog(row))"
                >{{ row.status === "on-sale" ? "下架" : "上架" }}</ElButton
              >
            </template>
          </ElTableColumn>
        </ElTable>
        <AdminPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="total"
        />
      </section>
    </template>
    <ElDialog
      v-model="open"
      :title="editing ? '编辑夜主档商品' : '新建夜主档商品'"
      width="min(680px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm label-position="top">
        <ElRow :gutter="16">
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="商品名称">
              <ElInput v-model="form.name" maxlength="60" show-word-limit />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="条码（选填，同校区唯一）">
              <ElInput v-model="form.barcode" :disabled="!!editing" placeholder="扫码枪输入或手填" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="统一夜宵售价（元）">
              <ElInputNumber v-model="form.price" :min="0.01" :precision="2" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="划线价（元，0 = 不显示）">
              <ElInputNumber v-model="form.originalPrice" :min="0" :precision="2" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="24">
            <ElFormItem label="副标题（选填）">
              <ElInput v-model="form.subtitle" maxlength="60" />
            </ElFormItem>
          </ElCol>
          <ElCol :span="24">
            <ElFormItem label="商品图">
              <ImageUploadField v-model="form.image" />
            </ElFormItem>
          </ElCol>
          <ElCol v-if="editing" :xs="24" :sm="12">
            <ElFormItem label="上下架状态">
              <ElSelect v-model="form.status">
                <ElOption label="在售" value="on-sale" />
                <ElOption label="已下架" value="off-sale" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
        </ElRow>
      </ElForm>
      <template #footer>
        <ElButton @click="open = false">取消</ElButton>
        <ElButton type="primary" :loading="saving" @click="save">保存</ElButton>
      </template>
    </ElDialog>
  </div>
</template>
<style scoped>
.empty-hint {
  padding: 48px;
  text-align: center;
  color: var(--muted);
}
.catalog-tip {
  flex: 1 1 320px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  align-self: center;
}
.catalog-search {
  display: flex;
  align-items: center;
  gap: 10px;
}
.catalog-search :deep(.el-input) {
  flex: 1 1 220px;
}
.catalog-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.catalog-name {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.catalog-thumb {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 8px;
  border: 1px solid var(--line);
}
.catalog-thumb--empty {
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--muted);
  border-style: dashed;
}
.catalog-name-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 760px) {
  .catalog-search {
    align-items: stretch;
    flex-direction: column;
  }
  .catalog-search :deep(.el-button) {
    min-height: 44px;
    margin: 0;
  }
}
</style>

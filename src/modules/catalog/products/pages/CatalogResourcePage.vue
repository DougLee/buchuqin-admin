<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { api } from "../../../../api";
import {
  accountOrganizationId,
  accountOrgLevel,
  hasPerm,
} from "../../../../session";
import type {
  AdminOrganization,
  Campus,
  Category,
  Product,
} from "../../../../types";
import { fenToYuan, yuanToFen } from "../../../../utils/money";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";

const props = defineProps<{ mode: "platform" | "org" }>();
const isPlatformCatalog = computed(() => props.mode === "platform");
const title = computed(() =>
  isPlatformCatalog.value ? "平台商品目录" : "组织商品",
);
const description = computed(() =>
  isPlatformCatalog.value
    ? "维护平台统一商品资料和平台供货价格，不受顶部当前校区影响。"
    : "维护组织自己的商品目录、采购来源和组织供货价格，不受顶部当前校区影响。",
);
const rows = ref<Product[]>([]),
  organizations = ref<AdminOrganization[]>([]),
  campuses = ref<Campus[]>([]),
  categories = ref<Category[]>([]);
const loading = ref(false),
  saving = ref(false),
  editorOpen = ref(false),
  importOpen = ref(false);
const keyword = ref(""),
  page = ref(1),
  pageSize = ref(20),
  total = ref(0);
const selectedOrganizationId = ref(accountOrganizationId.value ?? "");
const editingId = ref<string | null>(null),
  importing = ref<Product | null>(null),
  targetCampusId = ref("");
const form = reactive({
  name: "",
  subtitle: "",
  barcode: "",
  categoryId: "",
  price: 0,
  originalPrice: 0,
  costPrice: 0,
  wholesalePrice: 0,
  supplyMode: "platform" as "platform" | "local",
  status: "off-sale",
});
const organizationRequired = computed(
  () => !isPlatformCatalog.value && accountOrgLevel.value === "platform",
);
const effectiveOrganizationId = computed(() =>
  organizationRequired.value
    ? selectedOrganizationId.value
    : (accountOrganizationId.value ?? ""),
);
const canCreate = computed(() =>
  hasPerm(
    isPlatformCatalog.value
      ? "POST /admin/platform-products"
      : "POST /admin/org-products",
  ),
);
const canUpdate = computed(() =>
  hasPerm(
    isPlatformCatalog.value
      ? "PATCH /admin/platform-products/:id"
      : "PATCH /admin/org-products/:id",
  ),
);
const canImport = computed(
  () =>
    !isPlatformCatalog.value && hasPerm("POST /admin/org-products/:id/import"),
);
const notify = (message: string, type: "success" | "error" = "success") =>
  ElMessage({ message, type, showClose: true });
const asProduct = (row: unknown) => row as Product;

function resetForm(row?: Product) {
  editingId.value = row?.id ?? null;
  Object.assign(form, {
    name: row?.name ?? "",
    subtitle: row?.subtitle ?? "",
    barcode: row?.barcode ?? "",
    categoryId: row?.categoryId ?? "",
    price: Number(fenToYuan(row?.price ?? 0)),
    originalPrice: Number(fenToYuan(row?.originalPrice ?? 0)),
    costPrice: Number(fenToYuan(row?.costPrice ?? 0)),
    wholesalePrice: Number(fenToYuan(row?.wholesalePrice ?? row?.price ?? 0)),
    supplyMode: row?.supplyMode ?? "platform",
    status: row?.status ?? "off-sale",
  });
  editorOpen.value = true;
}
async function load() {
  if (organizationRequired.value && !effectiveOrganizationId.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  try {
    const query = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
    };
    const result = isPlatformCatalog.value
      ? await api.platformProducts(query)
      : await api.orgProducts(
          query,
          effectiveOrganizationId.value || undefined,
        );
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    notify(
      error instanceof Error ? error.message : "商品目录加载失败",
      "error",
    );
  } finally {
    loading.value = false;
  }
}
async function save() {
  if (!form.name.trim() || !form.categoryId) {
    notify("请填写商品名称并选择类别", "error");
    return;
  }
  if (
    !isPlatformCatalog.value &&
    form.supplyMode === "local" &&
    form.costPrice < 0
  ) {
    notify("自主采购必须填写组织进货价", "error");
    return;
  }
  const data: Record<string, unknown> = {
    name: form.name.trim(),
    subtitle: form.subtitle.trim(),
    barcode: form.barcode.trim() || undefined,
    categoryId: form.categoryId,
    price: yuanToFen(form.price),
    originalPrice: yuanToFen(form.originalPrice),
    stock: 0,
    status: form.status,
  };
  if (isPlatformCatalog.value)
    Object.assign(data, {
      costPrice: yuanToFen(form.costPrice),
      wholesalePrice: yuanToFen(form.wholesalePrice || form.price),
    });
  else
    Object.assign(data, {
      supplyMode: form.supplyMode,
      costPrice:
        form.supplyMode === "local" ? yuanToFen(form.costPrice) : undefined,
    });
  saving.value = true;
  try {
    if (isPlatformCatalog.value) {
      if (editingId.value)
        await api.updatePlatformProduct(editingId.value, data);
      else await api.createPlatformProduct(data);
    } else {
      if (editingId.value)
        await api.updateOrgProduct(
          editingId.value,
          data,
          effectiveOrganizationId.value || undefined,
        );
      else
        await api.createOrgProduct(
          data,
          effectiveOrganizationId.value || undefined,
        );
    }
    editorOpen.value = false;
    notify(editingId.value ? "商品已更新" : "商品已创建");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
function openImport(row: Product) {
  importing.value = row;
  targetCampusId.value = "";
  importOpen.value = true;
}
async function submitImport() {
  if (!importing.value || !targetCampusId.value) {
    notify("请选择目标校区", "error");
    return;
  }
  saving.value = true;
  try {
    await api.importOrgProduct(
      importing.value.id,
      targetCampusId.value,
      effectiveOrganizationId.value || undefined,
    );
    importOpen.value = false;
    notify("已导入目标校区");
  } catch (error) {
    notify(error instanceof Error ? error.message : "导入失败", "error");
  } finally {
    saving.value = false;
  }
}
async function bootstrap() {
  const tasks: Promise<unknown>[] = [api.adminCategories()];
  if (!isPlatformCatalog.value && accountOrgLevel.value === "platform")
    tasks.push(api.organizations());
  if (!isPlatformCatalog.value)
    tasks.push(api.campuses({ page: 1, pageSize: 1000 }));
  const result = await Promise.all(tasks);
  categories.value = result[0] as Category[];
  let index = 1;
  if (!isPlatformCatalog.value && accountOrgLevel.value === "platform")
    organizations.value = result[index++] as AdminOrganization[];
  if (!isPlatformCatalog.value) campuses.value = result[index] as Campus[];
  await load();
}
const targetCampuses = computed(() =>
  campuses.value.filter(
    (c) =>
      !effectiveOrganizationId.value ||
      c.organizationId === effectiveOrganizationId.value,
  ),
);
watch([page, pageSize], load);
watch([keyword, selectedOrganizationId], () => {
  page.value = 1;
  void load();
});
onMounted(
  () =>
    void bootstrap().catch((error) =>
      notify(error instanceof Error ? error.message : "页面加载失败", "error"),
    ),
);
</script>

<template>
  <AdminPageShell
    :title="title"
    eyebrow="CATALOG RESOURCE"
    :description="description"
  >
    <template #actions
      ><ElButton
        v-if="canCreate"
        type="primary"
        :disabled="organizationRequired && !effectiveOrganizationId"
        @click="resetForm()"
        >＋ 新建商品</ElButton
      ></template
    >
    <section class="catalog-filter-panel" aria-label="商品筛选">
      <ElForm class="catalog-toolbar" label-position="top"
        ><ElRow :gutter="12" align="bottom">
          <ElCol v-if="organizationRequired" :xs="24" :sm="8"
            ><ElSelect
              v-model="selectedOrganizationId"
              clearable
              filterable
              placeholder="先选择组织"
              class="org-select"
            >
              <ElOption
                v-for="org in organizations"
                :key="org.id"
                :label="org.name"
                :value="org.id"
              />
            </ElSelect>
          </ElCol>
          <ElCol :xs="24" :sm="organizationRequired ? 10 : 18"
            ><ElInput
              v-model="keyword"
              clearable
              placeholder="搜索商品名称或条码"
              class="catalog-search"
          /></ElCol>
          <ElCol :xs="24" :sm="6"
            ><ElFormItem label=" "
              ><ElButton :loading="loading" @click="load"
                >刷新</ElButton
              ></ElFormItem
            ></ElCol
          >
        </ElRow></ElForm
      >
    </section>
    <section class="catalog-table-panel" aria-label="商品列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        :empty-text="
          organizationRequired && !effectiveOrganizationId
            ? '请先选择组织'
            : '暂无商品'
        "
      >
        <ElTableColumn prop="name" label="商品" min-width="220"
          ><template #default="{ row }"
            ><strong>{{ row.name }}</strong>
            <div class="cell-sub">
              {{ row.barcode || row.subtitle || "—" }}
            </div></template
          ></ElTableColumn
        >
        <ElTableColumn label="供货价" width="120"
          ><template #default="{ row }"
            >¥{{ fenToYuan(row.price) }}</template
          ></ElTableColumn
        >
        <ElTableColumn v-if="isPlatformCatalog" label="平台进货价" width="130"
          ><template #default="{ row }">{{
            row.costPrice == null
              ? "无权限查看"
              : `¥${fenToYuan(row.costPrice)}`
          }}</template></ElTableColumn
        >
        <ElTableColumn v-else label="采购来源" width="120"
          ><template #default="{ row }"
            ><ElTag
              :type="row.supplyMode === 'local' ? 'warning' : 'success'"
              >{{ row.supplyMode === "local" ? "自主采购" : "平台供货" }}</ElTag
            ></template
          ></ElTableColumn
        >
        <ElTableColumn v-if="!isPlatformCatalog" label="组织进货价" width="130"
          ><template #default="{ row }">{{
            row.costPrice == null ? "—" : `¥${fenToYuan(row.costPrice)}`
          }}</template></ElTableColumn
        >
        <ElTableColumn label="状态" width="100"
          ><template #default="{ row }"
            ><ElTag :type="row.status === 'on-sale' ? 'success' : 'info'">{{
              row.status === "on-sale" ? "已启用" : "已停用"
            }}</ElTag></template
          ></ElTableColumn
        >
        <ElTableColumn label="操作" fixed="right" width="190"
          ><template #default="{ row }"
            ><ElButton
              v-if="canUpdate"
              size="small"
              type="primary"
              @click="resetForm(asProduct(row))"
              >编辑</ElButton
            ><ElButton
              v-if="canImport"
              size="small"
              @click="openImport(asProduct(row))"
              >导入校区</ElButton
            ></template
          ></ElTableColumn
        >
      </ElTable>
      <AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>

    <ElDialog
      v-model="editorOpen"
      :title="editingId ? `编辑${title}` : `新建${title}`"
      width="min(720px, calc(100vw - 32px))"
      align-center
      destroy-on-close
      :close-on-click-modal="false"
    >
      <ElForm label-position="top"
        ><ElRow :gutter="16">
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="商品名称"
              ><ElInput v-model="form.name" maxlength="80" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="商品类别"
              ><ElSelect v-model="form.categoryId" filterable
                ><ElOption
                  v-for="item in categories"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></ElSelect></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="条码"
              ><ElInput v-model="form.barcode" maxlength="14" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="副标题"
              ><ElInput v-model="form.subtitle" maxlength="120" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem
              :label="
                isPlatformCatalog ? '平台批发价（元）' : '组织供货价（元）'
              "
              ><ElInputNumber
                v-model="form.price"
                :min="0"
                :precision="2" /></ElFormItem
          ></ElCol>
          <ElCol :xs="24" :sm="12"
            ><ElFormItem label="建议零售价（元）"
              ><ElInputNumber
                v-model="form.originalPrice"
                :min="0"
                :precision="2" /></ElFormItem
          ></ElCol>
          <template v-if="isPlatformCatalog"
            ><ElCol :xs="24" :sm="12"
              ><ElFormItem label="平台进货价（元）"
                ><ElInputNumber
                  v-model="form.costPrice"
                  :min="0"
                  :precision="2" /></ElFormItem></ElCol
            ><ElCol :xs="24" :sm="12"
              ><ElFormItem label="平台批发价（元）"
                ><ElInputNumber
                  v-model="form.wholesalePrice"
                  :min="0"
                  :precision="2" /></ElFormItem></ElCol
          ></template>
          <template v-else
            ><ElCol :xs="24" :sm="12"
              ><ElFormItem label="采购来源"
                ><ElSelect v-model="form.supplyMode"
                  ><ElOption label="从平台进货" value="platform" /><ElOption
                    label="组织自主采购"
                    value="local" /></ElSelect></ElFormItem></ElCol
            ><ElCol v-if="form.supplyMode === 'local'" :xs="24" :sm="12"
              ><ElFormItem label="组织进货价（元）"
                ><ElInputNumber
                  v-model="form.costPrice"
                  :min="0"
                  :precision="2" /></ElFormItem></ElCol
          ></template> </ElRow
      ></ElForm>
      <template #footer
        ><ElButton @click="editorOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="save"
          >保存</ElButton
        ></template
      >
    </ElDialog>
    <ElDialog
      v-model="importOpen"
      title="导入组织内校区"
      width="min(520px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
    >
      <ElForm label-position="top"
        ><ElRow
          ><ElCol :span="24"
            ><ElFormItem label="目标校区"
              ><ElSelect
                v-model="targetCampusId"
                filterable
                placeholder="选择校区"
                ><ElOption
                  v-for="campus in targetCampuses"
                  :key="campus.id"
                  :label="campus.name"
                  :value="campus.id" /></ElSelect></ElFormItem></ElCol></ElRow
      ></ElForm>
      <template #footer
        ><ElButton @click="importOpen = false">取消</ElButton
        ><ElButton type="primary" :loading="saving" @click="submitImport"
          >确认导入</ElButton
        ></template
      >
    </ElDialog>
  </AdminPageShell>
</template>

<style scoped>
.catalog-filter-panel,
.catalog-table-panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 8px 24px #163f2b08;
}
.catalog-filter-panel {
  padding: 16px 18px;
  margin-bottom: 18px;
}
.catalog-toolbar :deep(.el-form-item) {
  margin-bottom: 0;
}
.catalog-search,
.org-select,
.catalog-toolbar :deep(.el-input),
.catalog-toolbar :deep(.el-select) {
  width: 100%;
}
.catalog-table-panel {
  overflow: hidden;
}
.el-select,
.el-input-number {
  width: 100%;
}
@media (max-width: 760px) {
  .catalog-filter-panel {
    padding: 12px;
    border-radius: 14px;
  }
  .catalog-toolbar :deep(.el-form-item) {
    margin-bottom: 10px;
  }
  .catalog-toolbar :deep(.el-col:last-child .el-form-item) {
    margin-bottom: 0;
  }
  .catalog-table-panel {
    border-radius: 14px;
  }
}
</style>

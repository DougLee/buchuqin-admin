<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import ImageUploadField from "../../../../components/ImageUploadField.vue";
import ProductPickerField from "../../../../components/ProductPickerField.vue";
import { BANNER_COLOR_TEXT, BANNER_PLACEMENT_TEXT } from "../../../../dicts";
import { effectiveCampusId, hasPerm } from "../../../../session";
import AdminPageShell from "../../../../shared/ui/AdminPageShell.vue";
import AdminPagination from "../../../../shared/ui/AdminPagination.vue";
import type { Banner , Product } from "../../../../types";
import { resolveImageUrl } from "../../../../utils/image";

const props = withDefaults(
  defineProps<{ placement?: "pay-success"; embedded?: boolean }>(),
  { embedded: false },
);
const rows = ref<Banner[]>([]),
  loading = ref(false),
  saving = ref(false),
  editorOpen = ref(false);
const page = ref(1),
  pageSize = ref(10),
  total = ref(0),
  keyword = ref(""),
  status = ref("");
const editing = ref<Banner | null>(null);
const title = computed(() =>
  props.placement === "pay-success" ? "支付广告位" : "Banner 配置",
);
const description = computed(() =>
  props.placement === "pay-success"
    ? "管理本校区支付成功页广告素材。"
    : "管理本校区小程序首页轮播和展示内容。",
);
const form = reactive({
  title: "",
  subtitle: "",
  badge: "",
  color: "green",
  placement: "home" as "home" | "pay-success",
  sort: 0,
  image: "",
  detailImage: "",
  linkType: "none" as "none" | "page",
  linkUrl: "",
  status: "active",
});
const linkPages = [
  /** IKR14X：商品详情为哨兵值——选中时展开选品器（ProductPickerField），
   *  拣定商品回填真实路径；哨兵不落库（保存时 linkUrl 已是真实路径） */
  { value: "PRODUCT_DETAIL", label: "商品详情（选商品）" },
  { value: "pages/coupons/index", label: "优惠券中心" },
  { value: "pages/orders/index", label: "我的订单" },
  { value: "pages/address/index", label: "寝室地址" },
  { value: "pages/category/index", label: "全部商品" },
  { value: "pages/cart/index", label: "购物车" },
  { value: "pages/profile/index", label: "我的" },
  { value: "pages/campus/index", label: "楼栋选择" },
];
/* ---------- IKR14X 商品选品（复用 ProductPickerField 公共组件） ---------- */
const PRODUCT_PATH_RE = /^pages\/product\/detail\?id=(.+)$/;
const pickerProducts = ref<Product[]>([]);
const pickerLoading = ref(false);
/** 下框显示值：linkUrl 是商品路径→哨兵；否则原值（allow-create 手输兼容） */
const linkSelect = computed({
  get: () =>
    PRODUCT_PATH_RE.test(form.linkUrl)
      ? "PRODUCT_DETAIL"
      : form.linkUrl,
  set: (v: string) => {
    if (v !== "PRODUCT_DETAIL") {
      form.linkUrl = v;
      return;
    }
    // 切到哨兵：保持现值（商品已选）或清空待选
    if (!PRODUCT_PATH_RE.test(form.linkUrl)) form.linkUrl = "";
  },
});
/** 选品器拣定 → 回填真实路径（保存链路零改动） */
function pickProduct(value: string | Record<string, number>) {
  if (typeof value !== "string") return;
  form.linkUrl = `pages/product/detail?id=${value}`;
}
/** 展开选品器时拉本校区在售商品（pageSize 上限 100，与促销/推荐位同口径） */
watch(linkSelect, (v) => {
  if (v === "PRODUCT_DETAIL" && !pickerProducts.value.length) {
    pickerLoading.value = true;
    void api
      .products(
        {
          page: 1,
          pageSize: 100,
          status: "on-sale",
          campusId: effectiveCampusId.value,
        },
        "campus",
      )
      .then((r) => {
        pickerProducts.value = r.items;
      })
      .catch(() => {
        ElMessage.error("在售商品加载失败");
      })
      .finally(() => {
        pickerLoading.value = false;
      });
  }
});
const canCreate = computed(() => hasPerm("POST /admin/banners"));
const canUpdate = computed(() => hasPerm("PATCH /admin/banners/:id"));
const canDelete = computed(() => hasPerm("DELETE /admin/banners/:id"));
let timer: number | undefined;
function asBanner(row: unknown) {
  return row as Banner;
}
function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}
async function load() {
  loading.value = true;
  try {
    const result = await api.banners(
      {
        page: page.value,
        pageSize: pageSize.value,
        keyword: keyword.value.trim() || undefined,
      },
      props.placement,
      status.value || undefined,
    );
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    notify(error instanceof Error ? error.message : "Banner 加载失败", "error");
  } finally {
    loading.value = false;
  }
}
function openEditor(row?: Banner) {
  editing.value = row ?? null;
  Object.assign(form, {
    title: row?.title ?? "",
    subtitle: row?.subtitle ?? "",
    badge: row?.badge ?? "",
    color: row?.color ?? "green",
    placement: row?.placement ?? props.placement ?? "home",
    sort: row?.sort ?? 0,
    image: row?.image ?? "",
    detailImage: row?.detailImage ?? "",
    linkType: row?.linkType ?? "none",
    linkUrl: row?.linkUrl ?? "",
    status: row?.status ?? "active",
  });
  editorOpen.value = true;
}
async function save() {
  if (!form.title.trim()) {
    notify("请填写标题", "error");
    return;
  }
  saving.value = true;
  const data = {
    ...form,
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    badge: form.badge.trim(),
    image: form.image || null,
    detailImage: form.detailImage || null,
    linkUrl: form.linkType === "page" ? form.linkUrl.trim() : "",
  };
  try {
    if (editing.value) await api.updateBanner(editing.value.id, data);
    else await api.createBanner(data);
    editorOpen.value = false;
    notify(editing.value ? "Banner 已更新" : "Banner 已创建");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "保存失败", "error");
  } finally {
    saving.value = false;
  }
}
async function toggle(row: Banner) {
  try {
    await api.updateBanner(row.id, {
      status: row.status === "hidden" ? "active" : "hidden",
    });
    notify(row.status === "hidden" ? "Banner 已启用" : "Banner 已隐藏");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "操作失败", "error");
  }
}
async function remove(row: Banner) {
  try {
    await ElMessageBox.confirm(`确认删除“${row.title}”？`, "删除 Banner", {
      type: "warning",
      confirmButtonText: "确认删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await api.deleteBanner(row.id);
    notify("Banner 已删除");
    await load();
  } catch (error) {
    notify(error instanceof Error ? error.message : "删除失败", "error");
  }
}
watch([page, pageSize, status, effectiveCampusId], load);
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
    :title="title"
    eyebrow="MARKETING CONTENT"
    :description="description"
  >
    <template #actions
      ><ElButton v-if="canCreate" type="primary" @click="openEditor()"
        >新建</ElButton
      ></template
    >
    <section class="admin-filter-panel" aria-label="Banner 筛选">
      <ElForm class="admin-filter-form" label-position="top"
        ><ElRow :gutter="12" align="bottom"
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="搜索 Banner"
              ><ElInput
                v-model="keyword"
                clearable
                placeholder="搜索标题" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElFormItem label="状态"
              ><ElSelect v-model="status" clearable placeholder="全部状态"
                ><ElOption label="启用" value="active" /><ElOption
                  label="隐藏"
                  value="hidden" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="6"
            ><ElFormItem label=" "
              ><ElButton :loading="loading" @click="load"
                >刷新</ElButton
              ></ElFormItem
            ></ElCol
          ></ElRow
        ></ElForm
      >
    </section>
    <section class="admin-table-panel" aria-label="Banner 列表">
      <ElTable
        v-loading="loading"
        :data="rows"
        row-key="id"
        empty-text="暂无 Banner"
        ><ElTableColumn label="图片" width="100"
          ><template #default="{ row }"
            ><ElImage
              v-if="row.image"
              :src="resolveImageUrl(row.image)"
              fit="cover"
              class="thumb"
              ><template #error>—</template></ElImage
            ><span v-else>—</span></template
          ></ElTableColumn
        ><ElTableColumn
          prop="title"
          label="标题"
          min-width="180"
        /><ElTableColumn v-if="!placement" label="位置" width="120"
          ><template #default="{ row }">{{
            BANNER_PLACEMENT_TEXT[row.placement || "home"] || row.placement
          }}</template></ElTableColumn
        ><ElTableColumn label="主题" width="100"
          ><template #default="{ row }">{{
            BANNER_COLOR_TEXT[row.color] || row.color
          }}</template></ElTableColumn
        ><ElTableColumn prop="sort" label="排序" width="80" /><ElTableColumn
          label="状态"
          width="100"
          ><template #default="{ row }"
            ><ElTag :type="row.status === 'active' ? 'success' : 'info'">{{
              row.status === "active" ? "启用" : "隐藏"
            }}</ElTag></template
          ></ElTableColumn
        ><ElTableColumn label="操作" fixed="right" width="210"
          ><template #default="{ row }"
            ><ElButton
              v-if="canUpdate"
              size="small"
              type="primary"
              @click="openEditor(asBanner(row))"
              >编辑</ElButton
            ><ElButton
              v-if="canUpdate"
              size="small"
              @click="toggle(asBanner(row))"
              >{{ row.status === "hidden" ? "启用" : "隐藏" }}</ElButton
            ><ElButton
              v-if="canDelete"
              size="small"
              type="danger"
              plain
              @click="remove(asBanner(row))"
              >删除</ElButton
            ></template
          ></ElTableColumn
        ></ElTable
      ><AdminPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="total"
      />
    </section>
    <ElDialog
      v-model="editorOpen"
      :title="editing ? '编辑 Banner' : '新建 Banner'"
      width="min(760px, calc(100vw - 32px))"
      align-center
      :close-on-click-modal="false"
      ><ElForm label-position="top"
        ><ElRow :gutter="16"
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="标题"
              ><ElInput
                v-model="form.title"
                maxlength="80" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="副标题"
              ><ElInput
                v-model="form.subtitle"
                maxlength="120" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="角标"
              ><ElInput
                v-model="form.badge"
                maxlength="20" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="主题色"
              ><ElSelect v-model="form.color"
                ><ElOption label="绿色" value="green" /><ElOption
                  label="橙色"
                  value="orange" /><ElOption
                  label="深色"
                  value="dark" /></ElSelect></ElFormItem></ElCol
          ><ElCol v-if="!placement" :xs="24" :sm="12"
            ><ElFormItem label="展示位置"
              ><ElSelect v-model="form.placement"
                ><ElOption label="首页轮播" value="home" /><ElOption
                  label="支付成功页"
                  value="pay-success" /></ElSelect></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="排序"
              ><ElInputNumber
                v-model="form.sort"
                :min="0" /></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="主图"
              ><ImageUploadField
                v-model="form.image"
                folder="app/banner" /></ElFormItem></ElCol
          ><ElCol :span="24"
            ><ElFormItem label="详情长图"
              ><ImageUploadField
                v-model="form.detailImage"
                folder="app/banner" /></ElFormItem></ElCol
          ><ElCol :xs="24" :sm="12"
            ><ElFormItem label="点击行为"
              ><ElSelect v-model="form.linkType"
                ><ElOption label="不跳转" value="none" /><ElOption
                  label="跳转站内页面"
                  value="page" /></ElSelect></ElFormItem></ElCol
          ><ElCol v-if="form.linkType === 'page'" :xs="24" :sm="12"
            ><ElFormItem label="目标页面"
              ><ElSelect v-model="linkSelect" filterable allow-create
                ><ElOption
                  v-for="item in linkPages"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></ElSelect
              ><!-- IKR14X：选「商品详情」展开公共选品器（促销/推荐位同款），
                  拣定自动回填 linkUrl，零手拼 -->
              <template v-if="linkSelect === 'PRODUCT_DETAIL'"
                ><ProductPickerField
                  class="banner-picker"
                  :items="pickerProducts"
                  :loading="pickerLoading"
                  :model-value="PRODUCT_PATH_RE.exec(form.linkUrl)?.[1] ?? ''"
                  simple
                  @update:model-value="pickProduct" /></template
            ></ElFormItem></ElCol
          ><ElCol v-if="editing" :xs="24" :sm="12"
            ><ElFormItem label="状态"
              ><ElSelect v-model="form.status"
                ><ElOption label="启用" value="active" /><ElOption
                  label="隐藏"
                  value="hidden" /></ElSelect></ElFormItem></ElCol></ElRow></ElForm
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
/* IKR14X：Banner 表单内选品器占满FormItem内容区 */
.banner-picker {
  width: 100%;
  margin-top: 10px;
}
.thumb {
  width: 64px;
  height: 44px;
  border-radius: 8px;
}
.el-select,
.el-input-number {
  width: 100%;
}
</style>

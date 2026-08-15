<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { api, ensureLogin } from "../api";
const route = useRoute(),
  rows = ref<any[]>([]),
  loading = ref(true),
  keyword = ref(""),
  selected = ref<any>(),
  message = ref(""),
  creating = ref(false),
  scanning = ref(false),
  video = ref<HTMLVideoElement>(),
  scanError = ref(""),
  productForm = ref({
    barcode: "",
    name: "",
    subtitle: "",
    categoryId: "snack",
    price: 0,
    originalPrice: 0,
    stock: 0,
    tag: "新品",
    image: "",
    weight: 0,
  });
const statusFilter = ref("all"),
  page = ref(1),
  pageSize = 10;
let cameraStream: MediaStream | undefined;
const configs: Record<string, any> = {
  orders: {
    title: "订单与履约",
    eyebrow: "ORDER CONTROL",
    desc: "监控订单全生命周期与两段配送进度。",
    loader: api.orders,
    columns: [
      ["orderNo", "订单编号"],
      ["statusText", "当前状态"],
      ["payableAmount", "实付金额"],
      ["estimatedArrival", "时效"],
      ["packageNo", "包裹"],
    ],
  },
  products: {
    title: "商品管理",
    eyebrow: "PRODUCT CENTER",
    desc: "维护商品资料、校园售价与销售状态。",
    loader: api.products,
    columns: [
      ["skuNo", "SKU"],
      ["name", "商品"],
      ["categoryId", "分类"],
      ["price", "售价"],
      ["availableStock", "可售库存"],
      ["status", "状态"],
    ],
  },
  inventory: {
    title: "库存与批次",
    eyebrow: "WAREHOUSE INVENTORY",
    desc: "掌握实际、锁定和可售库存，提前处理临期预警。",
    loader: api.inventory,
    columns: [
      ["skuNo", "SKU"],
      ["name", "商品"],
      ["batchNo", "批次"],
      ["actualStock", "实际"],
      ["lockedStock", "锁定"],
      ["availableStock", "可售"],
      ["expiryDate", "有效期"],
    ],
  },
  staff: {
    title: "履约人员",
    eyebrow: "TEAM PERFORMANCE",
    desc: "楼长与配送员状态、绩效和服务范围。",
    loader: api.staff,
    columns: [
      ["staffNo", "工号"],
      ["name", "姓名"],
      ["roleText", "角色"],
      ["building", "服务范围"],
      ["completedToday", "今日完成"],
      ["onTimeRate", "准时率"],
      ["online", "状态"],
    ],
  },
  "after-sales": {
    title: "售后与退款",
    eyebrow: "AFTER-SALES DESK",
    desc: "集中审核质量投诉、退款与异常凭证。",
    loader: api.afterSales,
    columns: [
      ["id", "售后单"],
      ["type", "类型"],
      ["description", "问题描述"],
      ["status", "状态"],
      ["createdAt", "申请时间"],
    ],
  },
  finance: {
    title: "财务结算",
    eyebrow: "FINANCE SETTLEMENT",
    desc: "月度账单、配送提成和跨期调整。",
    loader: api.settlements,
    columns: [
      ["staffName", "人员"],
      ["roleText", "角色"],
      ["period", "账期"],
      ["baseSalary", "底薪"],
      ["commission", "提成"],
      ["adjustment", "调整"],
      ["payable", "应结"],
      ["status", "状态"],
    ],
  },
  campuses: {
    title: "校园与组织",
    eyebrow: "CAMPUS NETWORK",
    desc: "管理校园、仓库、楼栋和寝室服务网络。",
    loader: api.campuses,
    columns: [
      ["name", "校园"],
      ["warehouseName", "仓库"],
      ["buildings", "楼栋"],
      ["rooms", "寝室"],
      ["users", "用户"],
      ["status", "状态"],
    ],
  },
  marketing: {
    title: "营销活动",
    eyebrow: "GROWTH CAMPAIGNS",
    desc: "配置优惠券预算、领取门槛与核销效果。",
    loader: api.coupons,
    columns: [
      ["name", "优惠券"],
      ["amount", "面额"],
      ["threshold", "门槛"],
      ["issued", "发放"],
      ["claimed", "领取"],
      ["used", "核销"],
      ["status", "状态"],
    ],
  },
  audit: {
    title: "审计日志",
    eyebrow: "AUDIT TRAIL",
    desc: "追踪关键状态、金额与权限变更。",
    loader: api.audits,
    columns: [
      ["createdAt", "时间"],
      ["operator", "操作人"],
      ["action", "动作"],
      ["entityType", "对象"],
      ["entityId", "对象 ID"],
    ],
  },
};
const section = computed(() => String(route.params.section)),
  config = computed(() => configs[section.value] || configs.orders),
  filtered = computed(() =>
    rows.value.filter(
      (row) =>
        JSON.stringify(row)
          .toLowerCase()
          .includes(keyword.value.toLowerCase()) &&
        (statusFilter.value === "all" ||
          [row.status, row.statusText, String(row.online)].some((value) =>
            String(value ?? "").includes(statusFilter.value),
          )),
    ),
  ),
  totalPages = computed(() =>
    Math.max(1, Math.ceil(filtered.value.length / pageSize)),
  ),
  paged = computed(() =>
    filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize),
  );
async function load() {
  loading.value = true;
  await ensureLogin();
  rows.value = await config.value.loader();
  loading.value = false;
}
onMounted(load);
watch(
  () => route.query.q,
  (value) => {
    keyword.value = String(value ?? "");
    page.value = 1;
  },
  { immediate: true },
);
watch([keyword, statusFilter], () => (page.value = 1));
watch(
  () => route.params.section,
  () => {
    selected.value = undefined;
    load();
  },
);
function display(row: any, key: string) {
  const v = row[key];
  if (typeof v === "boolean") return v ? "在线" : "离线";
  if (
    typeof v === "number" &&
    [
      "price",
      "payableAmount",
      "baseSalary",
      "commission",
      "adjustment",
      "payable",
    ].includes(key)
  )
    return `¥${v}`;
  if (key === "onTimeRate") return `${v}%`;
  if (key === "createdAt") return String(v).replace("T", " ").slice(0, 16);
  return v ?? "—";
}
async function act(action: string) {
  if (!selected.value) return;
  if (section.value === "products")
    await api.updateProduct(selected.value.id, {
      price: Number(selected.value.price),
      stock: Number(selected.value.availableStock),
    });
  else if (section.value === "orders")
    await api.orderAction(selected.value.id, action);
  else if (section.value === "after-sales")
    await api.reviewAfterSale(selected.value.id, action === "approve");
  message.value = "操作成功，数据已同步";
  selected.value = undefined;
  await load();
  setTimeout(() => (message.value = ""), 2200);
}
function exportData() {
  const csv = [
    config.value.columns.map((c: any) => c[1]),
    ...filtered.value.map((row) =>
      config.value.columns.map((c: any) => display(row, c[0])),
    ),
  ]
    .map((line) =>
      line.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(["\ufeff" + csv], { type: "text/csv" }),
  );
  a.download = `${config.value.title}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function openCreate() {
  if (section.value !== "products") return;
  creating.value = true;
  scanError.value = "";
  productForm.value = {
    barcode: "",
    name: "",
    subtitle: "",
    categoryId: "snack",
    price: 0,
    originalPrice: 0,
    stock: 0,
    tag: "新品",
    image: "",
    weight: 0,
  };
}
function closeCreate() {
  stopScan();
  creating.value = false;
}
async function lookup() {
  const code = productForm.value.barcode.trim();
  if (!/^\d{8,14}$/.test(code)) {
    scanError.value = "请输入 8—14 位商品条码";
    return;
  }
  const result = await api.lookupBarcode(code);
  if (result.found && result.exists !== false) {
    scanError.value = "该商品已存在，可直接编辑库存与价格";
    selected.value = {
      ...result.product,
      availableStock: result.product.stock,
    };
    closeCreate();
    return;
  }
  productForm.value = { ...productForm.value, ...result.product };
  scanError.value = result.found
    ? "已从公共条码库带出基础资料，请核对价格和库存"
    : "未匹配到商品资料，请补全后保存";
}
async function startScan() {
  scanError.value = "";
  const Detector = (window as any).BarcodeDetector;
  if (!Detector) {
    scanError.value = "当前浏览器不支持摄像头条码识别，请手工输入条码";
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
    });
    scanning.value = true;
    await new Promise(requestAnimationFrame);
    if (video.value) {
      video.value.srcObject = cameraStream;
      await video.value.play();
    }
    const detector = new Detector({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"],
    });
    const detect = async () => {
      if (!scanning.value || !video.value) return;
      const codes = await detector.detect(video.value);
      if (codes[0]?.rawValue) {
        productForm.value.barcode = codes[0].rawValue;
        stopScan();
        await lookup();
        return;
      }
      requestAnimationFrame(detect);
    };
    requestAnimationFrame(detect);
  } catch {
    scanError.value = "无法使用摄像头，请检查浏览器权限或手工输入";
    stopScan();
  }
}
function stopScan() {
  scanning.value = false;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
}
async function saveProduct() {
  if (!productForm.value.name.trim()) {
    scanError.value = "请填写商品名称";
    return;
  }
  await api.createProduct(productForm.value);
  message.value = "SKU 已录入，商品数据已同步";
  closeCreate();
  await load();
  setTimeout(() => (message.value = ""), 2200);
}
</script>
<template>
  <div class="workspace">
    <div class="page-head">
      <div>
        <p class="eyebrow">{{ config.eyebrow }}</p>
        <h1>{{ config.title }}</h1>
        <p>{{ config.desc }}</p>
      </div>
      <button
        class="btn primary"
        :disabled="section !== 'products'"
        @click="openCreate"
      >
        ＋ 新建记录
      </button>
    </div>
    <div class="toolbar">
      <div class="filter-search">
        <span></span
        ><input
          v-model.trim="keyword"
          aria-label="搜索数据"
          placeholder="搜索当前列表..."
        />
      </div>
      <select v-model="statusFilter" class="filter-btn" aria-label="状态筛选">
        <option value="all">全部状态</option>
        <option value="on-sale">销售中</option>
        <option value="pending">待处理</option>
        <option value="completed">已完成</option>
        <option value="true">在线</option>
        <option value="false">离线</option>
      </select>
      <div class="toolbar-spacer"></div>
      <button class="btn ghost" @click="exportData">导出数据</button>
    </div>
    <div class="data-panel">
      <div class="data-summary">
        <div>
          <strong>{{ filtered.length }}</strong
          ><span> 条记录</span>
        </div>
        <p><span class="live-dot"></span> 数据已同步</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="col in config.columns" :key="col[0]">{{ col[1] }}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading" v-for="i in 6" :key="i">
              <td :colspan="config.columns.length + 1">
                <div class="row-skeleton"></div>
              </td>
            </tr>
            <tr v-for="row in paged" :key="row.id || row.orderNo">
              <td v-for="col in config.columns" :key="col[0]">
                <span
                  v-if="['status', 'statusText', 'online'].includes(col[0])"
                  class="status"
                  :class="{
                    success: String(display(row, col[0])).match(
                      /在线|完成|active|on-sale|confirmed|approved/,
                    ),
                    warning: String(display(row, col[0])).match(/待|pending/),
                  }"
                  >{{ display(row, col[0]) }}</span
                ><strong
                  v-else-if="['name', 'orderNo', 'staffName'].includes(col[0])"
                  >{{ display(row, col[0]) }}</strong
                ><span v-else>{{ display(row, col[0]) }}</span>
              </td>
              <td>
                <button
                  class="more"
                  aria-label="更多操作"
                  @click="selected = { ...row }"
                >
                  •••
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span
          >第 {{ page }} / {{ totalPages }} 页，共
          {{ filtered.length }} 条</span
        >
        <div>
          <button :disabled="page === 1" @click="page--">←</button
          ><button class="active">{{ page }}</button
          ><button :disabled="page === totalPages" @click="page++">→</button>
        </div>
      </div>
    </div>
    <div v-if="selected" class="drawer-mask" @click.self="selected = undefined">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">RECORD DETAIL</p>
            <h2>记录详情与操作</h2>
          </div>
          <button aria-label="关闭" @click="selected = undefined">×</button>
        </div>
        <div class="drawer-fields">
          <template v-if="section === 'products'"
            ><label
              >校园售价<input
                v-model.number="selected.price"
                type="number"
                min="0" /></label
            ><label
              >可售库存<input
                v-model.number="selected.availableStock"
                type="number"
                min="0" /></label
          ></template>
          <div v-for="col in config.columns" :key="col[0]">
            <span>{{ col[1] }}</span
            ><strong>{{ display(selected, col[0]) }}</strong>
          </div>
        </div>
        <div class="drawer-actions">
          <button
            v-if="section === 'products'"
            class="btn primary"
            @click="act('save')"
          >
            保存商品调整</button
          ><template v-else-if="section === 'orders'"
            ><button class="btn primary" @click="act('advance')">
              推进履约</button
            ><button class="btn danger-btn" @click="act('mark-exception')">
              标记异常
            </button></template
          ><template v-else-if="section === 'after-sales'"
            ><button class="btn primary" @click="act('approve')">
              审核通过</button
            ><button class="btn danger-btn" @click="act('reject')">
              驳回申请
            </button></template
          ><button v-else class="btn ghost" @click="selected = undefined">
            关闭详情
          </button>
        </div>
      </aside>
    </div>
    <div v-if="creating" class="drawer-mask" @click.self="closeCreate">
      <aside class="drawer product-create">
        <div class="drawer-head">
          <div>
            <p class="eyebrow">BARCODE ENTRY</p>
            <h2>扫码录入 SKU</h2>
          </div>
          <button aria-label="关闭" @click="closeCreate">×</button>
        </div>
        <div class="scan-panel">
          <video v-if="scanning" ref="video" playsinline muted></video>
          <div v-else class="scan-placeholder">
            <span class="scan-icon"></span><strong>扫描商品包装条形码</strong
            ><small>支持 EAN-13、EAN-8、UPC、Code 128</small>
          </div>
          <button v-if="!scanning" class="btn scan-btn" @click="startScan">
            打开摄像头扫码</button
          ><button v-else class="btn ghost" @click="stopScan">停止扫描</button>
        </div>
        <div class="barcode-row">
          <input
            v-model.trim="productForm.barcode"
            inputmode="numeric"
            maxlength="14"
            placeholder="也可以使用扫码枪或手工输入条码"
            @keyup.enter="lookup"
          /><button class="btn ghost" @click="lookup">查询</button>
        </div>
        <p v-if="scanError" class="form-hint">{{ scanError }}</p>
        <div class="product-form">
          <label class="wide"
            >商品名称<input
              v-model.trim="productForm.name"
              placeholder="例如：农夫山泉 550ml"
          /></label>
          <label class="wide"
            >商品卖点<input
              v-model.trim="productForm.subtitle"
              placeholder="一句话描述"
          /></label>
          <label
            >分类<select v-model="productForm.categoryId">
              <option value="snack">零食饮料</option>
              <option value="daily">日用品</option>
              <option value="instant">方便速食</option>
              <option value="fruit">水果</option>
            </select></label
          >
          <label>标签<input v-model.trim="productForm.tag" /></label>
          <label
            >校园售价<input
              v-model.number="productForm.price"
              type="number"
              min="0"
              step="0.01"
          /></label>
          <label
            >建议零售价<input
              v-model.number="productForm.originalPrice"
              type="number"
              min="0"
              step="0.01"
          /></label>
          <label
            >初始库存<input
              v-model.number="productForm.stock"
              type="number"
              min="0"
          /></label>
          <label
            >重量（kg）<input
              v-model.number="productForm.weight"
              type="number"
              min="0"
              step="0.001"
          /></label>
          <label class="wide"
            >商品图片 URL<input
              v-model.trim="productForm.image"
              placeholder="后续可替换为对象存储上传"
          /></label>
        </div>
        <div class="drawer-actions">
          <button class="btn ghost" @click="closeCreate">取消</button
          ><button class="btn primary" @click="saveProduct">保存并上架</button>
        </div>
      </aside>
    </div>
    <div v-if="message" class="toast" role="status">{{ message }}</div>
  </div>
</template>

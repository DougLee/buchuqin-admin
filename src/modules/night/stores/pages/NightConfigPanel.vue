<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api } from "../../../../api";
import { effectiveCampusId, hasPerm } from "../../../../session";
import { NIGHT_TIME_OPTIONS } from "../../night-shared";
import { fenToYuan, yuanToFen } from "../../../../utils/money";

/**
 * 校区夜宵配置面板（IKSW1F，道哥 2026-11-05：独立 Tab 内嵌形态）：
 * 夜宵开关 + 场次时间 + 待支付/接单超时 + 夜间配送费。
 * 互斥缓冲：夜宵开始早于校区闭店开始 → 后端 400 提示 confirm=true 强警告，
 * 前端识别后弹二次确认再带 confirm 重试。
 * Tab 激活即挂载本组件 → onMounted 自动加载当前校区配置。
 */
const loading = ref(false);
const saving = ref(false);
const loaded = ref(false);
const form = reactive({
  nightEnabled: false,
  start: "22:00",
  end: "02:00",
  payTimeout: 15,
  acceptTimeout: 60,
  /** 元；null = 回落白天口径 */
  deliveryFeeMode: "custom" as "custom" | "default" | "free",
  deliveryFee: 2,
});

function notify(message: string, type: "success" | "error" = "success") {
  ElMessage({ message, type, showClose: true });
}

async function load() {
  if (!effectiveCampusId.value || !hasPerm("GET /admin/night/config")) return;
  loading.value = true;
  try {
    const cfg = await api.nightConfig();
    form.nightEnabled = cfg.nightEnabled;
    form.start = cfg.nightStartAt ?? "22:00";
    form.end = cfg.nightEndAt ?? "02:00";
    form.payTimeout = cfg.nightPayTimeout ?? 15;
    form.acceptTimeout = cfg.nightAcceptTimeout ?? 60;
    if (cfg.nightDeliveryFee === null || cfg.nightDeliveryFee === undefined) {
      form.deliveryFeeMode = "default";
    } else if (cfg.nightDeliveryFee === 0) {
      form.deliveryFeeMode = "free";
    } else {
      form.deliveryFeeMode = "custom";
      form.deliveryFee = Number(fenToYuan(cfg.nightDeliveryFee));
    }
    loaded.value = true;
  } catch (e) {
    notify(e instanceof Error ? e.message : "配置加载失败", "error");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function save(confirm = false) {
  if (!effectiveCampusId.value) return;
  if (form.nightEnabled && form.start === form.end) {
    notify("夜宵开始与结束时刻不能相同", "error");
    return;
  }
  saving.value = true;
  try {
    await api.saveNightConfig({
      nightEnabled: form.nightEnabled,
      nightStartAt: form.start,
      nightEndAt: form.end,
      nightPayTimeout: form.payTimeout,
      nightAcceptTimeout: form.acceptTimeout,
      nightDeliveryFee:
        form.deliveryFeeMode === "custom"
          ? yuanToFen(form.deliveryFee)
          : form.deliveryFeeMode === "free"
            ? 0
            : null,
      ...(confirm ? { confirm: true } : {}),
    });
    notify("夜宵店设置已保存");
  } catch (e) {
    const message = e instanceof Error ? e.message : "保存失败";
    if (!confirm && message.includes("confirm=true")) {
      // 互斥缓冲强警告（PRD V1.5 A02）：夜宵开始早于校区闭店时刻 → 二次确认
      try {
        await ElMessageBox.confirm(
          message.replace("，请先确认打烊安排或传 confirm=true 强制保存", ""),
          "与校区闭店时间冲突",
          {
            type: "warning",
            confirmButtonText: "仍要保存（留痕）",
            cancelButtonText: "回去检查",
          },
        );
        await save(true);
      } catch {
        /* 用户取消，停留面板 */
      }
    } else {
      notify(message, "error");
    }
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <div class="night-config-panel">
    <p v-if="!effectiveCampusId" class="config-hint">请先在顶部选择校区。</p>
    <p
      v-else-if="!hasPerm('GET /admin/night/config')"
      class="config-hint"
    >
      当前账号无夜宵配置权限（需授权「夜宵经营」相关节点）。
    </p>
    <ElForm v-else label-position="top">
      <ElFormItem label="夜宵经营开关（关=全校区夜宵入口与下单停用）">
        <ElSwitch
          v-model="form.nightEnabled"
          active-text="开启"
          inactive-text="关闭"
        />
      </ElFormItem>
      <template v-if="form.nightEnabled">
        <ElRow :gutter="16">
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="场次开始（HH:mm）">
              <ElSelect v-model="form.start" filterable>
                <ElOption v-for="t in NIGHT_TIME_OPTIONS" :key="t" :label="t" :value="t" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="场次结束（HH:mm，跨零点属前一营业日）">
              <ElSelect v-model="form.end" filterable>
                <ElOption v-for="t in NIGHT_TIME_OPTIONS" :key="t" :label="t" :value="t" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="待支付超时（分钟，超时自动关单）">
              <ElInputNumber v-model="form.payTimeout" :min="1" :max="120" :precision="0" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="接单超时（分钟，一期仅记录不自动关单）">
              <ElInputNumber v-model="form.acceptTimeout" :min="1" :max="240" :precision="0" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :sm="12">
            <ElFormItem label="夜间配送费">
              <ElSelect v-model="form.deliveryFeeMode">
                <ElOption label="自定义金额" value="custom" />
                <ElOption label="回落白天即时送口径" value="default" />
                <ElOption label="免费（0 元）" value="free" />
              </ElSelect>
            </ElFormItem>
          </ElCol>
          <ElCol v-if="form.deliveryFeeMode === 'custom'" :xs="24" :sm="12">
            <ElFormItem label="夜间配送费（元）">
              <ElInputNumber v-model="form.deliveryFee" :min="0.01" :max="50" :precision="2" />
            </ElFormItem>
          </ElCol>
        </ElRow>
        <p class="config-hint">
          若夜宵开始时刻早于校区闭店开始时刻，保存时会出现强警告——确认后放行并留审计痕。
        </p>
        <ElButton
          v-if="hasPerm('PUT /admin/night/config')"
          type="primary"
          :loading="saving"
          @click="save(false)"
          >保存夜宵店设置</ElButton
        >
      </template>
    </ElForm>
  </div>
</template>
<style scoped>
.night-config-panel {
  max-width: 720px;
}
.config-hint {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.el-select,
.el-input-number {
  width: 100%;
}
</style>

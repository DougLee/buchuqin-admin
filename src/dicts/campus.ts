/**
 * 校区下拉统一字典（IKJCJF 追加）：全后台校区下拉唯一数据源。
 * - fetchOrgCampuses：全部组织校区（active，含总部仓）——账号授权/校区配置场景
 * - fetchOperationalCampuses：运营校区（排除总部仓）——数据筛选/地图/日报场景
 *   （C 端不出总部仓订单、总部仓无楼栋寝室，选了必空）
 * 模块级缓存：一次拉取全局共享，切账号后由 applySession 清空。
 */
import { ref } from "vue";
import { api } from "../api";

export interface CampusOption {
  id: string;
  name: string;
  shortName: string;
  type?: string;
  current?: boolean;
}

const cache = ref<CampusOption[] | null>(null);

/** 全量组织校区（active 含总部仓）。force=true 强制刷新。 */
export async function fetchOrgCampuses(force = false): Promise<CampusOption[]> {
  if (cache.value && !force) return cache.value;
  cache.value = await api.adminCampuses("filter");
  return cache.value!;
}

/** 运营校区（排除总部仓）。 */
export async function fetchOperationalCampuses(
  force = false,
): Promise<CampusOption[]> {
  return (await fetchOrgCampuses(force)).filter((c) => c.type !== "hq");
}

/** 账号切换/登出清缓存（session 调用）。 */
export function clearCampusCache() {
  cache.value = null;
}

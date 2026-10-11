/**
 * section 配套映射（IKIYMM 字典集中化）：纯搬移，键值与原定义逐字一致。
 * 后台板块名称、写权限与路由配置的集中字典。
 */

/** 新建按钮文案（section → 按钮文字） */
export const createLabels: Record<string, string> = {
  products: "＋ 新建记录",
  categories: "＋ 新建类别",
  marketing: "＋ 新建优惠券",
  // IKB5PB：营销拆分独立菜单（券/秒杀/支付广告位）
  coupons: "＋ 新建优惠券",
  banners: "＋ 新建 Banner",
  promotions: "＋ 新建促销",
  "pay-ads": "＋ 新建广告",
  campuses: "＋ 新建校区",
  buildings: "＋ 新建楼栋",
  staff: "＋ 新建员工账号",
  dispatch: "＋ 邀请调配",
  rules: "＋ 新建提成规则",
  // RBAC V1：accounts 板块移交独立页 /accounts
  // IKAJSY：群码上传（users 为只读板块，无新建入口）
  "wechat-groups": "＋ 上传群码",
};

/** 新建权限（section → POST URL，与 api RBAC registry 手工对齐） */
export const createPermissions: Record<string, string> = {"categories": "POST /admin/categories", "coupons": "POST /admin/coupons", "banners": "POST /admin/banners", "promotions": "POST /admin/promotions", "pay-ads": "POST /admin/banners", "campuses": "POST /admin/campuses", "buildings": "POST /admin/buildings", "staff": "POST /admin/staff", "dispatch": "POST /admin/dispatch-invitations", "rules": "POST /admin/commission-rules", "wechat-groups": "POST /admin/wechat-groups"};

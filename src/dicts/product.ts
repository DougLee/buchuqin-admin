/**
 * 商品/营销域字典（IKIYMM 字典集中化）：纯搬移，文案与原定义逐字一致。
 * 匿名内联 map 落地为具名字典（值不变）。
 */

/** 商品状态（原 DataPage display() 内联 map） */
export const PRODUCT_STATUS_TEXT: Record<string, string> = {
  "on-sale": "在售",
  "off-sale": "已下架",
  "sold-out": "售罄",
};

/** 促销类型 */
export const PROMO_TYPE_TEXT: Record<string, string> = {
  seckill: "秒杀",
  clearance: "临期特惠",
};

/** 转盘奖品类型 */
export const WHEEL_TYPE_LABEL: Record<string, string> = {
  coupon: "平台券",
  partner: "异业券",
  none: "谢谢参与",
};

/** 券品种（原 display() 内联 map；异业券不参与下单） */
export const COUPON_KIND_TEXT: Record<string, string> = {
  platform: "金额券",
  partner: "异业券",
};

/** 券领取方式（原 display() 内联 map） */
export const COUPON_TRIGGER_TEXT: Record<string, string> = {
  manual: "手动领取",
  lottery: "转盘",
  signup: "注册发",
};

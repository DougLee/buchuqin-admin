/**
 * 系统更新日志（道哥 2026-09-22 二轮定稿）：内容随代码内置、后台只读，
 * 每次发版由开发顺带补一笔；条目按端拆分（管理后台/用户小程序/楼长小程序），
 * 某端无改动则该段不显示。渲染端按 date 倒序；「有新更新」红点比对已读标记。
 */
export interface ChangelogEntry {
  /** 发版日期 YYYY-MM-DD（倒序依据） */
  date: string;
  /** 主题（一句话概括本次发版） */
  title: string;
  /** 管理后台的改动（运营视角白话；无则不显示该段） */
  admin?: string[];
  /** 用户小程序的改动（C 端用户视角） */
  user?: string[];
  /** 楼长小程序的改动（楼长/骑手视角） */
  manager?: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-22",
    title: "校区配置中心 + 公告 + 更多自定义",
    admin: [
      "新增「校区配置」菜单：配送费、打烊时间、底薪、送达时段、公告、群码、打印机、Banner、抽奖，一个校区的配置全在一页",
      "限时秒杀页新增按商品类别筛选",
      "秒杀规则调整：秒杀价与限购只在秒杀专区生效，正常目录按原价自由购买",
      "新增帮助中心与更新日志",
    ],
    user: [
      "首页新增公告栏（📢 跑马灯），支持校区自定义多条公告和生效时间",
      "秒杀商品在正常分类目录恢复原价购买，不再限购",
      "下单时「无楼长」提示改为校区自定义文案",
    ],
  },
  {
    date: "2026-09-21",
    title: "订单异常处理闭环",
    admin: [
      "工作台「待处理异常」点击直达异常订单列表，不再翻页找单",
      "订单新增「解除异常」操作，误标异常可恢复",
      "标记异常需填写原因并确认，处理留痕可追溯",
      "客服电话支持各校区自定义（校区配置 → 基础档案）",
    ],
    user: [
      "「我的」页、商品详情、订单详情的客服电话跟随校区配置",
      "下单时「无楼长」提示改为校区自定义文案",
    ],
  },
  {
    date: "2026-09-19",
    title: "推荐位管理",
    admin: ["营销活动新增「推荐位管理」：手动置顶商品 + 销量自动补齐"],
    user: ["首页推荐位商品由运营精选，更好逛"],
  },
  {
    date: "2026-09-17",
    title: "打烊停单与体验优化",
    admin: [
      "打烊停单：手动闭店 + 每日打烊时间窗，C 端下单同步拦截",
      "订单列表/详情美化：订单号截断悬停、商品摘要、收货人明文",
      "新订单提醒：右下角浮窗 + 提示音 + 语音播报",
    ],
    user: ["打烊期间下单入口明确提示恢复时间"],
  },
];

/* ---------- 「有新更新」已读标记（道哥定稿 A：小红点比对最新条目日期） ---------- */
const READ_KEY = "changelogReadDate";

/** 倒序后的全部条目（渲染与判定共用） */
export function sortedEntries(): ChangelogEntry[] {
  return [...CHANGELOG].sort((a, b) => (a.date < b.date ? 1 : -1));
}
/** 最新条目是否晚于已读标记（App.vue 菜单红点用；进入日志页调 markRead 消点） */
export function isUnread(): boolean {
  const latest = sortedEntries()[0];
  return !!latest && latest.date > (localStorage.getItem(READ_KEY) ?? "");
}
/** 标记已读（当前最新日期） */
export function markRead() {
  const latest = sortedEntries()[0];
  if (latest) localStorage.setItem(READ_KEY, latest.date);
}

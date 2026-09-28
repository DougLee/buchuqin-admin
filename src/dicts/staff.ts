/**
 * 人员/组织域字典（IKIYMM 字典集中化）：纯搬移，文案与原定义逐字一致。
 * 分叉提示：员工状态在 delivery-weapp 与此处文案不同（纯重构不统一）。
 */

/** 员工角色下拉（ Staff.role 四值；与 api dto STAFF_ROLES 同域三处声明之一） */
export const ROLE_OPTIONS = [
  { value: "building-manager", label: "楼长" },
  { value: "intern-building-manager", label: "实习楼长" },
  { value: "fulltime-rider", label: "全职配送员" },
  { value: "parttime-rider", label: "兼职配送员" },
];

/** 员工状态（Staff.status） */
export const STAFF_STATUS_LABEL: Record<string, string> = {
  online: "在线",
  paused: "暂停接单",
  offline: "离线",
};

/** 楼长招募报名状态 */
export const RECRUIT_STATUS_LABEL: Record<string, string> = {
  pending: "待联系",
  interviewing: "面试中",
  approved: "已通过",
  rejected: "已拒绝",
};

/** 徽章配色：待联系橙 / 面试中蓝 / 已通过绿 / 已拒绝红（.status.info/.danger 新增于 style.css） */
export const RECRUIT_STATUS_CLASS: Record<string, string> = {
  pending: "warning",
  interviewing: "info",
  approved: "success",
  rejected: "danger",
};

/** 旧后台角色标签（session.ts 账号列表/审计展示兜底，原 ROLE_LABELS 搬入） */
export const ROLE_LABELS: Record<string, string> = {
  hq: "总部长",
  admin: "管理员",
  operations: "运营",
  warehouse: "仓储",
  finance: "财务",
  rbac: "后台账号",
};

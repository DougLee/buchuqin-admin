-- ============================================================
-- 夜宵经营（IKSW1F）AdminMenu 建行 SQL（存量环境手工灌入）
-- ============================================================
-- 背景：api 端 registry.ts 已登记 g.night 组 8 个节点（MENU_NODES），
-- 但菜单树仅在新库首灌一次（rbacState.menusSeeded=true 后 DB 为唯一真源，
-- registry 新节点不会随发版自动落库）。存量正式/测试环境需执行本脚本建行，
-- 或经「系统 → 菜单管理」界面按相同 perms 手工录入。
--
-- 节点定义与 api/src/admin/rbac/registry.ts g.night 组逐字对齐（2026-11-04 道哥定稿）：
--   1 目录 g.night（夜宵经营，order 8）
--   2 菜单 night-stores（夜宵店铺，viewPath=night-stores，前端页面已注册）
--   3 按钮 night-stores.write（夜宵店铺管理）
--   4 按钮 night-deposit（押金账务）
--   5 菜单 night-orders（夜宵订单，viewPath=night-orders）
--   6 按钮 night-orders.refund（夜宵退款）
--   7 菜单 night-settlements（夜宵结算，viewPath=night-settlements）
--   8 按钮 night-settlements.write（夜宵结算操作）
--
-- 说明：
-- - id 用手工稳定值（cuid 非强制，主键唯一即可）；code 唯一冲突即跳过（幂等可重跑）。
-- - viewPath=code（type=1 菜单行规则，rbac.service.syncRegistry 同口径），
--   前端 view-catalog.ts 已注册 night-stores / night-orders / night-settlements
--   三个视图；店铺详情 /night-stores/:id 由前端 router 在 night-stores 菜单
--   存在时自动挂载，无需单独菜单行。
-- - 超管（super-admin）通配，无需 role_menu；其他角色授权走
--   「系统 → 角色管理」勾选 g.night 组对应节点（本脚本不写 role_menu，
--   避免把夜宵权限静默授予存量角色）。
-- - perms 逗号串规则：「METHOD 路径模式」，:seg 通配单段——与鉴权守卫匹配语义一致。

-- ---------- 1. 目录：夜宵经营 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES ('cm-night-dir','g.night',NULL,'夜宵经营',0,'','','',false,'',7,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ---------- 2. 菜单：夜宵店铺 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES (
  'cm-night-stores','night-stores',
  (SELECT "id" FROM "AdminMenu" WHERE "code"='g.night'),
  '夜宵店铺',1,
  'GET /admin/night/stores,GET /admin/night/stores/:id,GET /admin/night/stores/:id/stock-txns,GET /admin/night/stores/:id/liquidation,GET /admin/night/catalog,GET /admin/night/config,GET /admin/night/coupons',
  '/night-stores','night-stores',false,'campus',1,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ---------- 3. 按钮：夜宵店铺管理 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES (
  'cm-night-stores-w','night-stores.write',
  (SELECT "id" FROM "AdminMenu" WHERE "code"='night-stores'),
  '夜宵店铺管理',2,
  'POST /admin/night/stores,PATCH /admin/night/stores/:id,POST /admin/night/catalog,PATCH /admin/night/catalog/:id,POST /admin/night/stores/:id/products,PATCH /admin/night/stores/:id/products/:productId,POST /admin/night/stores/:id/products/:productId/stock,PUT /admin/night/config',
  '','',false,'',1,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ---------- 4. 按钮：押金账务 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES (
  'cm-night-deposit','night-deposit',
  (SELECT "id" FROM "AdminMenu" WHERE "code"='night-stores'),
  '押金账务',2,
  'POST /admin/night/stores/:id/deposit/deduct,POST /admin/night/stores/:id/deposit/refund',
  '','',false,'',2,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ---------- 5. 菜单：夜宵订单 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES (
  'cm-night-orders','night-orders',
  (SELECT "id" FROM "AdminMenu" WHERE "code"='g.night'),
  '夜宵订单',1,
  'GET /admin/night/orders,GET /admin/night/orders/:id',
  '/night-orders','night-orders',false,'orders',2,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ---------- 6. 按钮：夜宵退款 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES (
  'cm-night-orders-r','night-orders.refund',
  (SELECT "id" FROM "AdminMenu" WHERE "code"='night-orders'),
  '夜宵退款',2,
  'POST /admin/night/orders/:id/refund',
  '','',false,'',1,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ---------- 7. 菜单：夜宵结算 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES (
  'cm-night-settle','night-settlements',
  (SELECT "id" FROM "AdminMenu" WHERE "code"='g.night'),
  '夜宵结算',1,
  'GET /admin/night/settlements',
  '/night-settlements','night-settlements',false,'finance',3,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- ---------- 8. 按钮：夜宵结算操作 ----------
INSERT INTO "AdminMenu" ("id","code","parentId","name","type","perms","path","viewPath","keepAlive","icon","orderNum","isShow","status","createdAt","updatedAt")
VALUES (
  'cm-night-settle-w','night-settlements.write',
  (SELECT "id" FROM "AdminMenu" WHERE "code"='night-settlements'),
  '夜宵结算操作',2,
  'POST /admin/night/settlements/settle,POST /admin/night/settlements/:batch/pay',
  '','',false,'',1,true,'active', now(), now())
ON CONFLICT ("code") DO NOTHING;

-- 夜宵经营插位后：系统组排序顺延 7→8（道哥 2026-11-05：夜宵经营置于财务系统与系统之间）
UPDATE "AdminMenu" SET "orderNum" = 8 WHERE code = 'g.sys';

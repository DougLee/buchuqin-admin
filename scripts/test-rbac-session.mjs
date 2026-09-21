// Bundle actual browser modules; deferred fetches reproduce response ordering without a server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { File } from 'node:buffer';
const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('vite'))] }));
const result = await build({
  stdin: { contents: 'export * from "./src/api.ts"; export * from "./src/session.ts";', resolveDir: resolve('.') },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
globalThis.window = { location: { hash: '#/products' } };
const pending = [];
globalThis.fetch = (url, options) => new Promise(resolve => pending.push({ url, options, resolve }));
const m = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const response = (data, status = 200) => new Response(JSON.stringify({ data, message: 'rejected' }), { status });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function next() { await tick(); assert.ok(pending.length, 'expected a pending fetch'); return pending.shift(); }
async function login(id = 'A', token = `token-${id}`, campusId = 'campus-A') {
  const promise = m.login(id, 'fake');
  (await next()).resolve(response({ token, user: { id, campusId, role: 'rbac' } }));
  const value = await promise;
  m.applySession(value.user);
}
function reset() { assert.equal(pending.length, 0); m.clearSession(); m.clearToken(); window.location.hash = '#/products'; }
function me(perms = []) { return { account: { id: 'A' }, contextCampusId: 'campus-A', perms, menus: [], super: false, platform: false, roles: [], switchableCampuses: [], rbacVersion: 1 }; }

test('session response ordering', async t => {
  for (const [name, request] of [
    ['JSON', () => m.api.adminCampuses()],
    ['upload', () => m.uploadImage(new File(['fake'], 'test.webp', { type: 'image/webp' }))],
    ['import', () => m.api.importRooms('building-A', new File(['fake'], 'rooms.xlsx'))],
    ['download', () => m.downloadRoomTemplate('building-A')],
  ]) {
    await t.test(`${name}: old 401 cannot log out new account`, async () => {
      reset(); await login();
      const old = request(); const rejected = assert.rejects(old, /会话已切换/);
      const stale = await next();
      await login('B'); stale.resolve(response(null, 401)); await rejected;
      assert.equal(m.sessionUser.value.id, 'B'); assert.equal(storage.get('adminToken'), 'token-B');
      assert.equal(window.location.hash, '#/products');
    });
  }
  await t.test('old successful data cannot enter new campus even with identical token', async () => {
    reset(); await login();
    const old = m.api.adminCampuses(); const rejected = assert.rejects(old, /会话已切换/);
    const stale = await next(); m.applySession({ ...m.sessionUser.value, campusId: 'campus-B' });
    stale.resolve(response(['campus-A'])); await rejected;
  });
  await t.test('body decoding also checks session after await', async () => {
    reset(); await login();
    const old = m.api.adminCampuses(); const rejected = assert.rejects(old, /会话已切换/);
    let finishBody;
    (await next()).resolve({ status: 200, ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) });
    await tick(); await login('B'); finishBody({ data: ['campus-A'] }); await rejected;
  });
  await t.test('current 401 clears the session', async () => {
    reset(); await login();
    const current = m.api.adminCampuses(); const rejected = assert.rejects(current, /登录已失效/);
    (await next()).resolve(response(null, 401)); await rejected;
    assert.equal(m.sessionUser.value, null); assert.equal(storage.has('adminToken'), false);
    assert.equal(window.location.hash, '#/login');
  });
  await t.test('logout invalidates pending login', async () => {
    reset(); const old = m.login('A', 'fake'); const rejected = assert.rejects(old, /会话已切换/);
    const stale = await next(); m.clearSession(); m.clearToken();
    stale.resolve(response({ token: 'late', user: { id: 'A' } })); await rejected;
    assert.equal(storage.has('adminToken'), false);
  });
  await t.test('latest login attempt wins even if earlier response arrives first', async () => {
    reset(); const first = m.login('A', 'fake'); const rejected = assert.rejects(first, /请求已更新/);
    const earlier = await next(); const second = m.login('B', 'fake'); const latest = await next();
    earlier.resolve(response({ token: 'A', user: { id: 'A' } })); await rejected;
    latest.resolve(response({ token: 'B', user: { id: 'B' } })); await second;
    assert.equal(storage.get('adminToken'), 'B');
  });
  await t.test('late campus switch cannot overwrite newly logged-in account', async () => {
    reset(); await login(); const old = m.api.switchAdminCampus('campus-B'); const rejected = assert.rejects(old, /会话已切换/);
    const stale = await next(); await login('B');
    stale.resolve(response({ token: 'old-campus-B', user: { id: 'A' } })); await rejected;
    assert.equal(storage.get('adminToken'), 'token-B');
  });
  await t.test('older permission refresh cannot restore permissions after newer revoke', async () => {
    reset(); await login(); const old = m.loadRbac(); const stale = await next();
    const fresh = m.loadRbac(); (await next()).resolve(response(me([]))); await fresh;
    stale.resolve(response(me(['PATCH /admin/products/:id']))); await old;
    assert.equal(m.hasPerm('PATCH /admin/products/123'), false);
  });
  await t.test('permission refresh cannot restore authorization after logout', async () => {
    reset(); await login(); const old = m.loadRbac(); const stale = await next();
    m.clearSession(); m.clearToken(); stale.resolve(response(me(['PATCH /admin/products/:id'])));
    assert.equal(await old, false); assert.equal(m.rbacLoaded.value, false); assert.equal(m.patterns.value.size, 0);
  });
  await t.test('internal links follow moved authorized menus and ignore display-only ancestors', () => {
    reset();
    m.applyRbac({ ...me(), menus: [
      { id: 'parent', code: 'orders', viewPath: 'orders', path: '/old-orders', type: 1, authorized: false },
      { id: 'new', code: 'custom-orders', viewPath: 'orders', path: '/operations/orders', type: 1, authorized: true, isShow: false },
    ] });
    assert.equal(m.menuPath('orders'), '/operations/orders');
    assert.equal(m.menuPath('purchase'), undefined);
    m.clearSession(); assert.equal(m.menuPath('orders'), undefined);
  });
  await t.test('permission method and segment matching stays narrow', () => {
    reset(); m.applyRbac(me(['PATCH /admin/products/:id']));
    assert.equal(m.hasPerm('PATCH /admin/products/123/'), true);
    assert.equal(m.hasPerm('GET /admin/products/123'), false);
    assert.equal(m.hasPerm('PATCH /admin/products/123/status'), false);
  });
});

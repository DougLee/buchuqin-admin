import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [dirname(require.resolve('vite'))] }));
const result = await build({ stdin: { contents: 'export * from "./src/utils/printNightStock.ts";', resolveDir: resolve('.') }, bundle: true, platform: 'node', format: 'esm', write: false });
const { nightStockPrintHtml } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const order = { id: 'stock-1', status: 'approved', buildingName: '9栋', managerName: '测试楼长', createdAt: '2026-11-17', totalValue: 1200, items: [{ name: '<img src=x onerror=alert(1)>', quantity: 2, price: 600 }] };
test('审核后拣货单完整且转义商品/人员字段，不修改原单据', () => {
  const before = JSON.stringify(order), html = nightStockPrintHtml(order);
  assert.ok(html.includes('stock-1') && html.includes('9栋') && html.includes('应发数量') && html.includes('系统收货'));
  assert.ok(html.includes('&lt;img') && !html.includes('<img src=x'));
  assert.equal(JSON.stringify(order), before);
});
test('未审核及撤销单据不能打印成出库交接凭证', () => {
  for (const status of ['requested', 'rejected', 'cancelled']) assert.throws(() => nightStockPrintHtml({ ...order, status }), /审核通过/);
});

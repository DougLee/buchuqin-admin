import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { build } = require(
  require.resolve("esbuild", { paths: [dirname(require.resolve("vite"))] }),
);
const result = await build({
  stdin: {
    contents: `export * from "./src/shared/data/pagination.ts"; export * from "./src/shared/data/useAsyncCollection.ts"; export * from "./src/modules/fulfillment/picking/model.ts";`,
    resolveDir: resolve("."),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const pagination = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("pageWindow keeps short pagination complete", () => {
  assert.deepEqual(pagination.pageWindow(4, 2), [1, 2, 3, 4]);
});

test("pageWindow keeps current page visible in a long sequence", () => {
  assert.deepEqual(pagination.pageWindow(12, 6), [1, "…", 5, 6, 7, "…", 12]);
  assert.deepEqual(pagination.pageWindow(12, 1), [1, 2, 3, 4, 5, "…", 12]);
  assert.deepEqual(pagination.pageWindow(12, 12), [1, "…", 8, 9, 10, 11, 12]);
});

test("clampPage rejects invalid input and constrains valid pages", () => {
  assert.equal(pagination.clampPage("oops", 8), null);
  assert.equal(pagination.clampPage(0, 8), null);
  assert.equal(pagination.clampPage(20, 8), 8);
  assert.equal(pagination.clampPage(3.8, 8), 3);
});

test("buildPickingLines sorts located products naturally and keeps source identity", () => {
  const lines = pagination.buildPickingLines([
    { quantity: 1, product: { name: "无库位", location: "" } },
    { quantity: 2, product: { name: "牛奶", location: "A", locationCode: "10" } },
    { quantity: 3, product: { name: "面包", location: "A", locationCode: "2" } },
  ]);
  assert.deepEqual(lines.map(line => [line.sourceIndex, line.name, line.location]), [
    [2, "面包", "A-2"], [1, "牛奶", "A-10"], [0, "无库位", ""],
  ]);
});

test("useAsyncCollection ignores an older response after scope changes", async () => {
  const pending = [];
  const state = pagination.useAsyncCollection(() => new Promise(resolve => pending.push(resolve)));
  const older = state.load();
  const newer = state.load();
  pending[1](["campus-B"]);
  await newer;
  pending[0](["campus-A"]);
  await older;
  assert.deepEqual(state.rows.value, ["campus-B"]);
  assert.equal(state.loading.value, false);
});

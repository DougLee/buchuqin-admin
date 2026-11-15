import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/modules/night/stores/pages/NightCatalogPanel.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
function setup() {
  const exports = {}, pending = [], notices = [], campus = { value: 'c' };
  const code = ts.transpileModule(source + '\nexport { startImport, onCandidateFilter, onCandidateLoadMore, candidates, candidatePage, candidateTotal, candidateCategories };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, defineExpose() {}, require(name) {
    if (name === 'vue') return { ref: value => ({ value }), reactive: x => x, computed: fn => ({ get value() { return fn(); } }), watch() {}, onMounted() {} };
    if (name.endsWith('/api')) return { api: { nightCatalogCandidates: (...args) => new Promise((resolve, reject) => pending.push({ args, resolve, reject })) } };
    if (name.endsWith('/session')) return { effectiveCampusId: campus, hasPerm: () => true };
    if (name === 'element-plus') return { ElMessage: value => notices.push(value), ElMessageBox: {} };
    return {};
  } });
  return { ...exports, pending, campus, notices };
}
const result = (id, total = 3) => ({ items: [{ id, name: id, price: 100 }], total, categories: [{ id: 'official-cat', name: '官方类别' }] });
test('筛选旧响应不能覆盖新结果，跨校区响应不落位', async () => {
  const s = setup(); const old = s.startImport();
  s.onCandidateFilter({ categoryId: 'official-cat', keyword: 'new' });
  s.pending[1].resolve(result('new')); await new Promise(r => setImmediate(r));
  s.pending[0].resolve(result('old')); await old;
  assert.equal(s.candidates.value[0].id, 'new'); assert.equal(s.candidateCategories.value[0].id, 'official-cat');
  s.onCandidateFilter({ categoryId: 'all', keyword: 'other' }); s.campus.value = 'different';
  s.pending[2].resolve(result('other')); await new Promise(r => setImmediate(r));
  assert.equal(s.candidates.value[0].id, 'new');
});
test('加载更多失败后重试同页，不跳页，成功后再推进页码', async () => {
  const s = setup(); const initial = s.startImport(); s.pending[0].resolve(result('one')); await initial;
  const failed = s.onCandidateLoadMore(); assert.equal(s.pending[1].args[1], 2);
  s.pending[1].reject(Error('offline')); await failed; assert.equal(s.candidatePage.value, 1);
  const retry = s.onCandidateLoadMore(); assert.equal(s.pending[2].args[1], 2);
  s.pending[2].resolve(result('two')); await retry;
  assert.equal(s.candidatePage.value, 2); assert.equal(s.candidates.value.map(p => p.id).join(','), 'one,two');
});

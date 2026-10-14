/**
 * 工具面回归测试 —— 保护「算出来了」和「模型看得到」之间那段线
 *
 * ## 为什么单独测这个（这次真踩了）
 *
 * 我给 `renderDeck()` 加了 `distinct`（唯一页数），也把它写进了
 * `output.schema`，`summarize()` 里也读了它 —— **但忘了在 `execute()` 的返回
 * 对象里带上**。于是：
 *
 *   · `renderDeck` 确实算出了 8
 *   · `summarize` 里 `typeof value.distinct === 'number'` 为假 → 静默省略
 *   · schema 里声明了 `distinct`，却永远拿不到值
 *
 * 结果是**加了一整轮测试、跑绿了的信号，在真实会话里根本没出现过**。
 * 单元测试全绿（它们测的是 lib），但模型看到的那行文本里没有它。
 *
 * 这类「字段算出来了但没接上」的 bug 有三个面，本测试三个都查：
 *   ① execute() 返回值里有这个键
 *   ② output.schema 声明了这个键（否则会被校验掉 / 与实现对不上）
 *   ③ 渲染成文本后，模型真能看到它
 *
 * 运行：
 *
 *   cd <本包> && node scripts/test-tool.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { apply } from '../index.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'deck-tool-test-'));
const fixture = path.join(root, 'deck.html');
writeFileSync(
  fixture,
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
     body{margin:0;font-family:Georgia,serif}
     .slide{width:1280px;height:720px;display:none;padding:80px;box-sizing:border-box}
     .slide.active{display:block}
   </style></head><body>
     ${[1, 2, 3].map((n) => `<section class="slide${n === 1 ? ' active' : ''}"><h1>第 ${n} 页</h1></section>`).join('')}
   </body></html>`,
);

let passed = 0;
let failed = 0;
const check = (ok, label, detail) => {
  if (ok) { passed += 1; console.log(`  ✅ ${label}`); }
  else { failed += 1; console.log(`  ❌ ${label}`); if (detail !== undefined) console.log(`     ${detail}`); }
};

/* ── 用 mock ctx 抓取注册的工具（真实插件路径，不是直接 import lib） ── */
let tool = null;
apply({
  effect: (fn) => { fn(); return () => {}; },
  tools: { register: (t) => { tool = t; return () => {}; } },
});

if (tool === null) {
  console.log('❌ apply() 没有注册任何工具');
  process.exit(1);
}

console.log('\n▶︎ 工具面（deck_render）');
check(tool.name === 'deck_render', '工具名 = deck_render', `实际 ${tool.name}`);

const out = await tool.execute({ path: fixture, out_dir: path.join(root, 'shot') }, {});
const text = tool.output.render({}, out).map((b) => b.text).join('\n');

/* ① execute 返回值 —— 这是本次真踩的那个坑 */
check(out.pages === 3, 'execute().pages = 3', `实际 ${out.pages}`);
check(
  typeof out.distinct === 'number',
  'execute() 带回了 distinct（← 漏过这个，信号就永远到不了模型）',
  `实际 ${JSON.stringify(out.distinct)}`,
);
check(out.distinct === 3, 'execute().distinct = 3', `实际 ${out.distinct}`);

/* ② schema 与实现对账：声明了却没赋值、或赋值了却没声明，都是 bug
 *
 * 注意：本用例固定渲 3 页，所以 `sheet`（拼图）必然存在 —— 它在实现里是
 * 条件字段（只有 >1 页才拼）。若将来改成本用例只渲 1 页，
 * 「execute() 填了 sheet」这条会假失败，需要把 sheet 划成可选。 */
const declared = new Set(Object.keys(tool.output.schema?.properties ?? {}));
const returned = new Set(Object.keys(out));
for (const k of returned) {
  check(declared.has(k), `schema 声明了 execute() 返回的 "${k}"`, '未声明 → 可能被输出校验丢弃');
}
for (const k of declared) {
  check(returned.has(k), `execute() 填了 schema 声明的 "${k}"`, '声明了但从不赋值 → 死字段');
}

/* ③ 模型真能看到 —— 最终验收口径 */
check(text.includes('3 distinct'), '模型看到的文本含 "3 distinct"', text.split('\n')[1]);
check(!text.includes('undefined'), '文本里没有 undefined 泄漏');

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}：${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

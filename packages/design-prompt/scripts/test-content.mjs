/**
 * dsh-design-prompt 回归测试
 *
 * 两件事：
 *   ① 宪章内容拼得完整（8 章、非空、总量有下限、关键章节在位）
 *   ② **它不再是个插件** —— 没有 apply()/inject，装错也伤不到人
 *
 * 第 ② 条是这份测试存在的主要原因。早期版本注册了一个 `complete: true` 的
 * section，装上就会挤掉所有其它 section（含工具指引），而防护手段只是文档里
 * 一句「别挂载」。删掉 apply() 之后，这条断言负责**不让它长回来**。
 *
 * 运行：cd <本包> && npm test
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');

const mod = await import(pathToFileURL(path.join(pkgRoot, 'index.js')).href);

let passed = 0;
let failed = 0;
const check = (ok, label, detail) => {
  if (ok) { passed += 1; console.log(`  ✅ ${label}`); }
  else { failed += 1; console.log(`  ❌ ${label}`); if (detail !== undefined) console.log(`     ${detail}`); }
};

/* ── ② 不是插件（最重要的一条） ───────────────────────────────── */
console.log('\n▶︎ 模块形态：必须是纯内容模块，不是插件');
check(mod.apply === undefined, '没有导出 apply()（旧的 complete:true 地雷已拆除）',
  `apply = ${typeof mod.apply}`);
check(mod.inject === undefined, '没有导出 inject（不参与插件依赖注入）',
  `inject = ${JSON.stringify(mod.inject)}`);
check(typeof mod.composed === 'string' && mod.composed.length > 0, '导出了 composed 字符串');

/* ── ① 内容完整性 ─────────────────────────────────────────────── */
console.log('\n▶︎ 宪章内容');
const { parts, totalBytes, separator } = mod.meta;
check(parts.length === 8, `章节数 = 8`, `实际 ${parts.length}`);
check(parts.every((p) => p.bytes > 0), '每一章都非空',
  JSON.stringify(parts.filter((p) => p.bytes === 0)));
check(totalBytes >= 74000, `总字节 ≥ 74000（宪章不能缩水）`, `实际 ${totalBytes}`);
check(mod.composed.length > 0 && separator === '\n\n---\n\n', '分隔符与 OD composer 一致');

// 关键章节在位 —— 改坏一处就会在这里响
const mustHave = [
  ['discovery 覆盖声明', 'override anything later'],
  ['两道门（门一 看图）', 'deck_render'],
  ['两道门（门二 规则）', 'deck_lint'],
  ['deck 框架是硬约束', 'non-negotiable'],
  ['反 AI-slop 规则', 'AI-slop'],
  ['排版工艺', 'letter-spacing'],
];
for (const [label, needle] of mustHave) {
  check(mod.composed.includes(needle), `含「${label}」（${needle}）`);
}

// content/ 目录里的文件与 ORDER 一致 —— 多一个没被拼进去 = 拼漏了
const onDisk = readFileSync(path.join(pkgRoot, 'index.js'), 'utf8')
  .match(/'(\d\d-[a-z-]+\.md)'/g)
  ?.map((s) => s.slice(1, -1)) ?? [];
check(onDisk.length === 8, 'index.js 的 ORDER 列出 8 个文件', `实际 ${onDisk.length}`);
check(
  onDisk.every((f) => parts.some((p) => p.file === f)),
  'ORDER 里每个文件都真的被读进来了',
  JSON.stringify(onDisk.filter((f) => !parts.some((p) => p.file === f))),
);

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}：${passed} passed, ${failed} failed`);
console.log(`宪章总量：${totalBytes} 字节 / ${parts.length} 章`);
process.exit(failed === 0 ? 0 : 1);

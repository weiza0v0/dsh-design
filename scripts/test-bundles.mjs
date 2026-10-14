/**
 * 仓库级契约检查 —— **每个插件包都必须能被 DSH 装得上**
 *
 * ## 为什么这条检查必须存在
 *
 * DSH 的 `plugin-manager` 只接受**声明了 bundle patch 的包**：
 * `installBundle` 会回 `not-a-bundle`，并把 `package.json` 与 `pnpm-lock.yaml`
 * **回滚**（见 `@deepseek-ai/dsh-plugin-manager` 的 README）。
 *
 * 这条要求不是「最好有」，是「没有就完全装不上」。而它**没有任何本地症状** ——
 * 手工往 profile 的 cordis.patch.yml 里写一行 insert，插件照样正常工作，
 * 只有陌生人用插件页/`dsh plugin add` 时才会发现装不了。
 *
 * 本仓库最初 5 个包里有 4 个踩了这个坑。所以这里把它变成一条测试：
 * **只要是插件（导出 apply），就必须声明 dsh.bundle.patch，且那个文件里
 * 必须有一行 insert 指向自己。**
 *
 * 顺带对账两处容易写歪的地方：
 *   · `cordis.patch.yml` 里 insert 的 `id` 在 profile 内唯一（跨包不重复）
 *   · 三处名字一致：npm 包名 == index.js 导出的 name == patch 里 insert 的 name
 *
 * 运行：cd <仓库根> && npm run test:bundles
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse as parseYaml } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const packagesDir = path.join(repoRoot, 'packages');

let passed = 0;
let failed = 0;
const check = (ok, label, detail) => {
  if (ok) { passed += 1; console.log(`  ✅ ${label}`); }
  else { failed += 1; console.log(`  ❌ ${label}`); if (detail !== undefined) console.log(`     ${detail}`); }
};

/**
 * 刻意**不是**插件的包：它们是被依赖的内容/工具模块，不该出现在
 * profile 的 bundles 列表里。声明在这里是为了让「没声明 bundle patch」
 * 这件事从「漏了」变成「有意为之」。
 */
const NOT_A_PLUGIN = new Set(['dsh-design-prompt']);

const dirs = readdirSync(packagesDir).filter((d) => existsSync(path.join(packagesDir, d, 'package.json')));
const seenInsertIds = new Map();   // id → 包名，用来查 profile 内 id 冲突

console.log(`仓库根：${repoRoot}\n发现 ${dirs.length} 个包\n`);

for (const dir of dirs) {
  const pkgDir = path.join(packagesDir, dir);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const mod = await import(pathToFileURL(path.join(pkgDir, 'index.js')).href);
  const isPlugin = typeof mod.apply === 'function';

  console.log(`▶︎ ${pkg.name}（${isPlugin ? '插件' : '非插件'}）`);

  check(mod.name === pkg.name, 'index.js 的 name 与 npm 包名一致',
    `index.js="${mod.name}" package.json="${pkg.name}"`);

  /* ── 非插件：不该声明 bundle，也不该有 apply ──────────────────── */
  if (NOT_A_PLUGIN.has(pkg.name)) {
    check(!isPlugin, `${pkg.name} 是纯内容模块 —— 不应导出 apply()（曾经的 complete:true 地雷）`);
    check(!pkg.dsh?.bundle, '未声明 dsh.bundle（不该被当插件安装）');
    console.log('');
    continue;
  }

  /* ── 插件：必须有 bundle patch ─────────────────────────────────── */
  const patchRel = pkg.dsh?.bundle?.patch;
  check(typeof patchRel === 'string' && patchRel !== '',
    '声明了 dsh.bundle.patch（没有它，插件管理器会回滚安装）',
    `dsh.bundle = ${JSON.stringify(pkg.dsh?.bundle ?? null)}`);

  if (typeof patchRel !== 'string') { console.log(''); continue; }

  const patchPath = path.join(pkgDir, patchRel);
  check(existsSync(patchPath), `patch 文件存在：${patchRel}`);
  // npm 的 files 里写的是相对路径（不带 `./`），而 dsh.bundle.patch 习惯写 `./x`。
  // 两边都归一化再比，别让一个前缀差异变成假失败。
  const norm = (s) => String(s).replace(/^\.\//, '');
  check((pkg.files ?? []).map(norm).includes(norm(patchRel)),
    `files 数组包含 ${norm(patchRel)}（否则发布时会被漏掉）`,
    `files = ${JSON.stringify(pkg.files)}`);
  if (!existsSync(patchPath)) { console.log(''); continue; }

  let entries;
  try {
    entries = parseYaml(readFileSync(patchPath, 'utf8'));
  } catch (error) {
    check(false, 'patch 是合法 YAML', error.message);
    console.log('');
    continue;
  }
  check(Array.isArray(entries), 'patch 顶层是数组（cordis patch 格式）');

  const rows = (entries ?? []).flatMap((e) => (Array.isArray(e?.insert) ? e.insert : []));
  check(rows.length > 0, 'patch 里至少有一行 insert');
  const self = rows.find((r) => r?.name === pkg.name);
  check(Boolean(self), `insert 里有一行 name = "${pkg.name}"`,
    `实际 insert 的 name：${JSON.stringify(rows.map((r) => r?.name))}`);
  check(typeof self?.id === 'string' && self.id !== '', '该行有 id');

  if (self?.id) {
    if (seenInsertIds.has(self.id)) {
      check(false, `insert id "${self.id}" 与 ${seenInsertIds.get(self.id)} 冲突（profile 内需唯一）`);
    } else {
      seenInsertIds.set(self.id, pkg.name);
      check(true, `insert id "${self.id}" 唯一`);
    }
  }

  check(pkg.private !== true, '不是 private（private 包发不了，也就装不上）');

  console.log('');
}

console.log(`insert id 总览：${[...seenInsertIds].map(([id, n]) => `${id}(${n})`).join(' · ')}`);
console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}：${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

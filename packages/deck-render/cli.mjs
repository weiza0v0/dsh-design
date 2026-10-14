#!/usr/bin/env node
/**
 * deck-render —— 独立 CLI（不需要 DSH 也能用）
 *
 * 用法:
 *   node cli.mjs <input.html> [选项]
 *
 * 选项:
 *   --out <dir>      输出目录（默认 <input 同级>/.render）
 *   --cdp <url>      连接已有调试端口，如 http://127.0.0.1:9333
 *   --browser <path> 浏览器可执行文件
 *   --slide <n>      只渲第 n 页
 *   --no-sheet       不生成拼图
 *   --json           输出 JSON
 *
 * 例:
 *   node cli.mjs deck.html
 *   node cli.mjs deck.html --cdp http://127.0.0.1:9333
 */
import { renderDeck } from './lib/render.js';

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(`deck-render — render an HTML deck to PNGs

usage: node cli.mjs <input.html> [options]

  --out <dir>        output directory (default: .render/ next to the input)
  --cdp <url>        connect to a running debug port, e.g. http://127.0.0.1:9333
  --browser <path>   browser executable to launch
  --slide <n>        render only page n
  --no-sheet         skip the combined contact sheet
  --json             print machine-readable JSON
`);
  process.exit(argv.length === 0 ? 2 : 0);
}

const opts = { noSheet: false };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--out') opts.outDir = argv[++i];
  else if (a === '--cdp') opts.cdp = argv[++i];
  else if (a === '--browser') opts.browser = argv[++i];
  else if (a === '--slide') opts.onlySlide = Number(argv[++i]);
  else if (a === '--no-sheet') opts.noSheet = true;
  else if (a === '--json') opts.json = true;
  else if (!a.startsWith('--')) opts.htmlPath = a;
  else { console.error(`未知选项：${a}`); process.exit(2); }
}

if (!opts.htmlPath) { console.error('缺少 <input.html>'); process.exit(2); }

try {
  const r = await renderDeck(opts);
  if (opts.json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`✅ ${r.pages} 页 · ${r.distinct} 个唯一 · ${r.via}`);
    if (r.sheet) console.log(`   拼图（先看这张）: ${r.sheet}`);
    for (const s of r.slides) console.log(`   ${s}`);
    if (r.warnings?.length) {
      console.log(`   ⚠️ ${r.warnings.length} 条警告`);
      r.warnings.forEach((w) => console.log(`      ${w}`));
    }
    if (r.pageErrors.length) {
      console.log(`   ⚠️ 页面报错 ${r.pageErrors.length} 条`);
      r.pageErrors.slice(0, 5).forEach((e) => console.log(`      ${e}`));
    }
  }
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}

/**
 * deck_render 回归测试 —— 保护「门一 · 用眼睛看」不静默失效
 *
 * ## 为什么这个测试必须有
 *
 * deck_render 是设计流水线里**唯一**能抓"代码看着对、渲染出来不对"的机制。
 * 它失效的方式不是报错，而是**默默地交出一叠相同的图**，让模型以为看过了全部
 * 页面 —— 然后据此宣布"已验收"。这种失效没有任何外部症状，只能靠测试钉住。
 *
 * ## 覆盖的约定与陷阱
 *
 *   A `.slide.active`        —— 章程 canonical skeleton / html-ppt 家族
 *   B `.slide.is-active`     —— od-deck 自带模板（SKILL.md 让 agent 从这个起步）
 *   C 没有任何激活类          —— 页面在文档流里依次排列
 *   D 隐藏面板里有克隆页      —— od-deck runtime 会 cloneNode 进 `.overview`
 *   E 内容真的重复            —— 必须报警，但不能拒绝交付
 *
 * 运行：
 *
 *   cd <本包> && node scripts/test-render.mjs
 *
 * 需要本机能跑 Playwright 的 Chrome（见 lib/render.js 的浏览器发现逻辑）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { renderDeck, missingBrowserError } from '../lib/render.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'deck-render-test-'));

const shell = (style, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:Georgia,serif;background:#fff;color:#111}
  .slide{width:1280px;height:720px;box-sizing:border-box;padding:96px}
  h1{font-size:72px;margin:0}
  ${style}
</style></head><body>${body}</body></html>`;

const page = (n, cls = 'slide', extra = '') =>
  `<section class="${cls}"${extra}><h1>第 ${n} 页</h1></section>`;

const fixtures = {
  // A · `.active` 约定（html-ppt 家族 / 章程 skeleton）
  'a-active': shell(
    '.slide{display:none}.slide.active{display:block}',
    [1, 2, 3].map((n) => page(n, n === 1 ? 'slide active' : 'slide')).join(''),
  ),

  // B · `.is-active` 约定（od-deck 自带模板）——**旧实现就是在这里瞎的**
  'b-is-active': shell(
    '.slide{position:absolute;inset:0;opacity:0}.slide.is-active{opacity:1}',
    [1, 2, 3].map((n) => page(n, n === 1 ? 'slide is-active' : 'slide')).join(''),
  ),

  // C · 没有激活类，页面在流里依次排列
  'c-in-flow': shell('', [1, 2, 3].map((n) => page(n)).join('')),

  // D · 真实 6 页 + 隐藏概览面板里 6 个克隆页（od-deck runtime 的行为）
  //     期望：只认 6 页，克隆页不该被当成独立页
  'd-clones': shell(
    '.overview{display:none}',
    `<div class="deck">${[1, 2, 3, 4, 5, 6].map((n) => page(n)).join('')}</div>
     <div class="overview">${[1, 2, 3, 4, 5, 6]
       .map((n) => `<div class="mini-slide">${page(n, 'slide is-active')}</div>`)
       .join('')}</div>`,
  ),

  // E · 前两页内容真的相同 —— 期望报警，但不抛错
  'e-real-duplicate': shell('', [1, 1, 2].map((n) => page(n)).join('')),
};

/** 每条用例的期望 */
const expectations = {
  'a-active': { pages: 3, distinct: 3, warns: false },
  'b-is-active': { pages: 3, distinct: 3, warns: false },
  'c-in-flow': { pages: 3, distinct: 3, warns: false },
  'd-clones': { pages: 6, distinct: 6, warns: false },
  'e-real-duplicate': { pages: 3, distinct: 2, warns: true },
};

let passed = 0;
let failed = 0;

const check = (ok, label, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}`);
    if (detail !== undefined) console.log(`     ${detail}`);
  }
};

for (const [id, html] of Object.entries(fixtures)) {
  const file = path.join(root, `${id}.html`);
  writeFileSync(file, html);

  const want = expectations[id];
  console.log(`\n▶︎ ${id}（期望 pages=${want.pages} distinct=${want.distinct}${want.warns ? ' 且有 warning' : ''}）`);

  let result;
  try {
    result = await renderDeck({ htmlPath: file, outDir: path.join(root, `${id}-render`) });
  } catch (error) {
    failed += 1;
    console.log(`  ❌ 渲染抛错：${error.message}`);
    continue;
  }

  check(
    result.pages === want.pages,
    `pages = ${want.pages}`,
    `实际 ${result.pages}（数错页 → 模型可能漏看或空看）`,
  );
  check(
    result.distinct === want.distinct,
    `distinct = ${want.distinct}`,
    `实际 ${result.distinct}（翻页没生效时这里会退到 1，是核心信号）`,
  );
  check(
    Boolean(result.warnings?.length) === want.warns,
    want.warns ? '对真重复内容报警' : '无误报',
    `warnings=${JSON.stringify(result.warnings ?? [])}`,
  );
}

/* ── 缺浏览器时的提示（第一次跑的人最容易撞上） ──────────────────────
 * 这时 `chromium.launch()` 抛的是 "Executable doesn't exist at …"，读者得自己翻。
 * 这里验证我们把它换成了一句能照做的三选一提示 —— 纯函数，不启动浏览器。
 */
console.log('\n▶︎ missingBrowserError（缺浏览器时的提示）');
const fakeNoBrowser = { executablePath: () => path.join(root, 'definitely-not-here', 'chrome') };
const fakeHasBrowser = { executablePath: () => process.execPath };   // 存在的可执行文件
const throwsWhenMissing = { executablePath: () => { throw new Error('not installed'); } };

check(
  missingBrowserError(fakeNoBrowser, { mode: 'launch' }) instanceof Error,
  '本机没 Chrome 且自带也没装 → 报错',
);
const msg = missingBrowserError(fakeNoBrowser, { mode: 'launch' })?.message ?? '';
check(/playwright install chromium/.test(msg), '提示里有「npx playwright install chromium」');
check(/browser="/.test(msg), '提示里有 browser= 参数');
check(/cdp="/.test(msg), '提示里有 cdp= 参数');
check(
  missingBrowserError(throwsWhenMissing, { mode: 'launch' }) instanceof Error,
  'executablePath() 抛错（未安装）→ 同样报错，而不是把异常漏出去',
);
check(
  missingBrowserError(fakeHasBrowser, { mode: 'launch' }) === null,
  '自带的可用 → 不拦',
);
check(
  missingBrowserError(fakeNoBrowser, { mode: 'launch', executablePath: '/some/chrome' }) === null,
  '显式指定了 browser → 不拦（由 Playwright 自己去报路径问题）',
);
check(
  missingBrowserError(fakeNoBrowser, { mode: 'connect' }) === null,
  '连已有调试端口（connect）→ 不拦',
);

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}：${passed} passed, ${failed} failed`);
console.log(`临时目录：${root}`);
process.exit(failed === 0 ? 0 : 1);

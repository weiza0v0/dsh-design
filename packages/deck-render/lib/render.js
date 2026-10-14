/**
 * 渲染核心 —— 平台无关
 *
 * ## 浏览器从哪来（按优先级）
 *
 *   1. `cdp`     —— 连一个已在运行的调试端口（用户自己有浏览器在跑时最省事）
 *   2. `browser` —— 指向某个浏览器可执行文件，交给 Playwright 拉起
 *   3. 都没给    —— 用 Playwright 自带的 Chromium（需 `npx playwright install chromium`）
 *
 * 三条路都走 Playwright 的统一接口，所以 macOS / Linux / Windows 行为一致。
 *
 * ## 为什么不用 ImageMagick 拼图
 *
 * 早期版本用 `montage` 把多页拼成 contact sheet（让模型一次 read_image 看全），
 * 但那给使用者加了一个系统依赖。现在改成**在 Playwright 里用 CSS grid 合成** ——
 * 零额外依赖，还能顺带加页码。
 *
 * ## 关于 WSL
 *
 * 若脚本跑在 WSL、浏览器在 Windows 侧，`file://` 路径要换算成 `D:\…`
 * （Windows 浏览器读不懂 `/mnt/d/…`）。这里只在**检测到目标是 Windows 浏览器**
 * 时才换算，其它平台保持原样 —— 这是唯一的平台分支。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
export const DEFAULT_CDP = 'http://127.0.0.1:9223';

/** WSL 挂载路径 → Windows 路径；非挂载路径返回 null */
export function toWindowsPath(p) {
  const m = p.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!m) return null;
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

/** CDP /json/version 的 UA 字段名是 `User-Agent`（带连字符）——
 *  早期写成 `UserAgent` 导致空串，平台判定失败、用了错误的 file:// 形式。 */
function uaOf(info) {
  return info?.['User-Agent'] ?? info?.UserAgent ?? '';
}

function platformOf(ua) {
  return /Windows/i.test(ua) ? 'windows' : 'posix';
}

/* ── 本机浏览器发现 ──────────────────────────────────────────────
 *
 * 为什么需要：Playwright 自带的浏览器是**按版本号锁定**的 ——
 * playwright-core@1.60.0 只认 `chromium_headless_shell-1223`，机器上装的却是
 * 别的 revision 时 `chromium.launch()` 直接报 "Executable doesn't exist"。
 * （实测：本机是 1243，插件链接的 core 期望 1223，默认路径必然失败。）
 *
 * 但 `launch({ executablePath })` **绕过版本检查** —— 指向哪个就起哪个。
 * 所以这里先在本机找现成的 Chrome，找到就用，找不到才回落到 Playwright 自带。
 ------------------------------------------------------------------ */

/** Playwright 缓存里的浏览器（任意 revision 都能用 executablePath 拉起） */
function playwrightCacheCandidates() {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return [];
  const shells = [];
  const full = [];
  for (const dir of readdirSync(root)) {
    const base = path.join(root, dir);
    try { if (!statSync(base).isDirectory()) continue; } catch { continue; }
    for (const sub of readdirSync(base)) {
      const subpath = path.join(base, sub);
      try { if (!statSync(subpath).isDirectory()) continue; } catch { continue; }
      // headless shell 更轻，渲染场景优先用
      for (const bin of ['chrome-headless-shell', 'headless_shell']) {
        const candidate = path.join(subpath, bin);
        if (existsSync(candidate)) shells.push(candidate);
      }
      for (const bin of ['chrome']) {
        const candidate = path.join(subpath, bin);
        if (existsSync(candidate)) full.push(candidate);
      }
    }
  }
  return [...shells, ...full];
}

/** 系统安装的 Chrome / Chromium */
const SYSTEM_CANDIDATES = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

/** 找一个本机可用浏览器；找不到返回 undefined */
export function discoverLocalBrowser() {
  for (const c of [...playwrightCacheCandidates(), ...SYSTEM_CANDIDATES]) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

/**
 * 找 Chrome 需要的动态库目录。
 *
 * WSL 上 Playwright 的 Chrome 缺 libnspr4/libnss3（本机 anaconda 里恰好有），
 * 不起就会报 "cannot open shared object file"。这里只收**确实含 libnspr4.so**
 * 的目录，避免往 LD_LIBRARY_PATH 里塞无效路径。
 */
export function discoverChromeLibDirs() {
  if (process.platform !== 'linux') return [];
  const dirs = [
    '/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu',
    '/lib/x86_64-linux-gnu', '/lib/aarch64-linux-gnu',
    path.join(os.homedir(), '.apps/anaconda3/lib'),
    path.join(os.homedir(), '.local/share/dsh-deck-render/chromelibs/usr/lib/x86_64-linux-gnu'),
  ];
  return dirs.filter((d) => existsSync(path.join(d, 'libnspr4.so')));
}

/** 起浏览器用的环境（补 LD_LIBRARY_PATH） */
function launchEnv() {
  const libs = discoverChromeLibDirs();
  if (libs.length === 0) return undefined;
  const existing = process.env.LD_LIBRARY_PATH;
  return { ...process.env, LD_LIBRARY_PATH: [...libs, existing].filter(Boolean).join(':') };
}

/**
 * 额外的 Chrome 启动参数，取自环境变量 `DECK_RENDER_ARGS`（空格分隔）。
 *
 * **为什么不默认加 `--no-sandbox`**：关掉沙箱是安全降级，不该为了 CI 方便而
 * 让每个本地用户都承担。CI/容器里显式设：
 *
 *     DECK_RENDER_ARGS="--no-sandbox --disable-dev-shm-usage"
 *
 * `--disable-dev-shm-usage` 是因为容器里 /dev/shm 常常只有 64 MB，大页面
 * 截图会崩在渲染途中。
 */
function launchArgs() {
  const raw = process.env.DECK_RENDER_ARGS;
  if (!raw) return undefined;
  const args = raw.split(/\s+/).filter(Boolean);
  return args.length > 0 ? args : undefined;
}

async function probeCdp(endpoint) {
  const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 决定用哪个浏览器、怎么接。
 * @returns {Promise<{mode:'connect'|'launch', endpoint?:string, executablePath?:string,
 *                    via:string, owns:boolean, browserPlatform:'windows'|'posix'}>}
 */
export async function resolveBrowser({ cdp, browser, browserPlatform } = {}) {
  if (cdp) {
    try {
      const info = await probeCdp(cdp);
      return {
        mode: 'connect', endpoint: cdp, owns: false,
        browserPlatform: browserPlatform ? platformOf(browserPlatform) : platformOf(uaOf(info)),
        via: `connected ${info.Browser ?? cdp}`,
      };
    } catch (error) {
      throw new Error(
        `连不上 CDP ${cdp}：${error.message}\n` +
        '  请确认调试端口已开 —— Chrome 需带 --remote-debugging-port=<port> ' +
        '--remote-allow-origins=* 并使用独立的 --user-data-dir。',
      );
    }
  }

  if (browser) {
    if (!existsSync(browser)) throw new Error(`浏览器路径不存在：${browser}`);
    const isWin = browser.toLowerCase().endsWith('.exe');
    return {
      mode: 'launch', executablePath: browser, owns: true,
      browserPlatform: isWin ? 'windows' : 'posix',
      via: `launched ${path.basename(browser)}`,
    };
  }

  // ③ 都没给：先试默认调试端口（本机常有常驻浏览器），不行再用 Playwright 自带。
  //    这个顺序对使用者最省事，同时在没有常驻浏览器的机器上也能跑通。
  try {
    const info = await probeCdp(DEFAULT_CDP);
    return {
      mode: 'connect', endpoint: DEFAULT_CDP, owns: false,
      browserPlatform: platformOf(uaOf(info)),
      via: `connected ${info.Browser ?? DEFAULT_CDP} (default)`,
    };
  } catch { /* 没有常驻浏览器，落到自带 Chromium */ }

  // 本机现成的 Chrome 优先 —— Playwright 自带的那份按版本号锁定，
  // 机器上装的是别的 revision 时必然起不来（见上文说明）。
  const local = discoverLocalBrowser();
  if (local !== undefined) {
    return {
      mode: 'launch', executablePath: local, owns: true,
      browserPlatform: local.toLowerCase().endsWith('.exe') ? 'windows' : 'posix',
      via: `launched local ${path.basename(local)}`,
    };
  }

  return {
    mode: 'launch', executablePath: undefined, owns: true, browserPlatform: 'posix',
    via: 'launched Playwright bundled Chromium（本机未找到 Chrome；版本不匹配时会失败，`npx playwright install` 可装）',
  };
}

/**
 * 前置检查：既没找到本机 Chrome、Playwright 自带的也没装时，给一句能照做的提示。
 *
 * 为什么值得单独做：这时 `chromium.launch()` 抛的是
 * `Executable doesn't exist at …/headless_shell-1223/…` —— 读者得自己翻才知道
 * 该装什么。**第一次跑的人最容易撞上这个**（仓库里其他测试都不需要浏览器）。
 *
 * 抽成纯函数是为了能单独测：不碰文件系统以外的东西，也不需要真的启动浏览器。
 *
 * @param {{ executablePath: () => string }} chromiumLike  playwright 的 chromium 对象
 * @param {{ mode: string, executablePath?: string }} target  resolveBrowser() 的结论
 * @returns {Error | null}  null 表示「有浏览器可用」
 */
export function missingBrowserError(chromiumLike, target) {
  if (target.mode !== 'launch' || target.executablePath !== undefined) return null;

  let bundled;
  try { bundled = chromiumLike.executablePath(); } catch { bundled = undefined; }
  if (bundled !== undefined && existsSync(bundled)) return null;

  return new Error(
    '找不到可用的浏览器。三选一：\n' +
    '  ① 装 Playwright 自带的 Chromium：npx playwright install chromium\n' +
    '  ② 指定一个已有的浏览器：deck_render(browser="/path/to/chrome")\n' +
    '  ③ 连一个已在跑调试端口的浏览器：deck_render(cdp="http://127.0.0.1:9333")\n' +
    '     （起专用实例：bash scripts/start-headless-browser.sh 9333）',
  );
}

/** 本地文件路径 → 目标浏览器能读的 URL */
function fileUrlFor(absPath, browserPlatform) {
  if (browserPlatform === 'windows') {
    const win = toWindowsPath(absPath);
    if (!win) {
      throw new Error(
        `目标浏览器在 Windows 侧，但路径 ${absPath} 不在挂载盘（/mnt/c、/mnt/d …）上，` +
        'Windows 浏览器读不到。请把交付物写到挂载盘，或改用原生浏览器。',
      );
    }
    return `file:///${win.replace(/\\/g, '/')}`;
  }
  return `file://${absPath}`;
}

/**
 * 页选择 + 翻页 —— **故意不押注任何"激活类"的命名，也不数错页**。
 *
 * ## 踩过的坑一：只翻 `.active`，而模板用的是 `.is-active`
 *
 * 原实现只翻 `.active`。但同一体系里的两个交付物用了**两套约定**：
 *
 *   · `od-deck/templates/deck.html` + `assets/base.css`  →  `.slide.is-active`
 *     （`runtime.js` 也只 toggle `is-active`）
 *   · 章程 canonical skeleton / html-ppt 家族            →  `.slide.active`
 *
 * 而 `od-deck/SKILL.md` 让 agent「起点用 `templates/deck.html`」。于是实测：
 * **照技能指示做出来的 deck，渲出 12 张字节完全相同的图**，工具还报
 * "12 page(s)" 成功 —— 模型的"看图自检"看到的是第 1 页重复 12 次，
 * 却以为全部看过。
 *
 * 这是最糟的失效模式：**闸门静默失效比闸门报错危险得多** —— 报错会让人去修，
 * 静默失效会让人得出"已验收"的错误结论。
 *
 * ## 踩过的坑二：模板运行时会克隆幻灯片
 *
 * 修完类名后仍是 7 张唯一 / 12 页。根因：`od-deck/assets/runtime.js:167`
 * 为「概览面板」把每页 `cloneNode(true)` 一份塞进 `.mini-slide`，
 * 而 `.overview{display:none}`（base.css:125）。`querySelectorAll('.slide')`
 * 因此数到 **6 真 + 6 克隆**，克隆体那 6 页渲出来全是空白且彼此全同。
 *
 * 判别办法：**只看祖先是否被隐藏，不看元素自身的 display。**
 *   · od-deck 克隆体 → 祖先 `.overview` 是 `display:none` → 排除 ✅
 *   · html-ppt 的非活动页 → 隐藏的是**元素自身**（`:not(.active){display:none}`）
 *     → 祖先正常 → 保留 ✅
 *   · 手写的在流里的多页 → 祖先正常 → 保留 ✅
 *
 * 这条规则必须**只看祖先**：因为本函数自己会把非目标页设成 `display:none`，
 * 若把元素自身的 display 也算进去，第一次调用之后剩下的页就全被排除了。
 *
 * 注意：本函数会被 Playwright 序列化后送进页面执行，**不能引用任何外部变量**
 * （连同模块的另一个函数也不行）。
 *
 * @param {{mode:'count'} | {mode:'show', index:number}} task
 * @returns {number} 真实页数
 */
function slidePages(task) {
  const slides = Array.from(document.querySelectorAll('.slide')).filter((el) => {
    for (let p = el.parentElement; p !== null && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).display === 'none') return false;
    }
    return true;
  });

  if (task.mode === 'count') return slides.length;

  const idx = task.index;
  slides.forEach((el, n) => {
    const on = n === idx;
    el.classList.toggle('active', on);
    el.classList.toggle('is-active', on);
    if (on) {
      el.style.removeProperty('display');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('pointer-events', 'auto', 'important');
      el.style.setProperty('z-index', '2', 'important');
    } else {
      el.style.setProperty('display', 'none', 'important');
    }
  });
  return slides.length;
}

/** 用 Playwright 页面把多张图拼成一张 contact sheet（不依赖 ImageMagick） */
async function composeSheet(context, slidePaths, sheetPath, viewport) {
  const cols = slidePaths.length <= 2 ? slidePaths.length : 3;
  const rows = Math.ceil(slidePaths.length / cols);
  const gap = 12;
  const labelH = 26;
  const cellW = Math.round(viewport.width / 2.4);   // 缩到约 4 成，控制整图体积
  const cellH = Math.round((cellW * viewport.height) / viewport.width) + labelH;
  const width = cols * cellW + (cols + 1) * gap;
  const height = rows * cellH + (rows + 1) * gap;

  const cells = slidePaths
    // 用 base64 内嵌而不是 file:// 引用：拼图页由**目标浏览器**加载，
    // 若它是 Windows 侧的，WSL 路径（/tmp/…）它读不到。内嵌后与路径无关。
    .map((p, i) => {
      const b64 = readFileSync(p).toString('base64');
      return `<figure><img src="data:image/png;base64,${b64}" alt="slide ${i + 1}">` +
             `<figcaption>${String(i + 1).padStart(2, '0')}</figcaption></figure>`;
    })
    .join('');

  const page = await context.newPage();
  try {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>
         *{margin:0;padding:0;box-sizing:border-box}
         body{background:#1a1916;padding:${gap}px}
         .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:${gap}px}
         figure{display:flex;flex-direction:column;gap:6px}
         img{width:100%;display:block;border:1px solid #333}
         figcaption{color:#8a8578;font:12px/1.4 ui-monospace,monospace;letter-spacing:.08em}
       </style><div class="grid">${cells}</div>`,
      { waitUntil: 'load' },
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: sheetPath });
    return sheetPath;
  } finally {
    await page.close();
  }
}

/**
 * 渲染一个 HTML 文件。
 * @param {object} o
 * @param {string} o.htmlPath
 * @param {string} [o.outDir]
 * @param {string} [o.cdp]         已有调试端口的 endpoint
 * @param {string} [o.browser]     浏览器可执行文件路径
 * @param {number} [o.onlySlide]   只渲第 N 页（1-based）
 * @param {number} [o.settleMs]    等字体/图片落定的时长
 * @param {number} [o.timeoutMs]   打开页面的超时
 * @param {AbortSignal} [o.signal]
 * @param {object} [o.viewport]
 * @param {string} [o.playwright]  playwright-core 的导入说明符
 * @param {boolean} [o.noSheet]    不拼图
 */
export async function renderDeck(o) {
  const {
    htmlPath, outDir: outDirArg, cdp, browser, browserPlatform, onlySlide, onlySlides,
    settleMs = 2000, timeoutMs = 30000, signal,
    viewport = DEFAULT_VIEWPORT, playwright = 'playwright-core', noSheet = false,
  } = o;

  if (!htmlPath) throw new Error('htmlPath 必填');
  if (!existsSync(htmlPath)) throw new Error(`找不到文件：${htmlPath}`);
  const abs = path.resolve(htmlPath);

  const outDir = path.resolve(outDirArg || path.join(path.dirname(abs), '.render'));
  mkdirSync(outDir, { recursive: true });
  const baseName = path.basename(abs).replace(/\.html?$/i, '');

  const { chromium } = await import(playwright).catch(() => import('playwright-core'));
  const target = await resolveBrowser({ cdp, browser, browserPlatform });
  const url = fileUrlFor(abs, target.browserPlatform);

  let connection;
  try {
    const missing = missingBrowserError(chromium, target);
    if (missing !== null) throw missing;

    connection = target.mode === 'connect'
      ? await chromium.connectOverCDP(target.endpoint)
      : await chromium.launch({
        executablePath: target.executablePath,
        env: launchEnv(),
        args: launchArgs(),   // 容器/CI 用 DECK_RENDER_ARGS 传 --no-sandbox，见 launchArgs()
      });

    const context = target.mode === 'connect'
      ? (connection.contexts()[0] ?? (await connection.newContext()))
      : await connection.newContext();

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));

    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForTimeout(settleMs);

    // 真实页数 —— 只数参与排版的 `.slide`，排除运行时克隆进隐藏面板的副本
    const total = await page.evaluate(slidePages, { mode: 'count' });
    const count = Math.max(total, 1);
    const indices = onlySlides?.length
      ? [...new Set(onlySlides.map((n) => Math.min(Math.max(n, 1), count) - 1))].sort((a, b) => a - b)
      : onlySlide
        ? [Math.min(Math.max(onlySlide, 1), count) - 1]
        : Array.from({ length: count }, (_, i) => i);

    // 只清掉本次要重渲的那几页 —— 整目录清空会让「只渲第 16 页」把
    // 1–15、17–n 全删掉，而调用方往往正等着读那几张图。
    for (const i of indices) {
      rmSync(path.join(outDir, `slide-${i + 1}.png`), { force: true });
    }

    const slides = [];
    for (const i of indices) {
      if (total > 0) {
        // 见 slidePages 的注释：不押注单一激活类名，且排除隐藏面板里的克隆页
        await page.evaluate(slidePages, { mode: 'show', index: i });
        await page.waitForTimeout(200);
      }
      const file = path.join(outDir, `slide-${i + 1}.png`);
      await page.screenshot({ path: file });
      slides.push(file);
    }
    await page.close();

    /* ── 重复页检测：让「门一」不可能静默骗人 ────────────────────────
     *
     * 翻页一旦没生效，每一页截图都是同一个初始状态，而工具会如实报告
     * "N page(s)" —— 调用方无从分辨。这里按像素指纹自查：只要有两页
     * 字节完全相同，就明说「你看到的可能是同一页的重复」。
     *
     * 用 warning 而不是抛错：**真的重复内容**（比如两页刻意一样的
     * 分隔页）是合法的，不能因为检测到重复就拒绝交付。让模型自己判断。
     */
    const digestOf = (p) => createHash('sha1').update(readFileSync(p)).digest('hex');
    const byDigest = new Map();
    slides.forEach((p, n) => {
      const d = digestOf(p);
      if (!byDigest.has(d)) byDigest.set(d, []);
      byDigest.get(d).push(indices[n] + 1);
    });

    const duplicateGroups = [...byDigest.values()].filter((pages) => pages.length > 1);
    const warnings = [];
    if (duplicateGroups.length > 0) {
      const dupCount = duplicateGroups.reduce((sum, g) => sum + g.length - 1, 0);
      warnings.push(
        `${slides.length} 页里有 ${dupCount} 页与其它页**像素级完全相同** —— ` +
        '翻页很可能没生效，你看到的可能是同一页重复，而不是 N 页内容。' +
        '（若确实是有意重复的分隔页，可忽略。）' +
        `重复组：${duplicateGroups.map((g) => g.join('=')).join(' · ')}`,
      );
    }

    let sheet = null;
    if (!noSheet && slides.length > 1) {
      try {
        sheet = await composeSheet(context, slides, path.join(outDir, `${baseName}-sheet.png`), viewport);
      } catch { /* 拼图失败不致命 */ }
    }

    return {
      url, outDir, pages: slides.length, distinct: byDigest.size,
      slides, sheet, via: target.via, pageErrors, warnings,
    };
  } finally {
    // ⚠️ 只关自己拉起的；connect 来的是**别人的浏览器** —— Playwright 的
    // `close()` 会把它真的关掉（早期版本因此误关过用户的 agent 浏览器）。
    if (target.owns) {
      try { await connection?.close(); } catch { /* 忽略 */ }
    }
  }
}

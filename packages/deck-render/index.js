/**
 * dsh-deck-render —— 把 HTML 交付物渲染成图片，供模型 `read_image` 回看
 *
 * ## 为什么要这个工具
 *
 * 设计类任务最大的失效模式是"代码看着对、渲染出来不对"：中文字体回退、
 * 行高把标题挤在一起、色板没绑对、内容溢出。**规则再全也抓不到"这页不好看"** ——
 * 只有把渲染结果给模型看，它才知道要改什么。
 *
 * 工具一次调用产出「拼图 + 单页 PNG」，模型再 `read_image` 拼图就能一次看全，
 * 比逐页读图省 N 倍 token。
 *
 * ## 浏览器接入（按优先级）
 *
 *   1. `cdp`     —— 连一个已在运行的调试端口
 *   2. `browser` —— 浏览器可执行文件（原生/Linux/macOS 交给 Playwright 拉起）
 *   3. 都不给    —— 先试默认端口 127.0.0.1:9223，不行再用 Playwright 自带 Chromium
 *
 * ## 想要渲染无感（不弹标签页）
 *
 * 连用户常驻浏览器会弹标签页。要完全无感，先起一个专用 headless 实例：
 *
 *   bash <本包>/scripts/start-headless-browser.sh 9333
 *   deck_render(path="…", cdp="http://127.0.0.1:9333")
 *
 * ## 平台
 *
 * macOS / Linux / Windows / WSL 均可。唯一平台分支在 WSL：
 * 若目标浏览器在 Windows 侧，`file://` 路径会自动换算为 `D:\…` 形式
 * （Windows 浏览器读不懂 `/mnt/d/…`）。拼图用 base64 内嵌，与路径无关。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { renderDeck } from './lib/render.js';

export const name = 'dsh-deck-render';
export const inject = ['tools'];

const here = path.dirname(fileURLToPath(import.meta.url));

const DESCRIPTION = [
  'Render an HTML artifact (deck or page) to PNG images so you can look at the',
  'result instead of guessing from the code.',
  '',
  'Use this AFTER writing or editing an HTML deck/page and BEFORE telling the user',
  'it is finished. It writes one PNG per slide plus a combined contact sheet, then',
  'read the contact sheet with read_image — that single image shows every page at',
  'once, so you do not need one read_image per page.',
  '',
  'This is the gate that catches what rules cannot: CJK font fallback, headings',
  'whose lines collide, wrong palette binding, content overflow, poor whitespace.',
  'Fix what you see, render again, and only then run the lint gate.',
  '',
  'Rendering uses a real browser (so fonts and network assets resolve as the user',
  'would see them). By default it connects to a running debug port; pass `cdp` to',
  'point at a specific one, or `browser` at a browser executable.',
].join('\n');

/**
 * 解析 `slides` 参数。
 *
 * 支持单页 `"3"`、区间 `"2-5"`、列表 `"2,6,9,16"`、以及混合 `"1-3,7"`。
 * 顺序无所谓，重复会去重 —— 调用方通常只关心「渲哪几页」。
 *
 * 之所以有区间和列表：早期版本只支持单页，但工具描述里写了区间，
 * 模型照着描述传 `slides="2,6,9,16"` 就会撞到未实现的错误。文档承诺的
 * 能力要么实现、要么别写。
 *
 * @param {unknown} raw
 * @returns {number[] | undefined} 升序去重后的页码；未提供时返回 undefined
 */
export function parseSlideSpec(raw) {
  const spec = String(raw ?? '').trim();
  if (spec === '') return undefined;

  const pages = new Set();
  for (const part of spec.split(',')) {
    const piece = part.trim();
    if (piece === '') continue;

    const range = piece.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n += 1) pages.add(n);
      continue;
    }
    if (/^\d+$/.test(piece)) {
      pages.add(Number(piece));
      continue;
    }
    throw new Error(
      `无法解析 slides="${spec}"：` + `"${piece}" 不是页码。` +
      '可用形式："3"（单页）、"2-5"（区间）、"2,6,9,16"（列表）、"1-3,7"（混合）。',
    );
  }

  if (pages.size === 0) return undefined;
  return [...pages].sort((a, b) => a - b);
}

/* ── 结果整形 ─────────────────────────────────────────────────── */

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function summarize(value) {
  const distinct = typeof value.distinct === 'number'
    ? ` · ${value.distinct} distinct`
    : '';
  const lines = [
    `deck_render · ${value.via}`,
    `${value.pages} page(s)${distinct} → ${value.out_dir}`,
  ];
  if (value.sheet) lines.push(`contact sheet (read this one first): ${value.sheet}`);
  if (value.pages > 1) {
    lines.push(`single pages: ${value.slides[0]} … ${value.slides[value.slides.length - 1]}`);
  } else if (value.slides[0]) {
    lines.push(`page: ${value.slides[0]}`);
  }
  lines.push('', 'Now call read_image on the contact sheet and fix what looks wrong.');
  if (value.warnings?.length) {
    lines.push('', `⚠️ ${value.warnings.length} warning(s):`);
    for (const w of value.warnings) lines.push(`  - ${w}`);
  }
  if (value.page_errors?.length) {
    lines.push('', `⚠️ ${value.page_errors.length} page error(s):`);
    for (const e of value.page_errors.slice(0, 5)) lines.push(`  - ${e}`);
  }
  return lines.join('\n');
}

export function apply(ctx, _config) {
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'deck_render',
        description: DESCRIPTION,
        parameters: {
          path: {
            type: 'string',
            required: true,
            description: 'Path to the HTML file to render. Absolute, or relative to the current working directory.',
          },
          out_dir: {
            type: 'string',
            description: 'Directory for the PNGs. Defaults to a `.render/` folder next to the HTML file.',
          },
          cdp: {
            type: 'string',
            description: 'CDP endpoint of a browser to use, e.g. http://127.0.0.1:9333. Wins over `browser`.',
          },
          browser: {
            type: 'string',
            description: 'Path to a browser executable. Only needed when no debug port is available.',
          },
          slides: {
            type: 'string',
            description: 'Render only some pages. Accepts "3" (one page), "2-5" (a range), "2,6,9,16" (a list), or a mix like "1-3,7". Omitted = all pages.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              via: { type: 'string' },
              url: { type: 'string' },
              out_dir: { type: 'string' },
              pages: { type: 'number' },
              distinct: { type: 'number' },
              sheet: { type: 'string' },
              slides: { type: 'array', items: { type: 'string' } },
              warnings: { type: 'array', items: { type: 'string' } },
              page_errors: { type: 'array', items: { type: 'string' } },
            },
          },
          render(_args, value) {
            return [{ type: 'text', text: summarize(value) }];
          },
        },
        isConcurrencySafe: () => false,   // 同一个浏览器上并发渲染会互相干扰
        async execute(args, exec) {
          const htmlPath = String(args?.path ?? '').trim();
          if (htmlPath === '') throw new Error('`path` must be a non-empty string.');

          // 解析 slides —— 支持 "3" / "2-5" / "2,6,9,16" / "1-3,7"
          const onlySlides = parseSlideSpec(args?.slides);

          const result = await renderDeck({
            htmlPath,
            outDir: args?.out_dir ? String(args.out_dir) : undefined,
            cdp: args?.cdp ? String(args.cdp).trim() : undefined,
            browser: args?.browser ? String(args.browser).trim() : undefined,
            onlySlides,
            signal: exec?.signal,
          });

          return {
            via: result.via,
            url: result.url,
            out_dir: toPosix(result.outDir),
            pages: result.pages,
            distinct: result.distinct,
            ...(result.sheet ? { sheet: toPosix(result.sheet) } : {}),
            slides: result.slides.map(toPosix),
            warnings: result.warnings ?? [],
            page_errors: result.pageErrors ?? [],
          };
        },
      }),
    ),
  );
}

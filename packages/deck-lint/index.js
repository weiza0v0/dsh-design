/**
 * dsh-deck-lint — 把 OpenDesign 的确定性反 AI-slop 检查器接成 DSH 工具。
 *
 * 设计意图：把审美规则从「提示词软约束」升级为「代码硬检查」。
 * skill 会漂移（模型越弱越容易忽略长指令），代码不会 —— 同一条规则，
 * 弱模型会被抓住，强模型会被放过，判定标准不随模型换代而变。
 *
 * 规则本体在 src/lint.js，是从 OpenDesign 的构建产物逐字移植的
 * （见 README 的「移植来源与偏差」一节）。本文件只做外壳：读写文件、
 * 组装返回值、渲染给模型。
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { lintArtifact, renderFindingsForAgent } from './src/lint.js';

export const name = 'dsh-deck-lint';
export const inject = ['tools'];

/** 4 MiB 上限：deck 是单文件 HTML，超过这个量级通常是误传了别的东西 */
const MAX_HTML_BYTES = 4 * 1024 * 1024;

const TOOL_NAME = 'deck_lint';

const DESCRIPTION = [
  'Lint an HTML artifact (deck or page) against a deterministic anti-AI-slop and',
  'design-token rule set, and return findings with severity P0/P1/P2, a message,',
  'and a concrete fix.',
  '',
  'Use this BEFORE telling the user an HTML deck or page is finished, and again',
  'after any edit that touches markup or styles. P0 findings must reach zero;',
  'P1 should be fixed or consciously accepted; P2 is optional polish.',
  '',
  'The rules are greppy and deterministic, not an aesthetic opinion: AI-default',
  'indigo (#6366f1 and friends), purple/blue-cyan "trust" gradients, emoji used',
  'as icons, sans-serif display faces where a serif is bound, invented metrics,',
  'filler copy, ALL-CAPS without adequate tracking, raw hex outside :root,',
  'accent overuse, external image URLs, and deck-specific slide theme/rhythm',
  'checks. Every finding carries a snippet so you can judge a suspected false',
  'positive instead of trusting the rule blindly.',
  '',
  'Exactly one of `path` or `html` is required.',
].join('\n');

/* ── 输入解析 ─────────────────────────────────────────────────── */

function resolveTarget(args) {
  const rawPath = typeof args?.path === 'string' ? args.path.trim() : '';
  const rawHtml = typeof args?.html === 'string' ? args.html : '';
  const hasPath = rawPath !== '';
  const hasHtml = rawHtml !== '';

  if (hasPath === hasHtml) {
    throw new Error(
      'Provide exactly one of `path` (a file to read) or `html` (inline markup).',
    );
  }

  if (hasHtml) {
    return { html: rawHtml, source: '<inline html>' };
  }

  const resolved = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);

  let info;
  try {
    info = statSync(resolved);
  } catch {
    throw new Error(`Cannot read "${resolved}" — file not found.`);
  }
  if (!info.isFile()) {
    throw new Error(`"${resolved}" is not a regular file.`);
  }
  if (info.size > MAX_HTML_BYTES) {
    throw new Error(
      `"${resolved}" is ${Math.round(info.size / 1024 / 1024)} MiB, over the ${MAX_HTML_BYTES / 1024 / 1024} MiB limit for an HTML artifact.`,
    );
  }

  return { html: readFileSync(resolved, 'utf8'), source: resolved };
}

/* ── 结果整形 ─────────────────────────────────────────────────── */

function countBySeverity(findings) {
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const finding of findings) {
    if (counts[finding.severity] === undefined) counts[finding.severity] = 0;
    counts[finding.severity] += 1;
  }
  return counts;
}

function normalizeFinding(finding) {
  // output.schema 只能声明确定存在的字段；snippet 是可选的就不要塞 undefined
  const normalized = {
    severity: String(finding.severity),
    id: String(finding.id),
    message: String(finding.message),
    fix: String(finding.fix),
  };
  if (typeof finding.snippet === 'string' && finding.snippet !== '') {
    normalized.snippet = finding.snippet;
  }
  return normalized;
}

function renderForModel(value) {
  const { counts, findings, source, verdict } = value;

  if (findings.length === 0) {
    return `deck_lint · ${source}\n✅ 0 findings — no P0/P1/P2 issues.`;
  }

  // 上游的 renderFindingsForAgent 是给 OpenDesign 的 <artifact> 交付模型写的，
  // 结尾要求"下一轮重新输出一个 <artifact> 块"。DSH 里模型直接写文件，
  // 那句会误导它去吐代码块而不是改文件 —— 所以按前缀丢掉该行，其余清单逐字保留。
  // 上游若改了措辞，这行过滤就自然失配（无害降级），不会误删正文。
  const body = renderFindingsForAgent(findings)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('Re-emit a corrected'))
    .join('\n');

  const head =
    `deck_lint · ${source}\n` +
    `${counts.P0} P0 (must fix) · ${counts.P1} P1 (should fix) · ${counts.P2} P2 (optional)\n` +
    (verdict === 'block'
      ? 'P0 findings block delivery: edit the file in place and re-run deck_lint until P0 is zero.\n'
      : 'No P0. Fix what is worth fixing, then re-run deck_lint before declaring done.\n');

  return `${head}\n${body}`;
}

/* ── 工具注册 ─────────────────────────────────────────────────── */

export function apply(ctx, _config) {
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
          path: {
            type: 'string',
            description:
              'Path to an HTML file to lint. Absolute, or relative to the current working directory.',
          },
          html: {
            type: 'string',
            description:
              'Inline HTML to lint instead of reading a file. Mutually exclusive with `path`.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              source: { type: 'string' },
              verdict: { type: 'string' },
              counts: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  P0: { type: 'number' },
                  P1: { type: 'number' },
                  P2: { type: 'number' },
                },
              },
              findings: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    severity: { type: 'string' },
                    id: { type: 'string' },
                    message: { type: 'string' },
                    fix: { type: 'string' },
                    snippet: { type: 'string' },
                  },
                },
              },
            },
          },
          render(_args, value) {
            return [{ type: 'text', text: renderForModel(value) }];
          },
        },
        async execute(args) {
          const { html, source } = resolveTarget(args);
          const findings = (lintArtifact(html) ?? []).map(normalizeFinding);
          const counts = countBySeverity(findings);

          return {
            source,
            verdict: counts.P0 > 0 ? 'block' : 'pass',
            counts,
            findings,
          };
        },
      }),
    ),
  );
}

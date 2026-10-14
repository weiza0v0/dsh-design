/**
 * dsh-media-gen —— 图片 / 视频 / 语音生成（BYOK）
 *
 * ## 设计取舍：按协议而不是按厂商
 *
 * OpenDesign 的 media 管道 3,978 行、29 个 renderer，因为各家 provider 的
 * submit/poll/download 细节都不同。但拆开只有两种协议：
 *
 *   · `openai` —— /images/generations · /audio/speech
 *                 覆盖 OpenAI、Azure、以及任何兼容端点（火山图片也是这个载荷）
 *   · `queue`  —— 提交 → 轮询 → 取结果 URL → 下载
 *                 覆盖 fal.ai（kling/seedance/veo/wan/flux）与火山视频
 *
 * 所以本包只有两个适配器 + 一张精选模型表。表里没有的模型也能用 ——
 * 直接传完整端点（`fal-ai/…` 或 `openai:<model>`）。
 *
 * ## 密钥
 *
 * 不算 OD 的 SQLite 配置层。用环境变量或一个可选 JSON：
 *   FAL_KEY / FAL_API_KEY · ARK_API_KEY · OPENAI_API_KEY (+ OPENAI_BASE_URL)
 *   ~/.dsh/media-gen.json  →  { "providers": { "fal": { "apiKey": "…" } } }
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { generate } from './lib/generate.js';
import { listModels, MODELS } from './lib/models.js';
import { configPath, loadConfigFile } from './lib/config.js';

export const name = 'dsh-media-gen';
export const inject = ['tools'];

const here = path.dirname(fileURLToPath(import.meta.url));

const KINDS = ['image', 'video', 'speech'];

const GEN_DESCRIPTION = [
  'Generate an image, a video clip, or a speech audio file with a media model,',
  'and write the result into the workspace.',
  '',
  'Call media_models first to see which model ids are available. You pay for these',
  'calls yourself (BYOK) — they hit a real provider API, so do not generate',
  'speculatively: confirm the subject, style and aspect ratio before spending.',
  '',
  'For video, the call blocks while the provider renders (usually 1–5 minutes,',
  'up to 15). Announce the wait rather than silently stalling.',
  '',
  'This does NOT render HTML — for turning an HTML composition into MP4, use the',
  'dedicated local renderer instead (no API cost).',
].join('\n');

function fmtList(ids) { return ids.map((i) => `\`${i}\``).join(', '); }

export function apply(ctx, _config) {
  // ── 工具 1：列模型 ──────────────────────────────────────────────
  ctx.effect(() =>
    ctx.tools.register(defineTool({
      name: 'media_models',
      description:
        'List the media models this harness can call (image / video / speech), and report which '
        + 'provider credentials are currently configured. Call this before media_generate.',
      parameters: {},
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            image: { type: 'array', items: { type: 'string' } },
            video: { type: 'array', items: { type: 'string' } },
            speech: { type: 'array', items: { type: 'string' } },
            configured: { type: 'array', items: { type: 'string' } },
            config_path: { type: 'string' },
            note: { type: 'string' },
          },
        },
        render(_a, v) {
          const lines = [
            'media_models',
            `configured credentials: ${v.configured.length ? v.configured.join(', ') : '（无 —— 需要设置环境变量）'}`,
            v.config_path ? `config file: ${v.config_path}` : '',
            '',
            `image  (${v.image.length}): ${fmtList(v.image) || '—'}`,
            `video  (${v.video.length}): ${fmtList(v.video) || '—'}`,
            `speech (${v.speech.length}): ${fmtList(v.speech) || '—'}`,
          ];
          if (v.note) lines.push('', v.note);
          return [{ type: 'text', text: lines.filter(Boolean).join('\n') }];
        },
      },
      isConcurrencySafe: () => true,
      async execute() {
        const by = listModels();
        const configured = [];
        if (process.env.FAL_KEY || process.env.FAL_API_KEY) configured.push('fal');
        if (process.env.ARK_API_KEY) configured.push('ark (volcengine)');
        if (process.env.OPENAI_API_KEY) configured.push('openai');

        const cfg = loadConfigFile();
        for (const [k, v] of Object.entries(cfg.providers ?? {})) {
          if (v?.apiKey && !configured.some((c) => c.startsWith(k))) configured.push(`${k} (config file)`);
        }

        return {
          image: by.image ?? [], video: by.video ?? [], speech: by.speech ?? [],
          configured, config_path: configPath(),
          note: configured.length
            ? 'Ready. Confirm subject/style/aspect with the user before spending a call.'
            : 'No credentials found. Set FAL_KEY / ARK_API_KEY / OPENAI_API_KEY, or write them '
              + 'into the config file as { "providers": { "<family>": { "apiKey": "…" } } }.',
        };
      },
    })),
  );

  // ── 工具 2：生成 ────────────────────────────────────────────────
  ctx.effect(() =>
    ctx.tools.register(defineTool({
      name: 'media_generate',
      description: GEN_DESCRIPTION,
      parameters: {
        model: { type: 'string', required: true, description: 'Model id from media_models, e.g. "fal/flux-schnell", "fal/veo-3", "openai/tts", "ark/seedream-3.0".' },
        prompt: { type: 'string', required: true, description: 'What to generate. For speech this is the text to read aloud.' },
        kind: { type: 'string', description: `One of ${KINDS.join(' / ')}. Defaults to the model's own kind.` },
        out: { type: 'string', description: 'Output file or directory. Defaults to a name derived from the prompt, in the working directory.' },
        aspect: { type: 'string', description: 'Aspect ratio: 16:9 / 1:1 / 9:16 / 4:3 / 3:4. Provider defaults apply.' },
        duration: { type: 'string', description: 'Video length in seconds (models cap this; 5–8 is typical).' },
        image: { type: 'string', description: 'Input image path for image-to-video or image editing.' },
        voice: { type: 'string', description: 'Voice id for speech models, e.g. "alloy".' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string' }, bytes: { type: 'number' },
            kind: { type: 'string' }, model: { type: 'string' }, family: { type: 'string' },
            progress: { type: 'array', items: { type: 'string' } },
          },
        },
        render(_a, v) {
          const kb = Math.round(v.bytes / 1024);
          const lines = [`✅ ${v.kind} 已生成 · ${v.model} (${v.family})`, `   ${v.path}  ·  ${kb} KB`];
          if (v.kind === 'image') lines.push('', 'Look at it with read_image before showing the user.');
          if (v.progress?.length) lines.push('', `   provider states seen: ${v.progress.join(' → ')}`);
          return [{ type: 'text', text: lines.join('\n') }];
        },
      },
      isConcurrencySafe: () => false,   // 生成很贵，不要并发堆
      async execute(args, exec) {
        const model = String(args?.model ?? '').trim();
        const prompt = String(args?.prompt ?? '').trim();
        if (!model) throw new Error('`model` 必填 —— 先用 media_models 看可用清单。');
        if (!prompt) throw new Error('`prompt` 必填。');

        const kind = args?.kind ? String(args.kind).trim() : undefined;
        if (kind && !KINDS.includes(kind)) {
          throw new Error(`\`kind\` 只能是 ${KINDS.join(' / ')}，收到 "${kind}"。`);
        }

        const progress = [];
        const result = await generate({
          model, prompt, kind,
          out: args?.out ? String(args.out) : undefined,
          aspect: args?.aspect ? String(args.aspect).trim() : undefined,
          duration: args?.duration ? Number(args.duration) : undefined,
          image: args?.image ? String(args.image) : undefined,
          voice: args?.voice ? String(args.voice) : undefined,
          onProgress: (s) => { if (!progress.includes(s)) progress.push(s); },
          signal: exec?.signal,
        });

        return {
          path: result.path, bytes: result.bytes, kind: result.kind,
          model: result.model, family: result.family,
          ...(progress.length ? { progress } : {}),
        };
      },
    })),
  );
}

export { MODELS };

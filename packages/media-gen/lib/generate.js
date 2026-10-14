/**
 * 生成调度：把 (family, kind) 映射到两种协议之一，组装请求体，落盘。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveCredentials, loadConfigFile, configPath } from './config.js';
import { resolveModel, FAL_IMAGE_SIZES } from './models.js';
import { runOpenAI, runQueue, MediaError } from './providers.js';

const EXT_BY_KIND = { image: 'png', video: 'mp4', speech: 'mp3' };

/** 从 prompt 里推一个文件名 —— 取前几个词，去掉不能做文件名的字符 */
export function autoName(model, prompt, ext) {
  // prompt 为空时退回模型 id。先把 `provider/model` 的斜杠换成连字符 ——
  // 否则会被下面的「去非法字符」直接吃掉，得到 `openaitts` 这种难读的名字。
  const source = prompt || String(model ?? '').replace(/[/\\]/g, '-');
  const slug = String(source)
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-')
    .slice(0, 48) || 'output';
  return `${slug}.${ext}`;
}

function falQueueBase(baseUrl) {
  if (baseUrl.includes('queue.fal.run')) return baseUrl;
  return baseUrl.replace(/^https:\/\/fal\.run/, 'https://queue.fal.run');
}

/**
 * @param {object} o
 * @param {string} o.model      模型 id（见 lib/models.js）或完整端点
 * @param {'image'|'video'|'speech'} [o.kind]  可选，默认取模型表
 * @param {string} o.prompt
 * @param {string} [o.out]      输出路径（文件或目录）
 * @param {string} [o.aspect]   16:9 / 1:1 / 9:16 …
 * @param {number} [o.duration] 视频秒数
 * @param {string} [o.image]    输入图路径（i2v / 图生图）
 * @param {string} [o.voice]    TTS 音色
 * @param {(s:string)=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 */
export async function generate(o) {
  const spec = resolveModel(o.model);
  if (!spec) {
    throw new Error(
      `未知模型 "${o.model}"。用 media_models 工具看可用清单，` +
      '或直接传完整端点（`fal-ai/…` 或 `openai:<model>`）。',
    );
  }
  const kind = o.kind || spec.kind;
  const cfg = loadConfigFile();
  const creds = resolveCredentials(spec.family, cfg);

  if (!creds.apiKey) {
    throw new Error(
      `${spec.family} 缺少 API key。设置 ${creds.envHints.join(' 或 ')}，` +
      `或写进 ${configPath()} 的 providers.${spec.family}.apiKey。`,
    );
  }

  let result;
  if (spec.family === 'fal') result = await fal(spec, kind, o, creds);
  else if (spec.family === 'ark') result = await ark(spec, kind, o, creds);
  else if (spec.family === 'openai') result = await openai(spec, kind, o, creds);
  else throw new Error(`未实现的协议族：${spec.family}`);

  // ── 落盘 ──────────────────────────────────────────────────────
  const ext = result.ext ?? EXT_BY_KIND[kind] ?? 'bin';
  let outPath = o.out;
  if (!outPath) {
    outPath = result.filename ?? autoName(o.model, o.prompt, ext);
  } else if (outPath.endsWith(path.sep) || (!path.extname(outPath) && !outPath.endsWith(`.${ext}`))) {
    outPath = path.join(outPath, result.filename ?? autoName(o.model, o.prompt, ext));
  }
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(outPath, result.bytes);

  return { path: path.resolve(outPath), bytes: result.bytes.length, kind, model: o.model, family: spec.family };
}

/* ── fal.ai ────────────────────────────────────────────────────── */
async function fal(spec, kind, o, creds) {
  const queueBase = falQueueBase((creds.baseUrl || 'https://fal.run').replace(/\/$/, ''));
  const endpoint = spec.endpoint ?? o.model;
  const headers = { authorization: `Key ${creds.apiKey}` };
  const aspect = o.aspect ?? spec.aspect ?? (kind === 'video' ? '16:9' : '1:1');

  if (kind === 'image') {
    const input = { prompt: o.prompt };
    if (spec.usesAspectRatio) input.aspect_ratio = aspect;
    else input.image_size = FAL_IMAGE_SIZES[aspect] ?? 'square_hd';
    if (o.image) input.image_url = toDataUrl(o.image);

    return runQueue({
      submitUrl: `${queueBase}/${endpoint}`, headers, body: input, provider: 'fal',
      statusUrl: `${queueBase}/requests/{id}/status?logs=0`,
      resultUrl: `${queueBase}/requests/{id}`,
      pickUrl: (p) => p?.images?.[0]?.url ?? p?.image?.url,
      onProgress: o.onProgress, maxMs: 5 * 60 * 1000,
    });
  }

  if (kind === 'video') {
    const input = { prompt: o.prompt, aspect_ratio: aspect, duration: String(o.duration ?? spec.duration ?? 5) };
    if (o.image) input.image_url = toDataUrl(o.image);

    return runQueue({
      submitUrl: `${queueBase}/${endpoint}`, headers, body: input, provider: 'fal',
      statusUrl: `${queueBase}/requests/{id}/status?logs=0`,
      resultUrl: `${queueBase}/requests/{id}`,
      pickUrl: (p) => p?.video?.url ?? p?.videos?.[0]?.url,
      onProgress: o.onProgress, maxMs: 15 * 60 * 1000,
    });
  }

  throw new Error(`fal 不支持 kind="${kind}"`);
}

/* ── 火山引擎 Ark ──────────────────────────────────────────────── */
async function ark(spec, kind, o, creds) {
  const base = (creds.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');

  if (kind === 'image' && spec.openaiCompatible) {
    // 火山的图片接口是 OpenAI 兼容载荷
    return runOpenAI({
      baseUrl: base, apiKey: creds.apiKey, endpoint: 'image',
      model: spec.model, provider: 'ark',
      body: {
        model: spec.model,
        prompt: o.prompt,
        ...(o.aspect ? { size: arkSize(o.aspect) } : {}),
        response_format: 'url',
        ...(o.image ? { image: toDataUrl(o.image) } : {}),
      },
    });
  }

  if (kind === 'video' && spec.arkTask) {
    if (!spec.model) {
      throw new Error(
        '火山视频需要指定接入点 id（形如 ep-xxxxxxxx）。' +
        '设 ARK_VIDEO_MODEL=ep-xxxx，或直接用 `model="ark/seedance"` 配合该环境变量。',
      );
    }
    // Ark 的视频 prompt 支持内联 --ratio/--duration 标志
    const flags = [o.aspect ? `--ratio ${o.aspect}` : '', o.duration ? `--duration ${o.duration}` : '']
      .filter(Boolean).join(' ');
    return runQueue({
      submitUrl: `${base}/contents/generations/tasks`,
      statusUrl: `${base}/contents/generations/tasks/{id}`,
      resultUrl: `${base}/contents/generations/tasks/{id}`,
      resultInStatus: true,
      headers: { authorization: `Bearer ${creds.apiKey}` },
      body: {
        model: spec.model,
        content: [{ type: 'text', text: flags ? `${o.prompt} ${flags}` : o.prompt }],
        ...(o.image ? { content: [
          { type: 'text', text: flags ? `${o.prompt} ${flags}` : o.prompt },
          { type: 'image_url', image_url: { url: toDataUrl(o.image) } },
        ] } : {}),
      },
      pickUrl: (p) => p?.content?.video_url ?? p?.video_url,
      onProgress: o.onProgress, maxMs: 15 * 60 * 1000,
    });
  }

  throw new Error(`火山引擎不支持 kind="${kind}"${spec.arkTask ? '' : '（该模型未声明任务式）'}`);
}

function arkSize(aspect) {
  return { '1:1': '1024x1024', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1024x768', '3:4': '768x1024' }[aspect] ?? '1024x1024';
}

/* ── OpenAI 及兼容端点 ─────────────────────────────────────────── */
async function openai(spec, kind, o, creds) {
  if (kind === 'image') {
    return runOpenAI({
      baseUrl: creds.baseUrl, apiKey: creds.apiKey, endpoint: 'image', model: spec.model, provider: 'openai',
      body: { model: spec.model, prompt: o.prompt, n: 1, ...(o.aspect ? { size: openaiSize(o.aspect) } : {}) },
    });
  }
  if (kind === 'speech') {
    const r = await runOpenAI({
      baseUrl: creds.baseUrl, apiKey: creds.apiKey, endpoint: 'speech', model: spec.model ?? 'tts-1', provider: 'openai',
      body: {
        model: spec.model ?? 'tts-1',
        input: o.prompt,
        voice: o.voice ?? 'alloy',
        response_format: 'mp3',
      },
    });
    return { ...r, ext: 'mp3' };
  }
  throw new Error(`OpenAI 兼容端点不支持 kind="${kind}"（支持 image / speech）`);
}

function openaiSize(aspect) {
  return { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' }[aspect] ?? '1024x1024';
}

/** 本地图片 → data URL（fal / ark 都接受 inline） */
function toDataUrl(file) {
  const ext = path.extname(file).toLowerCase().replace('.', '');
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext];
  if (!mime) throw new Error(`不支持的输入图格式：${file}`);
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

export { MediaError };

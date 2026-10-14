/**
 * 精选模型表 —— 把 `provider/model` 映射到「协议 + 端点 + 默认值」。
 *
 * 刻意只收常用的一小批：OpenDesign 有 25 家 provider / 40+ 模型（3,978 行
 * 适配代码），但真正高频的就那几家。表里没有的模型也能用 —— 直接在
 * `media_generate` 里传完整端点即可（见 README 的「自定义端点」）。
 *
 * fal 的 endpoint slug 逐字取自 OpenDesign 的 FAL_ENDPOINTS 表，不是我猜的。
 */
export const MODELS = {
  /* ── fal.ai · 视频（队列协议） ───────────────────────────────── */
  'fal/kling-2.1':      { family: 'fal', kind: 'video', endpoint: 'fal-ai/kling-video/v2.1/master/text-to-video', aspect: '16:9', duration: 5 },
  'fal/seedance-1-pro': { family: 'fal', kind: 'video', endpoint: 'fal-ai/bytedance/seedance-1-pro', aspect: '16:9', duration: 5 },
  'fal/veo-3':          { family: 'fal', kind: 'video', endpoint: 'fal-ai/veo3', aspect: '16:9', duration: 8 },
  'fal/veo-2':          { family: 'fal', kind: 'video', endpoint: 'fal-ai/veo2', aspect: '16:9', duration: 5 },
  'fal/wan-2.1-t2v':    { family: 'fal', kind: 'video', endpoint: 'fal-ai/wan-t2v', aspect: '16:9', duration: 5 },
  'fal/sora-2':         { family: 'fal', kind: 'video', endpoint: 'fal-ai/sora', aspect: '16:9', duration: 8 },

  /* ── fal.ai · 图片 ───────────────────────────────────────────── */
  'fal/flux-schnell':   { family: 'fal', kind: 'image', endpoint: 'fal-ai/flux/schnell', aspect: '1:1' },
  'fal/flux-dev':       { family: 'fal', kind: 'image', endpoint: 'fal-ai/flux/dev', aspect: '1:1' },
  'fal/flux-pro-ultra': { family: 'fal', kind: 'image', endpoint: 'fal-ai/flux-pro/v1.1-ultra', aspect: '16:9', usesAspectRatio: true },
  'fal/ideogram-v3':    { family: 'fal', kind: 'image', endpoint: 'fal-ai/ideogram/v3', aspect: '1:1' },
  'fal/recraft-v3':     { family: 'fal', kind: 'image', endpoint: 'fal-ai/recraft-v3', aspect: '1:1' },

  /* ── 火山引擎 Ark ────────────────────────────────────────────── */
  // 图片走 OpenAI 兼容载荷；视频是任务式
  'ark/seedream-3.0':   { family: 'ark', kind: 'image', model: 'doubao-seedream-3-0-t2i-250415', openaiCompatible: true, aspect: '1:1' },
  'ark/seededit-3.0':   { family: 'ark', kind: 'image', model: 'doubao-seededit-3-0-i2i-250628', openaiCompatible: true },
  // 视频模型 id 通常是你自己创建的接入点（ep-xxxx），用 ARK_VIDEO_MODEL 指定
  'ark/seedance':       { family: 'ark', kind: 'video', model: process.env.ARK_VIDEO_MODEL || '', arkTask: true, aspect: '16:9', duration: 5 },

  /* ── OpenAI 及兼容端点 ───────────────────────────────────────── */
  'openai/gpt-image-1': { family: 'openai', kind: 'image', model: 'gpt-image-1', aspect: '1:1' },
  'openai/dall-e-3':    { family: 'openai', kind: 'image', model: 'dall-e-3', aspect: '1:1' },
  'openai/tts':         { family: 'openai', kind: 'speech', model: 'tts-1' },
};

export function resolveModel(id) {
  const spec = MODELS[id];
  if (spec) return { id, ...spec };
  // 允许直接传完整端点：`fal-ai/xxx`（fal 队列）或 `openai:model`（兼容端点）
  if (id.startsWith('fal-ai/')) return { id, family: 'fal', kind: 'image', endpoint: id };
  if (id.startsWith('openai:')) return { id, family: 'openai', kind: 'image', model: id.slice(7) };
  return null;
}

export function listModels() {
  const by = { image: [], video: [], speech: [] };
  for (const [id, spec] of Object.entries(MODELS)) {
    if (spec.model === '') continue;         // 需要外部配置的（如 Ark 视频接入点）
    (by[spec.kind] ??= []).push(id);
  }
  return by;
}

/** fal 的名称式尺寸 vs 宽高比式尺寸 */
export const FAL_IMAGE_SIZES = {
  '1:1': 'square_hd', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9',
  '4:3': 'landscape_4_3', '3:4': 'portrait_4_3',
};

/**
 * 协议适配层 —— 按「协议」而不是按「厂商」实现
 *
 * OpenDesign 的 media 管道按厂商写了 29 个 renderer（3,978 行），因为每家
 * 的 submit/poll/download 细节都不同。但拆开看只有两种协议：
 *
 *   1. `openai`  —— POST /images/generations · POST /audio/speech
 *                   覆盖 OpenAI、Azure，以及任何 OpenAI 兼容端点
 *                   （火山的图片接口也是这个载荷）
 *
 *   2. `queue`   —— POST 提交 → 拿 request id → 轮询状态 → 取结果 URL → 下载
 *                   覆盖 fal.ai（kling/seedance/veo/wan/flux…）与火山视频
 *
 * 所以这里只需两个适配器，加一个模型表把 model id 映射到「协议 + 路径 + 默认值」。
 */
import { setTimeout as sleep } from 'node:timers/promises';

export class MediaError extends Error {
  constructor(message, { provider, status, body } = {}) {
    super(message);
    this.name = 'MediaError';
    if (provider) this.provider = provider;
    if (status) this.status = status;
    if (body) this.body = typeof body === 'string' ? body.slice(0, 400) : body;
  }
}

const truncate = (s, n = 300) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…` : s) : String(s));

async function readJson(resp, provider) {
  const text = await resp.text();
  if (!resp.ok) {
    throw new MediaError(`${provider} HTTP ${resp.status}: ${truncate(text)}`, { provider, status: resp.status, body: text });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MediaError(`${provider} 返回的不是 JSON: ${truncate(text)}`, { provider, body: text });
  }
}

async function download(url, provider) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!resp.ok) throw new MediaError(`${provider} 结果下载失败 HTTP ${resp.status}`, { provider, status: resp.status });
  return Buffer.from(await resp.arrayBuffer());
}

/* ── 协议 1：OpenAI 兼容 ───────────────────────────────────────── */
/**
 * @param {object} o
 * @param {string} o.baseUrl      如 https://api.openai.com/v1
 * @param {string} o.apiKey
 * @param {'image'|'speech'} o.endpoint
 * @param {string} o.model
 * @param {object} o.body         已组装好的请求体
 */
export async function runOpenAI({ baseUrl, apiKey, endpoint, model, body, provider = 'openai' }) {
  const base = baseUrl.replace(/\/$/, '');
  const url = endpoint === 'speech' ? `${base}/audio/speech` : `${base}/images/generations`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (endpoint === 'speech') {
    // 语音端点直接返回音频字节流
    if (!resp.ok) {
      throw new MediaError(`${provider} speech HTTP ${resp.status}: ${truncate(await resp.text())}`, { provider, status: resp.status });
    }
    return { bytes: Buffer.from(await resp.arrayBuffer()), ext: 'mp3', raw: null };
  }

  const data = await readJson(resp, provider);
  const entry = Array.isArray(data?.data) ? data.data[0] : null;
  if (!entry) throw new MediaError(`${provider} 响应缺少 data[0]`, { provider, body: JSON.stringify(data) });

  if (entry.b64_json) {
    return { bytes: Buffer.from(entry.b64_json, 'base64'), ext: 'png', raw: data };
  }
  if (entry.url) {
    return { bytes: await download(entry.url, provider), ext: 'png', raw: data };
  }
  throw new MediaError(`${provider} 响应里既没有 b64_json 也没有 url`, { provider, body: JSON.stringify(entry) });
}

/* ── 协议 2：队列式（submit → poll → result）───────────────────── */
/**
 * @param {object} o
 * @param {string} o.submitUrl
 * @param {string} o.statusUrl   模板，`{id}` 会被替换
 * @param {string} o.resultUrl   模板，`{id}` 会被替换
 * @param {object} o.headers
 * @param {object} o.body
 * @param {(s:string)=>void} [o.onProgress]
 * @param {(payload:any)=>string} o.pickUrl  从结果里取出媒体 URL
 * @param {number} [o.maxMs]
 */
export async function runQueue({
  submitUrl, statusUrl, resultUrl, headers, body,
  pickUrl, onProgress, maxMs = 10 * 60 * 1000, pollMs = 3000, provider = 'queue',
  resultInStatus = false,
}) {
  const submitResp = await fetch(submitUrl, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const submit = await readJson(submitResp, provider);

  // fal 返回 { request_id, status_url, response_url }；火山返回 { id }
  const id = submit.request_id ?? submit.id ?? submit.task_id;
  if (!id) throw new MediaError(`${provider} 提交响应里没有 request/task id`, { provider, body: JSON.stringify(submit) });

  const sUrl = submit.status_url ?? statusUrl.replace('{id}', encodeURIComponent(id));
  const rUrl = submit.response_url ?? resultUrl.replace('{id}', encodeURIComponent(id));

  const started = Date.now();
  let last = '';
  for (;;) {
    if (Date.now() - started > maxMs) {
      throw new MediaError(`${provider} 超时（最后状态：${last || 'unknown'}）`, { provider });
    }
    await sleep(pollMs);

    const sResp = await fetch(sUrl, { headers, signal: AbortSignal.timeout(30_000) });
    const s = await readJson(sResp, provider);
    const status = String(s.status ?? '').toUpperCase();

    if (status !== last) { onProgress?.(status); last = status; }

    if (status === 'FAILED' || status === 'ERROR') {
      throw new MediaError(`${provider} 生成失败：${truncate(JSON.stringify(s.error ?? s))}`, { provider, body: JSON.stringify(s) });
    }
    if (status === 'COMPLETED' || status === 'SUCCEEDED' || status === 'SUCCESS') {
      // fal：状态只报进度，结果要单独取 response_url
      // 火山：结果就带在状态响应体里（content.video_url），没有独立 URL
      const payload = resultInStatus
        ? s
        : await readJson(await fetch(rUrl, { headers, signal: AbortSignal.timeout(30_000) }), provider);
      const url = pickUrl(payload);
      if (!url) throw new MediaError(`${provider} 完成但取不到媒体 URL：${truncate(JSON.stringify(payload))}`, { provider, body: JSON.stringify(payload) });
      return { bytes: await download(url, provider), url, raw: payload };
    }
    // IN_QUEUE / IN_PROGRESS / RUNNING / PENDING → 继续轮询
  }
}

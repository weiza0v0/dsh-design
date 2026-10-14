/**
 * dsh-media-gen 协议适配层回归测试
 *
 * ## 铁律：**一个真实请求都不发**
 *
 * 这些适配器打的是**付费**接口（fal / 火山 / OpenAI）。所以测试把
 * `globalThis.fetch` 换成桩，任何没被显式 mock 的请求直接抛错 ——
 * 既不会误花钱，也保证「测试跑绿」等于「所有出网路径都被覆盖到了」。
 *
 * ## 覆盖什么
 *
 *   · 模型表：已知 id / 自定义端点 / 未知 id / 需外部配置的 Ark 视频
 *   · 凭据解析：环境变量 → 配置文件 → 缺 key 的报错文案（要指出配置路径）
 *   · 协议 1（OpenAI 兼容）：b64_json / url 下载 / 缺 data[0] / HTTP 错误 / speech 字节流
 *   · 协议 2（队列）：submit → 轮询 → 取结果 → 下载；
 *     `resultInStatus`（火山把结果放在状态体里）；失败态；超时；缺 task id
 *   · 端到端：generate() 落盘 + 文件名推导
 *
 * 运行：cd <本包> && npm test
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ── 环境必须在 import 之前定好 ──────────────────────────────────────
 * `lib/config.js` 在**模块加载时**就解析配置路径（读 DECK_LIBS_MEDIA_CONFIG /
 * DSH_HOME），`lib/models.js` 同理读 ARK_VIDEO_MODEL。所以先设环境、再动态
 * import，否则测的是上一位使用者留下的状态。
 */
const tmp = mkdtempSync(path.join(os.tmpdir(), 'media-gen-test-'));
const CFG = path.join(tmp, 'media-gen.json');
process.env.DECK_LIBS_MEDIA_CONFIG = CFG;
for (const k of ['FAL_KEY', 'FAL_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY',
  'FAL_BASE_URL', 'ARK_BASE_URL', 'OPENAI_BASE_URL', 'ARK_VIDEO_MODEL']) {
  delete process.env[k];
}

const { runOpenAI, runQueue, MediaError } = await import('../lib/providers.js');
const { resolveModel, listModels, FAL_IMAGE_SIZES } = await import('../lib/models.js');
const { resolveCredentials, configPath } = await import('../lib/config.js');
const { generate, autoName } = await import('../lib/generate.js');

let passed = 0;
let failed = 0;
const check = (ok, label, detail) => {
  if (ok) { passed += 1; console.log(`  ✅ ${label}`); }
  else { failed += 1; console.log(`  ❌ ${label}`); if (detail !== undefined) console.log(`     ${detail}`); }
};
const group = (t) => console.log(`\n▶︎ ${t}`);

/* ── fetch 桩 ─────────────────────────────────────────────────────── */
const realFetch = globalThis.fetch;
let seen = [];

/** @param {Array<[string, (url:string, init:object)=>Response]>} routes */
function stubFetch(routes) {
  seen = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const key = `${method} ${url}`;
    seen.push(key);
    for (const [re, handler] of routes) {
      if (new RegExp(re).test(key)) return handler(String(url), init);
    }
    throw new Error(`测试发出了未 mock 的请求：${key}`);
  };
}
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const bytes = (buf) => new Response(buf, { status: 200 });

/* ═══ 1 · 模型表 ═══════════════════════════════════════════════════ */
group('模型表');
check(resolveModel('fal/flux-schnell')?.family === 'fal', '已知 id → 解出 family');
check(resolveModel('openai/tts')?.kind === 'speech', 'openai/tts 是 speech');
check(resolveModel('fal-ai/whatever/x')?.family === 'fal', '自定义端点 fal-ai/… → 走 fal 队列');
check(resolveModel('openai:my-model')?.model === 'my-model', '自定义端点 openai:<model> 解出模型名');
check(resolveModel('nope/nope') === null, '未知 id → null（让上层报错，而不是猜）');

const listed = listModels();
check(Array.isArray(listed.image) && listed.image.length > 0, `image 有 ${listed.image.length} 个`);
check(Array.isArray(listed.video) && listed.video.length > 0, `video 有 ${listed.video.length} 个`);
check(listed.speech.length === 1, 'speech 有 1 个（openai/tts）');
check(!listed.video.includes('ark/seedance'),
  'ARK_VIDEO_MODEL 未设时 ark/seedance 不列出来（它需要 ep-xxxx 接入点）');
check(FAL_IMAGE_SIZES['16:9'] === 'landscape_16_9', 'fal 尺寸映射 16:9');

/* ═══ 2 · 凭据解析 ═════════════════════════════════════════════════ */
group('凭据解析（环境变量 → 配置文件）');
check(configPath() === CFG, '配置路径取自 DECK_LIBS_MEDIA_CONFIG');
check(resolveCredentials('fal', {}).apiKey === undefined, '什么都没有时 apiKey 为 undefined');
process.env.FAL_KEY = 'env-key';
check(resolveCredentials('fal', {}).apiKey === 'env-key', '环境变量优先');
check(resolveCredentials('fal', { providers: { fal: { apiKey: 'file-key' } } }).apiKey === 'env-key',
  '环境变量压过配置文件');
delete process.env.FAL_KEY;
check(resolveCredentials('fal', { providers: { fal: { apiKey: 'file-key' } } }).apiKey === 'file-key',
  '没有环境变量时用配置文件');
check(resolveCredentials('openai', {}).baseUrl === 'https://api.openai.com/v1', 'openai 默认端点');
check(resolveCredentials('ark', {}).baseUrl.includes('volces.com'), 'ark 默认端点');
let threw = null;
try { resolveCredentials('nope', {}); } catch (e) { threw = e; }
check(/未知的协议族/.test(threw?.message ?? ''), '未知协议族立刻抛');

/* ═══ 3 · 协议 1：OpenAI 兼容 ══════════════════════════════════════ */
group('协议 1 · OpenAI 兼容');
stubFetch([['POST .*/images/generations', () => json({ data: [{ b64_json: Buffer.from('IMG').toString('base64') }] })]]);
let r = await runOpenAI({ baseUrl: 'https://x/v1', apiKey: 'k', endpoint: 'image', model: 'm', body: { model: 'm' } });
check(r.bytes.toString() === 'IMG', 'b64_json → 解出字节');
check(r.ext === 'png', 'ext = png');
check(seen[0]?.includes('/images/generations'), '打的是 /images/generations', seen[0]);
check(seen[0]?.startsWith('POST'), '用 POST');

stubFetch([
  ['POST .*/images/generations', () => json({ data: [{ url: 'https://cdn/x.png' }] })],
  ['GET https://cdn/x.png', () => bytes(Buffer.from('FROMURL'))],
]);
r = await runOpenAI({ baseUrl: 'https://x/v1', apiKey: 'k', endpoint: 'image', model: 'm', body: {} });
check(r.bytes.toString() === 'FROMURL', 'url → 会去下载结果');

stubFetch([['POST .*/images/generations', () => json({ error: 'boom' }, 500)]]);
threw = null;
try { await runOpenAI({ baseUrl: 'https://x/v1', apiKey: 'k', endpoint: 'image', model: 'm', body: {} }); } catch (e) { threw = e; }
check(threw instanceof MediaError && threw.status === 500, 'HTTP 500 → MediaError 带 status');
check(/boom/.test(threw?.message ?? ''), '错误里带上了上游响应体');

stubFetch([['POST .*/images/generations', () => json({})]]);
threw = null;
try { await runOpenAI({ baseUrl: 'https://x/v1', apiKey: 'k', endpoint: 'image', model: 'm', body: {} }); } catch (e) { threw = e; }
check(/缺少 data\[0\]/.test(threw?.message ?? ''), '响应缺 data[0] → 明确报错');

stubFetch([['POST .*/audio/speech', () => bytes(Buffer.from('MP3'))]]);
r = await runOpenAI({ baseUrl: 'https://x/v1', apiKey: 'k', endpoint: 'speech', model: 'tts-1', body: {} });
check(r.bytes.toString() === 'MP3' && r.ext === 'mp3', 'speech 端点直接收字节流 → mp3');

/* ═══ 4 · 协议 2：队列 ═════════════════════════════════════════════ */
group('协议 2 · 队列（submit → poll → download）');
let polls = 0;
stubFetch([
  ['POST https://q/submit', () => json({ request_id: 'req-1' })],
  ['GET https://q/status/req-1', () => {
    polls += 1;
    return json({ status: polls < 2 ? 'IN_QUEUE' : 'COMPLETED' });
  }],
  ['GET https://q/result/req-1', () => json({ images: [{ url: 'https://cdn/out.png' }] })],
  ['GET https://cdn/out.png', () => bytes(Buffer.from('QUEUED'))],
]);
const progress = [];
r = await runQueue({
  submitUrl: 'https://q/submit', statusUrl: 'https://q/status/{id}', resultUrl: 'https://q/result/{id}',
  headers: { authorization: 'Key k' }, body: { prompt: 'x' },
  pickUrl: (p) => p?.images?.[0]?.url, pollMs: 1, onProgress: (s) => progress.push(s),
});
check(r.bytes.toString() === 'QUEUED', '轮询到 COMPLETED 后取回结果');
check(polls === 2, '确实轮询了两次（IN_QUEUE → COMPLETED）', `实际 ${polls}`);
check(progress.join(',') === 'IN_QUEUE,COMPLETED', 'onProgress 收到状态变化', progress.join(','));

stubFetch([
  ['POST https://q/submit', () => json({ id: 't-9' })],
  ['GET https://q/status/t-9', () => json({ status: 'SUCCEEDED', content: { video_url: 'https://cdn/v.mp4' } })],
  ['GET https://cdn/v.mp4', () => bytes(Buffer.from('VIDEO'))],
]);
r = await runQueue({
  submitUrl: 'https://q/submit', statusUrl: 'https://q/status/{id}', resultUrl: 'https://q/result/{id}',
  headers: {}, body: {}, pickUrl: (p) => p?.content?.video_url,
  pollMs: 1, resultInStatus: true,
});
check(r.bytes.toString() === 'VIDEO', 'resultInStatus：结果就在状态体里（火山的行为）');

stubFetch([
  ['POST https://q/submit', () => json({ request_id: 'req-2' })],
  ['GET https://q/status/req-2', () => json({ status: 'FAILED', error: 'nsfw' })],
]);
threw = null;
try {
  await runQueue({ submitUrl: 'https://q/submit', statusUrl: 'https://q/status/{id}', resultUrl: 'https://q/result/{id}', headers: {}, body: {}, pickUrl: () => null, pollMs: 1 });
} catch (e) { threw = e; }
check(/生成失败/.test(threw?.message ?? '') && /nsfw/.test(threw?.message ?? ''), 'FAILED → 报错并带上上游原因');

stubFetch([['POST https://q/submit', () => json({ nope: 1 })]]);
threw = null;
try {
  await runQueue({ submitUrl: 'https://q/submit', statusUrl: 'https://q/status/{id}', resultUrl: 'https://q/result/{id}', headers: {}, body: {}, pickUrl: () => null, pollMs: 1 });
} catch (e) { threw = e; }
check(/没有 request\/task id/.test(threw?.message ?? ''), '提交响应没有 id → 明确报错');

stubFetch([
  ['POST https://q/submit', () => json({ request_id: 'req-3' })],
  ['GET https://q/status/req-3', () => json({ status: 'IN_PROGRESS' })],
]);
threw = null;
try {
  await runQueue({ submitUrl: 'https://q/submit', statusUrl: 'https://q/status/{id}', resultUrl: 'https://q/result/{id}', headers: {}, body: {}, pickUrl: () => null, pollMs: 1, maxMs: 20 });
} catch (e) { threw = e; }
check(/超时/.test(threw?.message ?? ''), '一直 IN_PROGRESS → 到 maxMs 抛超时（不会转圈到天荒地老）');

/* ═══ 5 · 端到端 generate() ════════════════════════════════════════ */
group('端到端 generate()');
threw = null;
try { await generate({ model: 'openai/gpt-image-1', prompt: 'x' }); } catch (e) { threw = e; }
check(/缺少 API key/.test(threw?.message ?? ''), '没 key 时明确拒绝');
check(threw?.message.includes(CFG), '报错里给出**真实**配置路径（曾经这里写的是占位符字符串）', threw?.message);

threw = null;
try { await generate({ model: 'nope/nope', prompt: 'x' }); } catch (e) { threw = e; }
check(/未知模型/.test(threw?.message ?? ''), '未知模型 → 提示用 media_models 查');

process.env.OPENAI_API_KEY = 'test-key';
stubFetch([['POST .*/images/generations', () => json({ data: [{ b64_json: Buffer.from('PNGDATA').toString('base64') }] })]]);
const outDir = path.join(tmp, 'out');
const res = await generate({ model: 'openai/gpt-image-1', prompt: '一只橘猫 坐在窗台', out: outDir + path.sep });
check(existsSync(res.path), `文件真的落盘了：${path.basename(res.path)}`);
check(readFileSync(res.path).toString() === 'PNGDATA', '落盘内容与响应一致');
check(res.kind === 'image' && res.family === 'openai', '返回值带 kind / family');
check(res.path.startsWith(outDir), '给目录时写进该目录');

stubFetch([['POST .*/audio/speech', () => bytes(Buffer.from('AUDIO'))]]);
const sp = await generate({ model: 'openai/tts', prompt: '念这句话', out: path.join(tmp, 'voice.mp3'), voice: 'alloy' });
check(readFileSync(sp.path).toString() === 'AUDIO', 'TTS 落盘为 mp3');
delete process.env.OPENAI_API_KEY;

group('文件名校验');
check(autoName('openai/tts', 'Hello World / 测试!', 'mp3') === 'Hello-World-测试.mp3',
  'autoName 去掉非法字符、保留中英数', autoName('openai/tts', 'Hello World / 测试!', 'mp3'));
check(autoName('openai/tts', '', 'mp3') === 'openai-tts.mp3',
  'prompt 为空 → 退回模型 id（斜杠换连字符，不产出 openaitts 这种名字）',
  autoName('openai/tts', '', 'mp3'));
check(autoName('m', '///', 'png') === 'output.png',
  'prompt 全是非法字符 → 兜底 output', autoName('m', '///', 'png'));
check(autoName('m', 'a'.repeat(200), 'png').length <= 52,
  '超长 prompt 被截断（文件名有长度上限）', autoName('m', 'a'.repeat(200), 'png').length);

/* ── 收尾 ─────────────────────────────────────────────────────────── */
globalThis.fetch = realFetch;

console.log(`\n${failed === 0 ? '✅ 全部通过' : '❌ 有失败'}：${passed} passed, ${failed} failed`);
console.log('（全程零真实请求：未 mock 的出网调用会直接让测试失败）');
process.exit(failed === 0 ? 0 : 1);

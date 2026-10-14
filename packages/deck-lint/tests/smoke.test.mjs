/**
 * 冒烟测试：验证插件能注册成工具、工具能端到端跑通。
 *
 * 与 lint.test.mjs 的分工：
 *   - lint.test.mjs  验「规则判定是否与上游等价」（纯函数，无宿主依赖）
 *   - smoke.test.mjs 验「插件外壳是否接得上宿主」（需要 peer: @deepseek-ai/dsh-tools）
 *
 * peer 不可解析时整体跳过 —— 这样在没有 DSH 的环境里 `node --test tests/`
 * 依然全绿，不会因为缺依赖而假红。
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginEntry = path.join(here, '..', 'index.js');

let plugin = null;
let skipReason = '';

try {
  plugin = await import(pluginEntry);
} catch (error) {
  skipReason = `peer 不可解析，跳过外壳测试：${error.message.slice(0, 120)}`;
}

/** 用假 ctx 捕获插件注册的工具 */
function captureTool() {
  let tool = null;
  plugin.apply(
    { effect: (fn) => fn(), tools: { register: (t) => { tool = t; return () => {}; } } },
    {},
  );
  assert.ok(tool, 'apply() 应当注册一个工具');
  return tool;
}

describe('dsh-deck-lint plugin shell', { skip: skipReason || false }, () => {
  let tool;

  before(() => {
    tool = captureTool();
  });

  it('exports the name that cordis.patch.yml binds', () => {
    assert.strictEqual(plugin.name, 'dsh-deck-lint');
  });

  it('declares the tools service dependency', () => {
    assert.deepStrictEqual(plugin.inject, ['tools']);
  });

  it('registers a tool named deck_lint with both parameters', () => {
    assert.strictEqual(tool.name, 'deck_lint');
    assert.deepStrictEqual(
      Object.keys(tool.parameters.properties ?? {}).sort(),
      ['html', 'path'],
    );
  });

  it('flags a deliberately sloppy artifact as blocking', async () => {
    const value = await tool.execute(
      {
        html: '<style>.cta{background:#6366f1;}</style><h2>✨ Features</h2><button class="cta">Go</button>',
      },
      {},
    );
    assert.strictEqual(value.verdict, 'block');
    assert.ok(value.counts.P0 >= 2, `expected >=2 P0, got ${value.counts.P0}`);

    const ids = value.findings.map((f) => f.id);
    assert.ok(ids.includes('ai-default-indigo'), 'should catch indigo');
    assert.ok(ids.includes('emoji-icon'), 'should catch emoji icon');
  });

  it('passes a clean artifact', async () => {
    const value = await tool.execute(
      {
        html: '<style>:root{--accent:#b3431b}.t{color:var(--accent)}</style><h1 class="t">Title</h1>',
      },
      {},
    );
    assert.strictEqual(value.verdict, 'pass');
    assert.deepStrictEqual(value.counts, { P0: 0, P1: 0, P2: 0 });
  });

  it('drops the OpenDesign-specific "re-emit an <artifact>" instruction', async () => {
    const value = await tool.execute({ html: '<div style="background:#6366f1">x</div>' }, {});
    const text = tool.output.render({}, value)[0].text;
    assert.ok(!text.includes('Re-emit a corrected'), 'OpenDesign wording must not leak through');
    assert.ok(text.includes('<artifact-lint>'), 'the findings block itself should survive');
  });

  it('rejects zero or two targets', async () => {
    await assert.rejects(() => tool.execute({}, {}), /exactly one/i);
    await assert.rejects(() => tool.execute({ path: 'a', html: 'b' }, {}), /exactly one/i);
  });

  it('reports a clear error for a missing file', async () => {
    await assert.rejects(
      () => tool.execute({ path: '/nonexistent/nope.html' }, {}),
      /not found/i,
    );
  });
});

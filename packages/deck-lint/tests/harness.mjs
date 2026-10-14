/**
 * 测试 harness —— 用 node:test 承接上游的 vitest 用法，零依赖。
 *
 * 上游测试文件（1224 行 / 94 用例）只用到这些接口，已逐一核实：
 *   - `describe` / `it`          → node:test 原生
 *   - `it.each(rows)(title, fn)` → node:test 没有，这里补 8 行
 *   - `toBe`     ×8              → Object.is 语义（vitest 如此）
 *   - `toBeDefined`  ×45
 *   - `toBeUndefined` ×44
 *
 * 目标：测试正文可以一字不改地跑起来，从而让「移植是否等价」这件事
 * 由上游自己的用例来回答，而不是由我的判断来回答。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/* ── expect 垫片 ────────────────────────────────────────────── */

function format(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function expect(actual) {
  return {
    /** Object.is 语义，与 vitest 一致（NaN 相等、+0/-0 不等） */
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        assert.fail(`expected ${format(expected)} but got ${format(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        assert.fail('expected value to be defined, but got undefined');
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        assert.fail(`expected undefined but got ${format(actual)}`);
      }
    },
  };
}

/* ── it.each ───────────────────────────────────────────────── */

/** vitest 的 %s/%d/%i/%f/%j/%o 占位符消耗一行数据的前若干项用于拼标题 */
function substitute(title, row) {
  let cursor = 0;
  return String(title).replace(/%(?:[sdifjo]|%)/g, (match) => {
    if (match === '%%') return '%';
    if (cursor >= row.length) return match;
    const value = row[cursor++];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

/** 与 vitest 一致：标题用占位符，回调收到整行 */
it.each = (rows) => (title, fn) => {
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : [row];
    it(substitute(title, cells), () => fn(...cells));
  }
};

export { describe, it };

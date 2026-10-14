import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// mock 一个最小的客户端环境
const registered = { slot: null, component: null, localeNs: null, dicts: null };
const React = {
  createElement: (...a) => ({ __el: a[0], props: a[1] }),
  useState: (v) => [v, () => {}],
  useRef: (v) => ({ current: v }),
  useEffect: () => {},
};
const requireMap = {
  'react': React,
  'react/jsx-runtime': { jsx: () => {}, jsxs: () => {} },
};

let loaded = null;
const sandbox = {
  window: {
    __ModuleLoader__: { load: (m) => { loaded = m; } },
  },
  console,
};
vm.createContext(sandbox);
const here = path.dirname(fileURLToPath(import.meta.url));
vm.runInContext(readFileSync(path.join(here, '..', 'client.js'), 'utf8'), sandbox);

console.log('═══ 模块是否注册进 __ModuleLoader__ ═══');
loaded ? console.log('  ✅ id =', loaded.id) : (console.log('  ❌ 没注册'), process.exit(1));
console.log('  factory 类型:', typeof loaded.factory);

const mod = loaded.factory((name) => {
  if (name in requireMap) return requireMap[name];
  throw new Error('unexpected require: ' + name);
});
console.log('\n═══ 模块导出 ═══');
console.log('  apply:', typeof mod.apply, '| inject:', JSON.stringify(mod.inject));

const ctx = {
  effect: (fn, label) => { fn(); return () => {}; },
  locale: { register: (ns, d) => { registered.localeNs = ns; registered.dicts = d; }, bind: () => (k) => k },
  slots: {
    inject: (name, fn) => { fn(); },
    register: (decl, comp) => { registered.slot = decl; registered.component = comp; },
  },
  remote: { commands: { execute: async () => ({ ok: true, value: 'ok' }) } },
  sessions: {},
};
mod.apply(ctx);

console.log('\n═══ 注册结果 ═══');
registered.slot ? console.log('  ✅ slot =', registered.slot.name) : console.log('  ❌ slot 未注册');
registered.slot?.locale ? console.log('  ✅ locale ns =', registered.slot.locale) : 0;
// list 槽必须带 id —— 漏了会在浏览器抛 "list slot … requires options.id"
registered.slot?.id ? console.log('  ✅ id =', registered.slot.id, '（list 槽必填）') : console.log('  ❌ 缺 id —— 浏览器会抛 requires options.id');
registered.component ? console.log('  ✅ 组件 =', registered.component.name) : console.log('  ❌ 组件缺失');
const d = registered.dicts?.zh ?? {};
console.log('  ✅ 中文字典:', Object.keys(d).length, '条 —', JSON.stringify(d['chip.label']));
console.log('  ✅ 英文字典:', Object.keys(registered.dicts?.en ?? {}).length, '条');

console.log('\n═══ 组件行为（激活/未激活）═══');
const C = registered.component;
const inact = C({ useProjection: () => ({ active: false }), t: (k) => k });
inact === null ? console.log('  ✅ 未激活 → 返回 null（对齐 PlanChip，不占位）') : console.log('  ❌ 未激活却渲染了');
const off = C({ useProjection: () => undefined, t: (k) => k });
off === null ? console.log('  ✅ 投影未到 → 返回 null') : console.log('  ❌ 投影未到却渲染');
const on = C({ useProjection: () => ({ active: true }), locked: false, exitDesign: async () => null, t: (k) => k });
on && on.__el === 'span' ? console.log('  ✅ 激活 → 渲染 span（chip 容器）') : console.log('  ❌ 激活后没渲染', on);

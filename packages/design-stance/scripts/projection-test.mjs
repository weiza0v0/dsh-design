import * as m from '../index.js';
const def = m.internals.projectionDefinition;
let s = def.init();
const run = (e) => { s = def.apply(s, e); return s.active; };
const assert = (c, msg) => console.log((c ? '  ✅ ' : '  ❌ ') + msg);

assert(s.active === false, 'init → active=false');
run({ type: 'command/run', data: { name: 'design', args: '', commandId: 'c1' } });
assert(s.running?.wanted === true, '/design → running.wanted=true');
run({ type: 'command/done', data: { commandId: 'c1', kind: 'success' } });
assert(s.active === true, 'done → active=true（chip 应出现）');

run({ type: 'command/run', data: { name: 'design', args: ' status', commandId: 'c2' } });
assert(s.running === null, '/design status → 不记状态（跳过）');
run({ type: 'command/done', data: { commandId: 'c2', kind: 'success' } });
assert(s.active === true, 'status 后 active 不变');

run({ type: 'command/run', data: { name: 'design', args: ' off', commandId: 'c3' } });
run({ type: 'command/done', data: { commandId: 'c3', kind: 'success' } });
assert(s.active === false, '/design off → active=false（chip 消失）');

run({ type: 'command/run', data: { name: 'design', args: ' on', commandId: 'c4' } });
run({ type: 'command/done', data: { commandId: 'c4', kind: 'error' } });
assert(s.active === false, '命令失败 → 不改变状态');

run({ type: 'command/run', data: { name: 'plan', args: '', commandId: 'c5' } });
assert(s.running === null, '别人的命令（/plan）→ 不干扰');

run({ type: 'command/run', data: { name: 'design', args: '', commandId: 'c6' } });
run({ type: 'command/done', data: { commandId: 'c6', kind: 'success' } });
assert(s.active === true, '再次穿上');
console.log('  客户端读到的视图:', JSON.stringify(def.wire.view(s)));

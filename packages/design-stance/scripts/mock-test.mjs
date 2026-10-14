import * as m from '../index.js';

const registered = { section: null, projection: null, command: null, tool: null };
const state = new Map();                       // session → { active }
const session = { id: 'sess-1' };   // 纯内存状态，不需要 append

const projState = new Map();
const ctx = {
  sessionProjections: {
    register: (def) => { registered.projection = def; },
    stateOf: (s, key) => (key === registered.projection?.key ? (projState.get(s) ?? registered.projection.init()) : undefined),
  },

  systemPrompt: { section: (s) => { registered.section = s; return () => {}; } },
  inject: (deps, fn) => fn({ commands: { register: (c) => { registered.command = c; return () => {}; } } }),
  tools: { register: (t) => { registered.tool = t; return () => {}; } },
};

m.apply(ctx, {});
let pass = 0, fail = 0;
const ok = (x) => { console.log('  ✅', x); pass++; };
const bad = (x) => { console.log('  ❌', x); fail++; };

console.log('═══ 注册 ═══');
registered.section ? ok(`section "${registered.section.name}" order=${registered.section.order}`) : bad('section 未注册');
registered.command ? ok(`command /${registered.command.name} — ${registered.command.description}`) : bad('command 未注册');
registered.tool ? ok(`tool ${registered.tool.name}`) : bad('tool 未注册');

console.log('\n═══ 段文本随状态变化（核心机制）═══');
// 必须复用**同一个 session 对象** —— 状态 Map 按对象身份索引
// （真实环境里 agent.session 是稳定的，dsh-plan-mode 也是这么做的）
const SESSION_OBJ = session;
const ctxFor = () => ({ agent: { session: SESSION_OBJ } });
const t0 = registered.section.text(ctxFor());
t0 === '' ? ok('未激活 → text() 返回空串（不占 token）') : bad(`未激活却返回了 ${t0.length} 字符`);
registered.command.handler({ agent: { session: session }, rawInput: '' });
const t1 = registered.section.text(ctxFor());
t1.length > 1000 ? ok(`激活后 → text() 返回 ${t1.length} 字符章程`) : bad(`激活后只返回 ${t1.length} 字符`);

console.log('\n═══ 命令 /design status ═══');
const st = registered.command.handler({ agent: { session: session }, rawInput: 'status' });
console.log('     →', st.kind, st.text.slice(0, 46));
st.text.includes('已穿') ? ok('status 报告已穿') : bad('status 没报告已穿');

console.log('\n═══ 命令 /design on（用户实际打的）═══');
registered.command.handler({ agent: { session: session }, rawInput: 'off' });
const onR = registered.command.handler({ agent: { session: session }, rawInput: 'on' });
onR.kind === 'success' ? ok('`/design on` 被接受（之前报「未知参数」）') : bad(`/design on 仍失败: ${onR.text.slice(0,40)}`);
const emptyR = registered.command.handler({ agent: { session: session }, rawInput: 'off' });
registered.command.handler({ agent: { session: session }, rawInput: '' });
emptyR.kind === 'success' ? ok('`/design`（空参数）= on') : bad('空参数失败');

console.log('\n═══ 命令 /design off ═══');
registered.command.handler({ agent: { session: session }, rawInput: 'off' });
const t2 = registered.section.text(ctxFor());
t2 === '' ? ok('卸下后 text() 回到空串') : bad('卸下后仍有 ' + t2.length + ' 字符');

console.log('\n═══ 工具 design_stance ═══');
const v = await registered.tool.execute({ action: 'on' }, { agent: { session: session } });
v.active === true ? ok(`tool on → active=${v.active}, changed=${v.changed}`) : bad('tool on 未生效');
const v2 = await registered.tool.execute({ action: 'on' }, { agent: { session: session } });
v2.changed === false ? ok('重复 on → changed=false（幂等）') : bad('重复 on 却报 changed');
const v3 = await registered.tool.execute({ action: 'status' }, { agent: { session: session } });
v3.active === true ? ok('tool status 读到 true') : bad('tool status 读错');

console.log(`\n═══ ${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail ? 1 : 0);

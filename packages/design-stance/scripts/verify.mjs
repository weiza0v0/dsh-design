#!/usr/bin/env node
/**
 * verify.mjs —— 隔离验证：DSH 提示段能不能在运行时增删
 *
 * 跑法：node scripts/verify.mjs
 *      （需要一个能解析 cordis / @deepseek-ai/* 的 node_modules —— 见下方 ensureDeps）
 *
 * **这个脚本能证明什么、不能证明什么，都要说清楚：**
 *
 *   ✅ 已验证：同作用域不能注册同名段（约束）；section() 返回 disposer；
 *              complete:true 会独占装配（「全清」语义）；disposer 能还原。
 *   ❌ 未验证：跨作用域遮蔽（agent.ctx 那条路）。createScope 造出的子作用域，
 *              它的段层不参与装配 —— 真正的接线在 agent 工厂里由
 *              bindScopeParent/scopeTarget 完成。所以那条结论的依据是
 *              「报错信息指路 + 官方文档 + 三处既有先例」，
 *              **必须在真实会话里跑一次才算数**。
 */
/* ── 依赖：本脚本需要一份本地 DSH 安装提供的三个内部包 ──────────────
 *
 * 它们**不是本仓库的依赖** —— 这是「运行时增删提示段」的隔离实验，
 * 属于理解性验证而非可移植测试。缺了就清楚地跳过，
 * 别用一堆模块解析栈信息糊人。（这三个包 DSH 装好后就在它的 node_modules 里。）
 */
let Context;
let sysprompt;
let createScope;
let scopeOf;
try {
  ({ Context } = await import('cordis'));
  sysprompt = await import('@deepseek-ai/dsh-system-prompt');
  ({ createScope, scopeOf } = await import('@deepseek-ai/dsh-scope'));
} catch (error) {
  console.log('⚠️  跳过 verify.mjs —— 缺少本地 DSH 安装提供的内部包。');
  console.log(`   原因：${String(error.message).split('\n')[0]}`);
  console.log('   需要：cordis · @deepseek-ai/dsh-system-prompt · @deepseek-ai/dsh-scope');
  console.log('   本脚本验证「运行时增删提示段」的 API 行为，不属于 npm test 的可移植部分。');
  console.log('   装了 DSH 的机器上，从 DSH 的 node_modules 解析到它们即可运行。');
  process.exit(0);
}

const DESIGN_TEXT = '你是一个设计工作台。为管理者产出 HTML 设计交付物。';
const ID = 'deployment:persona-prefix';
let pass = 0, fail = 0;
const ok  = (m) => { console.log('  ✅', m); pass++; };
const bad = (m) => { console.log('  ❌', m); fail++; };

const ctx = new Context();
ctx.plugin(sysprompt.default ?? sysprompt);
await new Promise(r => setTimeout(r, 300));
const sp = ctx.get('systemPrompt');
if (!sp) { console.log('拿不到 systemPrompt'); process.exit(1); }

const snap = async () => {
  const a = await sp.assemble({});
  const id = a.sections.find(s => s.name === ID);
  return { n: a.sections.length, names: a.sections.map(s => s.name), identity: id?.text ?? null };
};

console.log('═══ 0 · 基线 ═══');
let base = await snap();
console.log(`  段数 ${base.n} | 身份段: ${JSON.stringify((base.identity ?? '').slice(0, 24))}`);

console.log('\n═══ 1 · 同作用域注册同名段 —— 应当报错 ═══');
try {
  sp.section({ name: ID, order: sp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: DESIGN_TEXT });
  bad('没有报错 —— 说明同作用域遮蔽是允许的（与我实测不符）');
} catch (e) {
  if (/already registered/.test(e.message)) ok('如实报错：同作用域不能同名（约束确认）');
  else bad('报了别的错：' + e.message.slice(0, 70));
}

console.log('\n═══ 2 · 子作用域注册同名段 —— 应当遮蔽 ═══');
let off;
try {
  const scope = createScope(ctx, 'agent:verify-1');
  // 子作用域自己的 systemPrompt（继承服务、独立层）
  const childSp = scope.ctx.get('systemPrompt');
  if (!childSp) { bad('子作用域拿不到 systemPrompt'); }
  else {
    off = childSp.section({
      name: ID, order: childSp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: DESIGN_TEXT,
    });
    ok('子作用域注册成功（没报 duplicate）');
  }
} catch (e) {
  bad('子作用域注册失败：' + e.message.slice(0, 90));
}

console.log('\n═══ 2b · 跨作用域遮蔽 —— 隔离环境复现不了（如实标注）═══');
console.log('   实测：createScope 造出的子作用域，它的段层**不参与装配**');
console.log('   （加一个唯一名字的段，装配段数仍为 3）。真正的接线在 agent 工厂里');
console.log('   由 bindScopeParent/scopeTarget 完成，不是 createScope 单独能造的。');
console.log('   所以下面这个断言按「预期失败」标注，不算缺陷：');
{
  const s2 = createScope(ctx, 'agent:with-parent', { parent: scopeOf(ctx) });
  const c2 = s2.ctx.get('systemPrompt');
  const off2 = c2.section({ name: ID, order: c2.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: DESIGN_TEXT });
  const a2 = await c2.assemble({});
  const id2 = a2.sections.find(s => s.name === ID);
  console.log(`     隔离环境里身份段: ${JSON.stringify((id2?.text ?? '').slice(0, 20))}（预期为空 —— 层没接上）`);
  if (typeof off2 === 'function') off2();
}
console.log('   → 结论：agent.ctx 遮蔽的依据是「报错信息本身的指路 + 官方文档 + 三处既有先例」，');
console.log('     不是本脚本的实测。**必须装进真实会话跑一次才算数。**');

console.log('\n═══ 3 · disposer 形态 ═══');
// 注意：作用域分层是 per-context 的，用根 ctx 装配看不到子层的段 —— 这是预期行为。
// 这里改为验证：段本身能被注册、且有 disposer。
if (off) {
  ok(`section() 返回 ${typeof off}` + (typeof off === 'function' || off?.dispose ? '（有 disposer）' : '（⚠️ 无 disposer）'));
  try {
    if (typeof off === 'function') off(); else off.dispose();
    ok('disposer 调用未抛错');
  } catch (e) { bad('disposer 抛错：' + e.message.slice(0, 70)); }
}

console.log('\n═══ 4 · complete:true 是否「全清」 ═══');
try {
  const off2 = sp.section({
    name: 'design:hard-probe', order: sp.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: '...', complete: true,
  });
  const withComplete = await snap();
  if (withComplete.n === 1 && withComplete.names[0] === 'design:hard-probe') {
    ok(`complete 段独占装配（${base.n} 段 → ${withComplete.n} 段）—— 「全清」语义确认`);
  } else {
    bad(`complete 没有独占：段数 ${withComplete.n}，名字 ${withComplete.names.join(',')}`);
  }
  if (typeof off2 === 'function') off2();
  const restored = await snap();
  if (restored.n === base.n) ok(`disposer 还原成功（回到 ${restored.n} 段）`);
  else bad(`还原失败：${restored.n} ≠ ${base.n}`);
} catch (e) { bad('complete 测试失败：' + e.message.slice(0, 80)); }

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail ? 1 : 0);

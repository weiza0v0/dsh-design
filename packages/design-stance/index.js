/**
 * dsh-design-stance —— 在**同一个会话里**穿脱设计人格
 *
 * ## 架构：对标 DSH 的 plan mode，不是我自己那套
 *
 * plan mode（`@deepseek-ai/dsh-plan-mode`）已经解决了同一个问题 ——
 * "一个能在会话内开关、改变行为、且不用切 preset 的模式"。它的做法比
 * "运行时增删提示段"干净得多：
 *
 *     ctx.systemPrompt.section({
 *       name: 'plan:policy',
 *       order: PLAN_POLICY,
 *       text: (context) => {
 *         if (context.agent === void 0) return '';
 *         return activeFor(context.agent.session) ? this.section : '';   // ← 关键
 *       },
 *     });
 *
 * **段永远注册着，只是不激活时 `text` 返回空串。** 切换 = 翻一个 flag，
 * 不涉及增删段，也就**绕开了"同作用域不能同名遮蔽"那个坑**
 * （实测：跨作用域遮蔽必须走 agent.ctx，而 createScope 造不出可用的子作用域）。
 *
 * 状态用**内存 Map**（见下文「踩过的坑」—— 第三方插件不能往会话日志写自定义事件）。
 *
 * ## 入口
 *
 *   `/design`          穿上
 *   `/design off`      卸下
 *   `/design status`   看状态
 *   `design_stance`    工具 —— 让**模型**也能切（首轮即可用）
 *
 * ⚠️ 斜杠命令在**全新会话的欢迎页**上不可用 —— 需要会话 `open`
 * （`command catalog requires a retained session`）。这是 DSH 客户端的通例，
 * `/plan` 同样如此。所以额外给了工具：**工具从第一轮就可用**。
 */
import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { composed } from 'dsh-design-prompt';

export const name = 'dsh-design-stance';
export const inject = ['tools', 'systemPrompt', 'sessionProjections'];

/** 段名与位置：排在身份段（0）之后、plan 策略（500）与工具指引（1000+）之前 */
const SECTION_NAME = 'design:stance';
const SECTION_ORDER = 100;

/**
 * 穿上时注入的正文。
 *
 * **为什么前面要加一段「覆盖声明」**：本段是**追加**在标准身份之后的
 * （不是替换），所以必须明确告诉模型以本节为准 —— 这也是 OpenDesign
 * discovery 层的做法（"read first — these override anything later"）。
 */
const STANCE_TEXT = `# 设计人格生效中（design stance）

你现在是**设计工作台**，不是编码助手。**下面的章程优先于本提示更早处的身份描述。**

工具用法不受影响 —— 照常读文件、跑 shell、联网搜索、渲染看图。章程里提到的
工具（\`deck_lint\` / \`deck_render\` / \`media_generate\` / \`ask_user_question\`）都在。

---

${composed}`;

/**
 * 装束状态：**纯内存，不写会话日志**。
 *
 * ## 为什么不用 sessionProjections（踩过的坑）
 *
 * 之前这里注册了一个投影，并 `session.append('design-stance/mode', …)` 写自定义事件。
 * 结果**整个会话日志读不出来了**：
 *
 *     SessionQueryError: session "…" contains event type "design-stance/mode"
 *     (seq 16) unknown to this harness and not marked ignorable;
 *     refusing to interpret the log
 *
 * 原因在 `dsh-session-persistence` 的 `validateStoredEvents`：
 *
 *     if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) throw …
 *
 * `KNOWN_SESSION_EVENT_TYPES` 是 `dsh-session` 里的**固定集合**（`plan/mode` 之所以能用，
 * 是因为它本来就在表里），第三方插件既不能扩展它，`session.append()` 也不暴露
 * `ignorable` 参数。**所以第三方插件不该往会话日志写自定义事件。**
 *
 * 设计人格本来就是**会话内**状态（不像 plan mode 需要跨重启保留）——
 * 重启后重新 `/design` 一下就行。用内存 Map，零副作用。
 */

/** 投影键：客户端 chip 用它读状态 */
const PROJECTION_KEY = 'designStance';

/**
 * 投影：给**客户端 chip** 读的状态。
 *
 * ## 与 plan mode 的关键差别
 *
 * plan mode 的 `apply` 里有一个 `plan/mode` 分支 —— 那是它 `session.append()` 写的
 * **自定义事件**。它能用，是因为 `plan/mode` **本来就在** `dsh-session` 的
 * `KNOWN_SESSION_EVENT_TYPES` 里。
 *
 * 第三方插件进不了那个表，`append()` 也不暴露 `ignorable` —— 写了就会让
 * **整个会话日志读不出来**（我踩过，见文件头）。所以这里**只从已知事件派生**：
 * `command/run` 与 `command/done`。不写任何自定义类型。
 */
const projectionDefinition = {
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: z.object({
    active: z.boolean(),
    running: z.object({ commandId: z.string(), wanted: z.boolean() }).strict().nullable(),
  }).strict(),
  init: () => ({ active: false, running: null }),
  apply: (state, event) => {
    if (event.type === 'command/run' && event.data.name === 'design') {
      const args = String(event.data.args ?? '').trim().toLowerCase();
      // `status` 不是状态变更 → 不记
      if (args === 'status') return state;
      const wanted = args === 'off' ? false : true;
      return { ...state, running: { commandId: event.data.commandId, wanted } };
    }
    if (event.type === 'command/done' && event.data.commandId === state.running?.commandId) {
      if (event.data.kind !== 'success') return { ...state, running: null };
      return { active: state.running.wanted, running: null };
    }
    return state;
  },
  /** 客户端读的就是这个裁剪视图 */
  wire: {
    viewSchema: z.object({ active: z.boolean() }),
    view: (state) => ({ active: state.active }),
  },
};

const stances = new Map();

const README = 'on | off | status（不填 = on）';

export function apply(ctx) {
  const projectionOf = (session) => ctx.sessionProjections.stateOf(session, PROJECTION_KEY);
  /** 投影（命令路径，客户端可见）优先；Map 兜底（工具路径） */
  const activeOf = (session) => projectionOf(session)?.active === true || stances.get(session) === true;

  /** 切换。返回 'committed' | 'noop' */
  const setStance = (agent, active) => {
    const session = agent.session;
    if (active === activeOf(session)) return 'noop';
    stances.set(session, active);
    return 'committed';
  };

  // ① 投影（客户端 chip 的数据源）
  ctx.sessionProjections.register(projectionDefinition);

  // ② 提示段：永远注册着，text 是函数 —— 不激活就返回空串
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (context) => {
      if (context.agent === void 0) return '';
      return activeOf(context.agent.session) ? STANCE_TEXT : '';
    },
  });

  // 斜杠命令（客户端 chip 未接入时不写日志，纯内存）
  // ② 斜杠命令
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: 'dsh-design-stance',
      name: 'design',
      description: '穿上 / 卸下设计人格（无需新开会话）',
      input: { hint: README },
      handler: ({ agent, rawInput }) => {
        const arg = String(rawInput ?? '').trim().toLowerCase();

        if (arg === 'status') {
          return {
            kind: 'success',
            text: activeOf(agent.session)
              ? '设计装束：**已穿**（设计人格生效中）'
              : '设计装束：未穿（标准人格）',
          };
        }

        // 穿上：`/design`（照 plan mode：`/plan` 即开）与 `/design on` 等价。
        // 工具 design_stance 用的是 on/off/status，命令这里**两套词都收** ——
        // 否则用户按工具的习惯打 `on` 会撞到「未知参数」。
        if (arg === '' || arg === 'on') {
          const r = setStance(agent, true);
          return {
            kind: 'success',
            text: r === 'noop'
              ? '设计人格本来就在身上（`/design off` 可卸下）。'
              : '✅ 设计人格已上身。**下一轮生效** —— 工具指引保留，章程优先于原身份。\n用 `/design off` 卸下。',
          };
        }

        if (arg === 'off') {
          const r = setStance(agent, false);
          return {
            kind: 'success',
            text: r === 'noop' ? '本来就没穿。' : '✅ 设计人格已卸下，下一轮回到原人格。',
          };
        }

        return {
          kind: 'error',
          text: `未知参数 "${arg}"。可用：/design（= on）· /design off · /design status`,
        };
      },
    });
  });

  // ③ 工具：让模型也能切 —— **首轮即可用**（命令在欢迎页不可用）
  ctx.tools.register(defineTool({
    name: 'design_stance',
    description: [
      'Turn the design persona on or off for THIS session.',
      '',
      'When ON, a design charter (typography, colour, anti-AI-slop rules, deck framework,',
      'direction library) takes precedence over the coding-assistant identity. Tool usage is',
      'unaffected. Turn it on when the user shifts from research/planning into making an HTML',
      'artifact (deck, page, prototype, video) or starts asking about visual direction, and',
      'turn it off when they return to engineering work.',
      '',
      'Do NOT call this for a quick one-line CSS tweak — the charter is large.',
    ].join('\n'),
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: '"on" to enable the design persona, "off" to disable it, "status" to read the current state.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { active: { type: 'boolean' }, changed: { type: 'boolean' } },
      },
      render: (_a, v) => [{
        type: 'text',
        text: v.changed
          ? `设计人格现已 ${v.active ? '**生效**' : '**关闭**'}（下一轮生效）。`
          : `设计人格${v.active ? '已经是生效状态' : '本来就是关闭的'}，未改动。`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const action = String(args?.action ?? '').trim().toLowerCase();
      if (!['on', 'off', 'status'].includes(action)) {
        throw new Error('`action` 只能是 "on" / "off" / "status"。');
      }
      const agent = exec?.agent;
      if (agent === undefined) throw new Error('design_stance 需要 agent（exec.agent 为 undefined）');

      if (action === 'status') return { active: activeOf(agent.session), changed: false };
      const changed = setStance(agent, action === 'on') === 'committed';
      return { active: activeOf(agent.session), changed };
    },
  }));
}

export const internals = { SECTION_NAME, SECTION_ORDER, PROJECTION_KEY, STANCE_TEXT, README, stances, projectionDefinition };

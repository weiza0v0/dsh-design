/**
 * dsh-design-stance / client —— 输入框旁的设计人格指示 chip
 *
 * ## 形态对标 `@deepseek-ai/dsh-client-ui-plan` 的 PlanChip
 *
 * plan mode 的入口是 `/plan` 命令，回车后输入框旁出现一个「计划」chip，
 * 点它即可退出。本文件做的就是同一件事：`/design` 之后出现「设计」chip。
 *
 * ## 客户端插件的模块形式
 *
 * `dsh-client-modules` 解析 package.json 的 `exports["./client"]`，
 * 按 `window.__ModuleLoader__.load({ id, factory })` 取模块。
 * **不需要构建步骤** —— 官方那些是 tsdown 预打包的，但我这里直接写普通 JS。
 *
 * ## 槽位
 *
 * 输入区有两组（见 `dsh-client-ui-conversation` 的 InputBar）：
 *
 *     左边 modes 组：  conversation.input.permission · conversation.input.plan
 *     紧随其后：       conversation.input.left          ← 本插件挂这里
 *     右边 trailing：  conversation.input.right · conversation.input.model
 *
 * ## 为什么是 input.left（用户指定的位置）
 *
 * 目标：**计划关的时候占计划的位置；计划开的时候贴着它右边**。
 *
 * `conversation.input.plan` 是 `kind: "single"` —— 只容一个注册，不能共用。
 * 而 `conversation.input.left` 是 `kind: "list"`，**渲染顺序就在 modes 组之后**：
 *
 *     计划关 → [权限] [plan 槽零宽] [本 chip]   ← 视觉上正好是计划的位置
 *     计划开 → [权限] [计划]      [本 chip]   ← 紧贴它右边
 *
 * 正是要的效果。
 */
window.__ModuleLoader__.load({
  id: 'dsh-design-stance',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    /** 投影键 —— 必须与服务端 `PROJECTION_KEY` 一致 */
    const PROJECTION_KEY = 'designStance';
    const NS = 'designStance';

    const zh = {
      'chip.label': '设计',
      'chip.on.aria': '设计人格生效中，按下卸下',
      'chip.on.title': '设计人格生效中 —— 点击卸下（/design off）',
      'chip.exitFailed': '卸下设计人格失败',
    };
    const en = {
      'chip.label': 'Design',
      'chip.on.aria': 'Design persona active, press to turn off',
      'chip.on.title': 'Design persona active — click to turn off (/design off)',
      'chip.exitFailed': 'Failed to turn off the design persona',
    };

    const CSS = {
      wrap: { display: 'inline-flex', alignItems: 'center', gap: '6px' },

      // 对齐 PlanChip 的形态：浅色底 + 同色文字 + 细描边。
      // 计划用 `--dsw-alias-state-business-*`（蓝），设计用赭石 ——
      // 取自本项目的设计 token `#9A5048`。
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        height: '26px', padding: '0 9px 0 7px',
        border: '1px solid #E4CFC9',
        borderRadius: '6px',
        background: '#F7EDEA',
        color: '#7A3A32',
        font: 'inherit', fontSize: '12px', lineHeight: '1',
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease',
      },
      chipHover: { background: '#F0DFD9', borderColor: '#D9B9B0' },
      glyph: { display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' },
      error: { fontSize: '11px', opacity: 0.8, color: 'var(--dsw-alias-state-error-primary, #b0302a)' },
    };

    /** 设计人格的自绘图标（调色板）—— 不依赖图标库，也不需构建 */
    function Glyph() {
      return React.createElement(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: CSS.glyph },
        React.createElement('path', {
          d: 'M8 1.5a6.5 6.5 0 0 0 0 13c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.2-.3-.4-.6-.4-1 0-.6.5-1.1 1.1-1.1h1.3A3.3 3.3 0 0 0 14.5 6.4C14.5 3.7 11.6 1.5 8 1.5Z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }),
        React.createElement('circle', { cx: 5.4, cy: 6.0, r: 1.0, fill: 'currentColor' }),
        React.createElement('circle', { cx: 8.6, cy: 4.4, r: 1.0, fill: 'currentColor' }),
        React.createElement('circle', { cx: 11.3, cy: 6.6, r: 1.0, fill: 'currentColor' }),
      );
    }

    /**
     * 只在设计人格生效时渲染。点一下执行 `/design off`。
     *
     * `useProjection` 与 `inject` 提供的 props 由槽位框架注入
     * （对标 PlanChip 的 `{ useProjection, locked, exitPlanMode, t }`）。
     */
    function DesignChip(props) {
      const { useProjection, locked, exitDesign, t } = props;
      const stance = useProjection(PROJECTION_KEY);
      const [leaving, setLeaving] = React.useState(false);
      const [enter, setEnter] = React.useState(false);
      const [error, setError] = React.useState(null);
      const alive = React.useRef(true);

      React.useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
      }, []);

      // 对齐 PlanChip：**只在生效时渲染**。
      //   /design      → 卡片出现
      //   /design off  → 卡片消失
      if (stance === undefined || stance.active !== true) return null;

      const off = () => {
        setLeaving(true);
        setError(null);
        Promise.resolve(exitDesign()).then(
          (failure) => { if (!alive.current) return; setLeaving(false); setError(failure ?? null); },
          (reason) => { if (!alive.current) return; setLeaving(false); setError(reason instanceof Error ? reason.message : String(reason)); },
        );
      };

      const label = leaving ? t('chip.leaving') : t('chip.label');

      return React.createElement(
        'span',
        { style: CSS.wrap },
        React.createElement(
          'button',
          {
            type: 'button',
            style: enter ? { ...CSS.chip, ...CSS.chipHover } : CSS.chip,
            onMouseEnter: () => setEnter(true),
            onMouseLeave: () => setEnter(false),
            'aria-label': t('chip.on.aria'),
            title: t('chip.on.title'),
            disabled: Boolean(locked) || leaving,
            onClick: off,
          },
          React.createElement('span', { style: CSS.glyph }, React.createElement(Glyph)),
          label,
        ),
        error !== null
          ? React.createElement('span', { style: CSS.error, role: 'status', title: error }, t('chip.exitFailed'))
          : null,
      );
    }

    /** 客户端依赖的服务。对标 plan 的 slots/remote/remote.commands/sessions/locale。 */
    const inject = ['slots', 'remote', 'remote.commands', 'sessions', 'locale'];


    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'design-stance: dictionaries');

      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            // ⚠️ 必填：`kind: "list"` 的槽位要求 options.id（single 槽不需要）。
            //    漏了会抛：list slot "…" requires options.id —— 而且被
            //    slots.inject 的回调吞掉，只在控制台留一条 uncaught。
            id: 'dsh-design-stance',
            locale: NS,
            inject: (sessionId) => ({
              // 卡片只在生效时出现 → 点击永远意味着「关闭」
              exitDesign: async () => {
                const result = await ctx.remote.commands.execute(sessionId, '/design off', []);
                if (!result.ok) return `${result.error.message} (${result.error.code})`;
                if (result.value === undefined) return 'unknown command: /design off';
                return null;
              },
            }),
          },
          DesignChip,
        ));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

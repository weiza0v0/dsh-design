# deck_lint 规则清单

`deck_lint` 的 16 条规则、严重度与标准修法。**第一次跑工具之前先读这里** —— 这样你能一次改对，而不是被工具牵着来回改几轮。

判定逻辑是从 OpenDesign 逐字移植的代码，不是口味偏好。规则是 **greppy 的：不解析 HTML**，所以允许存在误报；每条 finding 都带 `snippet`，判断是误报时用 snippet 核对后说明理由。

## 怎么读一条 finding

```
[P0] ai-default-indigo — Found a default LLM accent color (#6366f1) — this is the most-reported AI design tell.
     Fix: Replace with var(--accent) from the active DESIGN.md. …
     Snippet: `background: #6366f1`
```

- **P0（10 条）：必须清零才允许交付。** 这是"回归成 AI 味"的硬信号。
- **P1（5 条）：修掉，或明确说明为什么不修。**
- **P2（1 条）：可选打磨。**

---

## P0 · 必须修复

### `ai-default-indigo`
**触发**：出现 AI 默认强调色 —— 恰好这几个值：`#6366f1` `#4f46e5` `#4338ca` `#3730a3` `#8b5cf6` `#7c3aed` `#a855f7`。**单次实体使用即触发**（不必是渐变）。
**不触发**：在 `:root` 里声明成 token、再通过 `var(--accent)` 消费 —— 那是"有意的品牌决定"。
**修法**：Replace with var(--accent) from the active DESIGN.md. If the brief truly requires indigo, encode it as the design system's accent so it reads as intentional, not default.

### `purple-gradient`
**触发**：渐变里含紫色系 hex（Tailwind violet/purple/indigo 全档）或字面量 `purple` / `violet`。
**修法**：Replace the gradient with a flat surface (var(--bg) or var(--surface)) or use the active accent at a single intensity, not in a gradient.

### `trust-gradient`
**触发**：渐变**同时**含蓝色档（Tailwind blue/sky）和青色档（Tailwind cyan）—— 或关键字形式 `blue → cyan`。即"紫蓝/蓝青双色信任渐变"。
**修法**：Replace the gradient with a flat surface (var(--bg) or var(--surface)) or use a single design-token color. Two-stop blue→cyan trust gradients are a SaaS hero cliché.

### `emoji-icon`
**触发**：`✨🚀🎯⚡🔥💡📈🎨🛡️🌟💪🎉👋🙌✅⭐🏆` 出现在**结构位置**（`h1`–`h6` / `button` / `li` / `class` 含 `icon` 的元素）。正文散文里出现不算。
**修法**：Replace with a small inline SVG icon (1.6–1.8px stroke, currentColor) or remove the icon entirely.

### `sans-display`
**触发**：`h1`/`h2`/`h3`（或 `.hero`/`.xl`/`.lg`/`.md` 类）的 `font-family` 落在 Inter / Roboto / Arial / -apple-system / system-ui 上，且前面没有真正的衬线体。
**修法**：Use `font-family: var(--font-display)` on h1/h2/h3 and let the active design system pick the serif. Override only if the active direction is "tech / utility" or "modern minimal".

### `invented-metric`
**触发**：典型 AI 创业腔的数字断言 —— `10× faster/better/easier`、`100× faster/better`、`99.x% uptime`、`zero-downtime`、`3× more productive/efficient`。
**修法**：Either remove the claim or replace with a placeholder (— or a labelled stub) until the user supplies a real number.

### `filler-copy`
**触发**：`feature one/two/three`、`lorem ipsum`、`dolor sit amet`、`placeholder text`、`sample content`。
**修法**：Replace with copy specific to the brief or delete the section entirely. An empty section is a design problem to solve with composition, not by inventing words.

### `left-accent-card`
**触发**：圆角卡片 + 左侧色条（`border-left` 强调）。
**修法**：Drop either the border-radius (set 0px) or the border-left. Cards in the OD seed use hairline borders all-round, no left accent.
> DSH 语境：这条的价值在于"别用 AI 最常见的卡片套路"。四边细线边框、或干脆不用边框，都行。

### `scroll-into-view`
**触发**：代码里出现 `scrollIntoView`。
**修法**：Use `scrollTo({ left, top, behavior: "smooth" })` on the actual scroller (see simple-deck seed for the proven pattern).
> DSH 语境：`scrollIntoView` 在 iframe 预览里会破坏翻页定位。`od-deck` 的 `assets/runtime.js` 已实现正确的翻页，直接用它。

---

## P1 · 应当修复

### `all-caps-no-tracking`
**触发**：`text-transform: uppercase` 且 **同一规则**里缺少足够字距。判据是解析出该规则的 `font-size` 后换算 —— 阈值 `0.06em` 等效。同时检查 `<style>` 块与内联 `style` 属性。
**不触发**：整条规则被 CSS 注释包住时。
**修法**：Add `letter-spacing: 0.08em` (typical) to the same rule. ALL CAPS without tracking looks cramped — Refero's typography rules call this out as a top-tier amateur tell.

### `raw-hex`
**触发**：`:root` token 块**之外**出现裸 hex 颜色。
**不触发**：在 `:root`（含 `html` / `body` / `data-theme` 前缀的全局主题作用域）里声明、经 `var()` 消费；也放行 `@media` / `@supports` 里嵌套的 token 块。
**修法**：Move every color into the :root token block (--bg / --surface / --fg / --muted / --border / --accent) and reference via var(). Use color-mix() for derived tones.

### `accent-overuse`
**触发**：`var(--accent)` 在可见正文里出现次数过多。
**修法**：Cap accent usage at 2 visible uses per screen (one eyebrow + one CTA, OR one accent card + one tab). Demote the rest to var(--fg) or var(--muted).

### `external-image`
**触发**：外链图片（CDN / unsplash / placehold.co 之类）。
**修法**：Use the .ph-img placeholder class shipped in the seed templates instead.
> DSH 语境：DSH 没有这个类。意思是**别引用外链图片** —— 改成项目内的本地资源，或一个明确标注的占位块。

### `slide-rhythm`（deck 专属）
**触发**：**连续 3 页同主题**（`light` 系或 `dark` 系）。
**修法**：Swap the middle slide to the opposite theme (light → dark, or dark → light). For 8+ slides, mix in at least one hero light AND one hero dark.

---

## P2 · 可选打磨

### `missing-section-anchor`（deck 专属以外的通用项）
**触发**：有 `<section>` 却没有 `data-od-id` 或 `data-screen-label`。
**修法**：Add data-od-id="kebab-slug" (or data-screen-label="01 Cover" for slides) to every top-level `<section>` so comment mode can target it.
> DSH 语境：没有 OpenDesign 的 comment mode。但**给每个 section 一个可读标识仍然值得做** —— 便于后续按页定位修改。

### `slide-theme-missing`（deck 专属）· 实为 P0
> ⚠️ 注意：这条严重度是 **P0**，不是 P2。列在这里是因为它和上一条同属 section 结构检查。

**触发**：`<section class="slide">` 缺少 theme class（`light` / `dark` / `hero light` / `hero dark`）。
**修法**：Every `<section class="slide">` must include exactly one theme class. Audit your slide list and add light/dark/hero modifiers.

---

## 交付门禁

```
deck_lint(path="/绝对路径/deck.html")   →   verdict
```

- `verdict: "pass"` → P0 = 0，可以交付
- `verdict: "block"` → 存在 P0，**不要向用户宣布完成**；按 fix 改文件后重跑

改了 markup 或样式就重跑，哪怕只调了一行颜色。

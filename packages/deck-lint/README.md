# dsh-deck-lint

把 [OpenDesign](https://github.com/nexu-io/open-design) 的**确定性反 AI-slop 检查器**接成 DSH 工具。

**为什么不是 skill**：skill 是提示词，模型可以忽略、可以假装自查、可以只读一半。这个插件把 16 条审美规则变成**代码判定**——同一条规则，弱模型会被抓住，强模型会被放过，标准不随模型换代漂移。

规则覆盖：AI 默认靛蓝、紫/蓝青"信任"渐变、emoji 当图标、该用衬线处用无衬线、编造指标、填充文案、ALL-CAPS 字距不足、`:root` 外裸 hex、强调色滥用、外链图片，以及 deck 专属的页主题/节奏检查。

---

## 安装

插件是纯 ESM、**零构建、零运行时依赖**（`@deepseek-ai/dsh-tools` 由宿主提供）。

```bash
# 一条命令（推荐）—— 插件管理器会装包，并把本包自动加进 dsh.profile.bundles
dsh plugin --profile web add dsh-deck-lint

# 然后重启 DSH —— 插件不像 skill 那样热加载
```

装好后新会话的工具集里会出现 `deck_lint`。

> **为什么必须走 `dsh plugin add` / 插件页**：DSH 的 plugin-manager 只接受
> **声明了 bundle patch 的包**（`package.json` 的 `dsh.bundle.patch`）。本包有，
> 所以能装。从源码装（`link:`）也可以 —— 仓库根的 `npm run test:bundles`
> 就是用来守住这条契约的。

**回滚**：`dsh plugin --profile web remove dsh-deck-lint`，或从 `dsh.profile.bundles`
里删掉 `dsh-deck-lint` 后 `pnpm install`，再重启。

---

## 用法

```
deck_lint(path="/abs/path/deck.html")
deck_lint(html="<section class=\"slide hero light\">…")
```

`path` 与 `html` **必须且只能给一个**。

返回：

```jsonc
{
  "source": "/abs/path/deck.html",
  "verdict": "block",                 // P0>0 → "block"，否则 "pass"
  "counts": { "P0": 2, "P1": 0, "P2": 1 },
  "findings": [
    {
      "severity": "P0",
      "id": "ai-default-indigo",
      "message": "Found a default LLM accent color (#6366f1) — this is the most-reported AI design tell.",
      "fix": "Replace with var(--accent) from the active DESIGN.md. …",
      "snippet": "background: #6366f1"
    }
  ]
}
```

面向模型的输出是 `<artifact-lint>` 清单。**每条 finding 都带 `snippet`**——这是刻意的设计：规则是 greppy 的，不解析 HTML，所以允许存在误报，但你必须能靠 snippet 判断它是真问题还是误报，而不是盲信规则。

### 与 `od-deck` skill 的分工

- `od-deck` skill 管**应该做什么**（方向、叙事、版式、设计系统）
- `deck_lint` 管**不许做什么**（可判定的规则）

skill 里要求：生成或修改 HTML deck 后**必须**跑一次 `deck_lint`，**P0 清零才算交付**。

---

## 移植来源与偏差

规则本体 `src/lint.js` 从 OpenDesign 的**构建产物**逐字移植（同 commit），不是重写：

| 来源 | 说明 |
|---|---|
| `apps/daemon/src/lint-artifact.ts` | 1000 行源逻辑 |
| `apps/daemon/dist/lint-artifact.js` | 951 行构建产物 ← **实际移植底本** |
| `apps/daemon/tests/lint-artifact.test.ts` | 1224 行 / 94 用例 ← 等价性护栏 |
| `packages/contracts/src/api/artifact-lint.ts` | finding 形状（仅类型） |

用构建产物而非源文件，是为了避免手工转译 1000 行 TypeScript 引入偏差。运行时**零依赖**（源文件里唯一的 import 是 `import type`，编译期已擦除）。

**测试**：上游 94 个用例全部保留、正文一字未改，只把 `vitest` 换成 `node:test` + 本仓库 20 行的 `tests/harness.mjs`（上游只用 `toBe` / `toBeDefined` / `toBeUndefined` 三个 matcher，加一个 `it.each`）。

```bash
node --test tests/lint.test.mjs   # 125 个（97 上游 + 28 本地）
node --test tests/smoke.test.mjs  # 8 个外壳测试
# 合计 133 个，全绿
```

### 刻意偏差 1：CSS 注释剥离

上游在跑 section/slide 检查前会剥离 **HTML 注释**（`<!-- -->`），理由写在源码注释里：注释中的示例文案会误报。但 `<style>` 里的 **CSS 块注释**没被覆盖——而 deck seed 的框架注释恰好写着 `<section class="slide"> bodies`。

**后果**：从该 seed 生成的**每一份** deck 都会稳定误报一条 P0 `slide-theme-missing`。一个对好产物永远报警的闸门会立刻失去可信度。

**修法**：`src/lint.js` 里引入 `structural = html.replace(/\/\*[\s\S]*?\*\//g, '')`，**只**用于结构性标签扫描（`<section>` 与 slide 匹配）。分析 CSS 的规则（ALL-CAPS 字距、裸 hex）继续用原文 `html`，注释处理逻辑不变。

由 4 个本地回归用例锁住（`describe('structural scan vs CSS comments (local)')`），且上游 97 个用例无回归。

### 刻意偏差 2：识别文档级主题约定

`slide-theme-missing` 与 `slide-rhythm` 假定 deck 用**每页 theme class**（`light` / `dark` / `hero light` / `hero dark`）—— 那是 OpenDesign `simple-deck` seed 的约定。

但 `html-ppt` 家族（本仓库协作的 `od-deck` skill 用的就是它）是**文档级主题**：

```html
<html lang="zh-CN" data-theme="minimal-white">
<link rel="stylesheet" id="theme-link" href="../assets/themes/minimal-white.css">
<body data-themes="minimal-white,editorial-serif,…">
```

它的页面**按设计就没有** per-slide theme class。对这类 deck 跑上述两条规则，会在**每一份合规产物**上稳定报一条无法消除的 P0。

**修法**：检测到 `<html>` / `<body>` 上的 `data-theme(s)` 时，`documentThemed` 置真，两条 slide 规则整体让位。

代价是：一个同时使用文档级主题**和** per-slide class 的混合 deck 会漏检这两条。这种混合本身就不合理，接受。

由 4 个本地回归用例锁住（含反向保护：无文档级主题时仍必须报）。

---

## 已知限制

1. **不是硬阻断**。DSH 未暴露否决钩子（`ctx.on('tools/execute'|'tools/result')` 只用于观察，本机唯一使用者 `dsh-chime-alerts` 即为观察用法）。可信度来自"规则由代码判定 + P0 清单渲染给模型"，而不是强制。
2. **greppy，不解析 HTML**，存在可接受误报。每条 finding 带 `snippet` 供判断。
3. **规则集是 2026-10 快照**，上游会演进。同步方式是重新取 `lint-artifact.ts` 的构建产物并跑本仓库测试。
4. **只覆盖可判定规则**。选错方向、叙事结构差这类判断类问题，本工具不管——那是 skill 与模型的事。

## 后续（不在 v1）

- **`deferContext` 回注**：`ToolRunContext.deferContext(UserMessage)` 能把"插件来源的指令"在工具结果之后注入 agent 循环，是上游"把 lint 结果塞回系统消息"的等价物。**v1 未实现**，原因：需要构造 branded `MessageId` 与 `MessageSource`，而本机没有现成先例，为边际收益冒污染会话的风险不划算。待工具被证明会被忽略时再上。
- **`deck_scaffold`**：从模板生成确定性骨架，消灭随机魔法数字（`padding: 37px` 类）。
- **视觉回读**：渲染成图让模型回看，专治判断类漂移。

---

## 许可

MIT。规则与测试移植自 [OpenDesign](https://github.com/nexu-io/open-design)（Apache-2.0）；
其中反 AI-slop 规则改编自 [referodesign/refero_skill](https://github.com/referodesign/refero_skill)（MIT），
五维评审框架来自 [alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design)。

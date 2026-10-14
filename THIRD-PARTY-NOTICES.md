# Third-party notices / 第三方声明

本仓库**自己的代码**以 MIT 发布（见 [`LICENSE`](./LICENSE)）。

但有相当一部分**内容与规则**来自第三方项目，其中最主要的是
[OpenDesign](https://github.com/nexu-io/open-design)（Apache-2.0）。
下面逐项列出**来源、许可、以及它覆盖了本仓库哪些文件**。

> 为什么这份文件必须存在：Apache-2.0 允许把衍生作品以别的许可分发，
> 但**要求**保留许可全文、保留声明、并标明修改过的地方。
> 只写一句「ported from …」不构成合规。

---

## 1. OpenDesign — Apache-2.0

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/nexu-io/open-design |
| 许可 | Apache License 2.0（全文见 [`skills/od-deck/LICENSE-APACHE-2.0`](./skills/od-deck/LICENSE-APACHE-2.0)） |
| 本仓库对齐的版本 | commit `1343f374c63d7866f4f3ff5d48ef038eba647f1b`（2026-10-13） |
| 上游 NOTICE | 上游仓库没有 `NOTICE` 文件，故本仓库无需另行转发 |

### 覆盖范围与修改说明

| 本仓库路径 | 上游来源 | 改了什么 |
|---|---|---|
| `packages/deck-lint/src/lint.js` | `apps/daemon/src/lint-artifact.ts` | **移植**：TypeScript → 无依赖 ESM JS；规则集**完全一致**（23 条标识符零差异），断言与文案重新整理 |
| `packages/design-prompt/content/00-discovery.md` | discovery / planning / huashu 哲学层 | 抽取、改写为单文件章节 |
| `packages/design-prompt/content/01-charter.md` | `official-system.ts` 的 `OFFICIAL_DESIGNER_PROMPT` | 抽取；filesystem 档的占位符已填 |
| `packages/design-prompt/content/02-directions.md` | `directions.ts` 方向库 | 抽取（方向 + OKLch 色板 + 字体栈） |
| `packages/design-prompt/content/03-craft-typography.md` | `craft/typography.md` | 抽取 |
| `packages/design-prompt/content/04-craft-color.md` | `craft/color.md` | 抽取 |
| `packages/design-prompt/content/05-craft-anti-ai-slop.md` | `craft/anti-ai-slop.md` | 抽取（另参考 refero_skill，见 §4） |
| `packages/design-prompt/content/06-deck-framework.md` | contracts 的 `renderDeckFrameworkDirective('filesystem')` | 抽取 |
| `packages/design-prompt/content/07-resources.md` | — | **本仓库自撰** |
| `skills/od-deck/design-systems/**`（20 套，共 595 个文件） | `design-systems/<name>/**` | **逐字复制整个目录**（已逐字节比对确认 `paper/DESIGN.md`、`paper/tokens.css` 与上游完全相同）。每套含 `DESIGN.md`、`tokens.{css,json,source.json,default.json}`、`tailwind-v4.css`、`manifest.json`、组件与版式示例 HTML（`components.html` / `deck.html` / `landing.html` …）。其中 4 套另带 19 种语言的 `DESIGN-<lang>.md` 译本 |
| `skills/od-deck/craft/**` | `craft/*.md` | 部分逐字、部分选自 `skills/` |
| `skills/od-deck/SKILL.md`、`references/**`、`templates/**`、`assets/**` | 多处 | 重写 / 重组为「6 步工作流 + 一 deck 一方向」 |
| `packages/media-gen/**` | `plugins/_official/*/` 的 media renderer 与 `FAL_ENDPOINTS` | **重写**：按「协议」（OpenAI 兼容 / 队列）而非按厂商实现。模型表里的 fal endpoint slug 取自上游 `FAL_ENDPOINTS` |

### 上游的完整素材库不在本仓库

OpenDesign 有 154 套设计系统、116 个设计模板、183 个成品参考、277+ 个插件。
本仓库只收了**够用的一小部分**（20 套设计系统 + html-ppt deck 引擎），
其余请从上游取。`skills/od-deck/SOURCES.md` 有一张「想找什么 → 去哪」的对照表。

---

## 2. html-ppt — MIT

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/lewislulu/html-ppt-skill |
| 许可 | MIT（全文见 [`skills/od-deck/LICENSE-html-ppt`](./skills/od-deck/LICENSE-html-ppt)） |
| 覆盖 | `skills/od-deck/templates/*.html`、`skills/od-deck/assets/{base.css,fonts.css,runtime.js}` |
| 修改 | 基本原样使用；`base.css` / `runtime.js` 未改动 |

这套框架是本仓库 deck 能力的骨架：1920×1080 画布、scale-to-fit、
键盘翻页、计数、localStorage 记忆、打印样式表（另存为 PDF 时逐页拼接）。

> ⚠️ **一个已知的契约差异**：本框架用 `.slide.is-active` 表示当前页，
> 而 `packages/design-prompt/content/06-deck-framework.md`（来自 OpenDesign）
> 描述的是 `.slide.active`。`dsh-deck-render` 两套都翻，所以都能渲染 ——
> 但你自己写 CSS 时要知道这一点。详见 deck-render 的 README。

---

## 3. huashu-design — 五维评审

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/alchaincyf/huashu-design |
| 覆盖 | `packages/design-prompt/content/00-discovery.md` 里的五维 critique 与设计哲学 |
| 修改 | 抽取并压缩进 discovery 章节 |

---

## 4. refero_skill — MIT

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/referodesign/refero_skill |
| 许可 | MIT |
| 覆盖 | `packages/design-prompt/content/05-craft-anti-ai-slop.md`、`packages/deck-lint/src/lint.js` 的部分文案 |
| 修改 | 改编为可判定的规则 + DSH 工具形态 |

---

## 5. DSH 宿主包（不作为本仓库的依赖分发）

`@deepseek-ai/*` 系列（`dsh-tools`、`dsh-system-prompt`、`dsh-scope`、`cordis` …）
由 DSH 宿主提供。本仓库只在**开发时**把它们装成 `devDependencies` 以便跑测试，
运行时不打包、不分发它们。

---

## 重新同步上游内容

本仓库的内容不会自动跟随上游。要更新：

```bash
# 假设上游克隆在 ~/tools/open-design
git -C ~/tools/open-design fetch && git -C ~/tools/open-design checkout 1343f374
# 然后按上面「覆盖范围」表逐项对比。改动上游内容时，请同步更新本文件。
```

改动其中任何一项时，**必须**同时更新本文件里的「改了什么」一栏 ——
那是 Apache-2.0 对衍生作品的要求，不是可选的礼貌。

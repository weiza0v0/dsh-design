# Changelog

本文件记录**用户可感知**的变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-10-14

首个公开版本。目标是「别人 clone 下来就能装、能用、能看懂」。

### 包含

- **dsh-design-stance** — `/design` 在同一个会话里穿脱设计人格。
  照 DSH plan mode 的架构：section 常驻 + `text()` 函数，切换只翻一个 flag。
  另有工具 `design_stance`（首轮即可用，绕开「斜杠命令在欢迎页不可用」）。
- **dsh-design-prompt** — 设计宪章内容模块（8 章 / 77,861 字节）。
- **dsh-deck-render** — `deck_render`：HTML → PNG，让模型看自己的产出。
  含独立 CLI。
- **dsh-deck-lint** — `deck_lint`：23 条反 AI-slop 规则的代码判定。
- **dsh-media-gen** — `media_models` / `media_generate`：BYOK 图片/视频/语音，
  2 套协议适配、16 个模型。
- **skills/od-deck** — 6 步工作流 + 20 套品牌设计契约 + 版式库 + 两道门 + PPTX 几何审计脚本。
- **skills/hyperframes** — HTML 视频合成。

### 修掉的关键缺陷

这些都**没有本地症状**，是实测或写测试时翻出来的：

- **渲染闸门静默失效（最严重）** — `deck_render` 只翻 `.slide.active`，
  而技能自带的框架用 `.slide.is-active`。照技能指示做出来的 deck 会渲出
  **N 张字节完全相同的图**，工具还报「N page(s) 全部渲好」。修法：
  两套类名都翻 + 内联样式兜底，不再依赖框架的类语义。
- **运行时克隆页被当成独立页** — 概览面板把每页 `cloneNode` 一份，
  `querySelectorAll('.slide')` 数到 2N 个，多出来的渲成白页。
  修法：只看**祖先是否被隐藏**，不看元素自身的 `display`。
- **无法察觉的重复** — 新增 `distinct` 字段 + SHA1 指纹自查，
  出现像素级重复就 warning。`pages != distinct` 就是信号。
- **`distinct` 算了却没接上** — 加进了 `renderDeck`、写进了 schema、
  `summarize` 也读了，唯独忘了在 `execute()` 的返回对象里带上。
  lib 单测全绿而模型看不到。新增 `test-tool.mjs` 做双向对账。
- **4/5 个包装不上** — DSH 的 plugin-manager 只接受声明了
  `dsh.bundle.patch` 的包，否则回滚安装。而手工写 profile insert 时一切正常。
  新增 `scripts/test-bundles.mjs` 守住这条契约。
- **`design-prompt` 的 `complete: true` 地雷** — 它曾注册一个独占
  整个 system prompt 的 section，防护手段只是文档里一句「别挂载」。
  删掉 `apply()`，变成纯内容模块。
- **`media-gen` 的报错文案带占位符** — 缺 API key 时的提示里写的是
  字面量 `(见 README)`，而不是真实配置路径。
- **`media-gen` 空 prompt 产出 `openaitts`** — `provider/model` 的斜杠
  被「去非法字符」吃掉。现在换成连字符。
- **`design-stance` 测试写死绝对路径** — 别人 clone 后直接崩。
- **第一次跑的人撞上「没有浏览器」** — `deck_render` 直接抛 Playwright 的
  `Executable doesn't exist at …`，读者得自己翻才知道该装什么。
  现在换成一句能照做的三选一提示（装 Chromium / 指定 `browser=` / 连 `cdp=`），
  并有 8 项断言守着这条提示不会退化。

### 测试

307 项断言：契约 43 · deck-lint 125 · deck-render 47 · media-gen 46 ·
design-stance 31 · design-prompt 15。渲染与媒体测试**零真实请求**。

验证方式包括：**从 `git clone` 出来的干净副本**里跑 `pnpm install && npm test`
全绿，再用 `pnpm demo` 12 秒渲出第一张图。

### 许可

自己的代码 MIT；`skills/od-deck/design-systems/**` 等来自
OpenDesign（Apache-2.0，pin `1343f374`），逐文件来源与修改说明见
`THIRD-PARTY-NOTICES.md`。

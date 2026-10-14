# dsh-design-stance

**在同一个会话里穿脱设计人格。** 一条 `/design` 命令，不用新开会话。

## 它解决什么

"设计模式"是一个 **agent preset**，而 preset 在**会话创建时**就定了。所以想用设计能力就得开新会话 —— 但真实工作是**阶段式**的：

```
调研 / brainstorm / 派子代理找资产   →   设计构建   →   交付
   需要标准工具（联网搜索、子代理）        需要设计宪章
```

**模式是会话级的，工作是阶段级的** —— 两者错位，人就得到处切会话。

这个插件把"模式"降级成"换装"：

```
/design          穿上
/design off      卸下
/design status   看状态
```

**外加一个工具 `design_stance`**，让模型自己也能切。

### ⚠️ 斜杠命令在全新会话的欢迎页上不可用

需要会话 `open`（客户端报 `command catalog requires a retained session`）。
**这是 DSH 的通例，`/plan` 同样如此** —— 不是本插件的问题。

所以额外提供了 **`design_stance` 工具**：工具随 agent 存在，**从第一轮就能用**。
你说"我们开始设计吧"，模型就能自己穿上。

两者的取舍：命令给你**确定性控制**，工具给**首轮可用性**。

## 架构：对标 DSH 的 plan mode

plan mode（`@deepseek-ai/dsh-plan-mode`）已经解决了同一个问题 —— "一个能在会话内开关、
改变行为、且不用切 preset 的模式"。**照抄它的做法**：

```js
ctx.systemPrompt.section({
  name: 'design:stance',
  order: 100,
  text: (context) => {
    if (context.agent === void 0) return '';
    return activeFor(context.agent.session) ? STANCE_TEXT : '';   // ← 关键
  },
});
```

**段永远注册着，只是不激活时 `text` 返回空串。** 切换 = 翻一个 flag，
**不涉及增删段**。

状态用 `sessionProjections` 持久化（schema 版本化、跟着会话走），也和 plan mode 一致。

### 为什么这比"运行时增删段 + 同名遮蔽"好

| | 增删段 + 遮蔽（v1） | text 函数（v2，现在这个） |
|---|---|---|
| 跨作用域 | 必须走 `agent.ctx` … | **不需要** |
| 可验证性 | ❌ 造不出子作用域，验证不了 | ✅ mock 就能验 |
| 切换成本 | 注册/注销 effect | 翻 flag |
| 持久化 | 自己管 | session projection |

v1 实测撞墙：

```
Error: prompt section "deployment:persona-prefix" is already registered
       (for a per-agent override, register through that agent's `agent.ctx` instead)
```

同作用域不能同名遮蔽。而 `createScope` 造出的子作用域**层不参与装配**，
所以那条路我验证不了、也不必要。

### 身份覆盖怎么处理

本段是**追加**在标准身份之后的（不是替换），所以正文开头有一段明确的覆盖声明：

> 你现在是**设计工作台**，不是编码助手。**下面的章程优先于本提示更早处的身份描述。**

这也是 OpenDesign discovery 层的做法（"read first — these override anything later"）。

**好处**：`tool:bash` / `tool:read` / `tool:web_search` 这些**工具指引段全部幸存** ——
而 `complete: true` 会把它们一起冲掉。

## 验证状态

两个脚本，都跑：

```bash
node scripts/mock-test.mjs     # 注册 + 状态机（11 项）
node scripts/verify.mjs        # DSH 提示段机制（隔离环境，6 项）
```

### `mock-test.mjs` — **11/11 通过**

| 检查 | 结果 |
|---|---|
| section / projection / command / tool 四件都注册 | ✅ |
| **未激活 → `text()` 返回空串**（不占 token） | ✅ |
| **激活 → `text()` 返回 75,620 字符章程** | ✅ |
| `/design status` 正确报告 | ✅ |
| `/design off` 后 `text()` 回到空串 | ✅ |
| 工具 `on` / `off` / `status`，且幂等 | ✅ |

### `verify.mjs` — 6/6 通过

验证 DSH 提示段机制本身：同作用域不能同名（约束）、`section()` 返回 disposer、
`complete:true` 独占装配、disposer 可还原。

**它明确标注了哪一条是推断而非实测** —— 详见脚本注释。

## 安装

profile 的 `package.json` 加依赖，`cordis.patch.yml` 加一行：

```yaml
- insert:
    - id: design-stance
      name: "dsh-design-stance"
```

## 内容来源

设计宪章复用 `dsh-design-prompt` 导出的 `composed`（75 KB）—— **单一真相源**，不维护两份副本。

## 与其他包的关系（2026-10-14 合并后）

```
dsh-design-stance   ← 唯一入口：/design 命令 + design_stance 工具
  └── import dsh-design-prompt/composed      ← 74 KB 宪章正文（内容模块，**不挂载**）
dsh-deck-lint       ← profile bundle（deck_lint 工具，全局）
dsh-deck-render     ← profile 级 insert（deck_render 工具，全局）
dsh-media-gen       ← profile 级 insert（media_generate 工具，全局）
dsh-design-mode     ← **已退役**（preset 卡片已从 UI 移除，仅留作实现记录）
```

**为什么这三个工具要提升到 profile 级**：以前它们挂在设计 preset 里，
只有设计模式的会话才有。既然统一用 `/design` 换装、不再切 preset，
工具就必须全局可用 —— **否则穿上人格却没有工具**。

**`dsh-design-prompt` 必须保持不挂载**：它的 `apply()` 会注册一个
`complete: true` 的段，那会**全局接管系统提示**。它现在只作为依赖被 `import`。
（它没有 `dsh.bundle.patch`，所以只能被显式的 cordis insert 或 preset 子插件挂载 ——
误挂的风险很小，但要知道。）

## 一次真实的 bug（2026-10-14，已修）

用户在一个新会话里试，报「失败」。查会话日志（`command/run` / `command/done` 事件）：

```
seq=4   /design status  → ✅ 设计装束：未穿（标准人格）
seq=13  /design status  → ✅ 设计装束：未穿（标准人格）
seq=15  /design         → ✅ 设计人格已上身
seq=18  /design on      → ❌ error: 未知参数 "on"     ← 就这里
```

**根因是我自己造的词表不一致**：

| | 接受的参数 |
|---|---|
| **命令** | `''`（穿上）· `off` · `status` |
| **工具** | **`on`** · `off` · `status` |

同一个动作两套词，用户按工具的习惯打 `on` 就撞墙了。

**修法**：命令也接受 `on`，并把 `''` 与 `on` 视为等价。

**教训**：一个动作的入口有几个，词表就必须有几个副本 —— 或者干脆只留一套。
这里 `input.hint` 写的是 `on · off · status`，而 handler 不认 `on`，
**描述和实现对不上**（和 `deck_render` 的 `slides` 那次是同一类错误）。

## 输入框旁的「设计」chip（客户端插件）

对标 plan mode 的 `PlanChip` —— `/plan` 回车后输入框旁出现「计划」chip，
点它退出。我们做同一件事：`/design` 之后出现「设计」chip。

### 它长在哪

输入区有两组（`dsh-client-ui-conversation` 的 InputBar）：

```
左边 modes 组：  conversation.input.permission · conversation.input.plan
右边 trailing：  conversation.input.right · conversation.input.model
```

本插件挂 **`conversation.input.right`** —— 真正的通用槽。
（`conversation.input.plan` 名字上是 plan 专用且无 key 注册，不跟它抢。）

### 客户端插件的模块形式

`dsh-client-modules` 解析 `package.json` 的 `exports["./client"]`，
按 `window.__ModuleLoader__.load({ id, factory })` 取模块：

```js
window.__ModuleLoader__.load({
  id: 'dsh-design-stance',
  factory: (require) => {
    const React = require('react');
    // … exports.apply / exports.inject
    return module.exports;
  },
});
```

**不需要构建步骤** —— 官方那些是 tsdown 预打包的，本插件直接写普通 JS。

`package.json` 里另外声明：

```json
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-api-remotes", "…"], "platform": "web" } },
"exports": { ".": "./index.js", "./client": "./client.js" }
```

### 客户端验证

```bash
node scripts/client-test.mjs
```

用 mock 的 `window.__ModuleLoader__` + mock React 实跑，检查：模块注册、
`apply`/`inject` 导出、slot 注册、中英文字典、以及**组件在未激活时返回 `null`**
（不占位，和 PlanChip 一致）。

## 已知边界

- 会话本身**已是设计模式**时，`/design` 没必要用（`complete` 段已经在）；`/design hard` 会因第二个 `complete` 段而报错并给出提示。
- 装束状态用 `WeakMap<agent, …>` 记 —— 一个进程里多个 agent 互不干扰。

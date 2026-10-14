# 架构：这些东西是怎么挂进 DSH 的

面向要改这个仓库的人。README 讲**用它做什么**，这里讲**它为什么长这样**，
以及几条踩过坑才明白的硬约束。

---

## 1 一个包是怎么被加载的

```
profile 的 package.json
  └─ dsh.profile.bundles: [ …, "dsh-deck-render", … ]
        │
        ├─ 宿主在 profile 的 node_modules 里按**包名**解析
        │
        └─ 读到该包的 package.json → dsh.bundle.patch: "./cordis.patch.yml"
              │
              └─ 把那份 patch 当一层叠加到 profile 配置树上
                    │
                    └─ - insert: [{ id: deck-render, name: "dsh-deck-render" }]
                          │
                          └─ 宿主按 name 解析模块 → import() → 调 apply(ctx)
```

### 硬约束：包名、导出的 `name`、patch 里的 `name`，三者必须一致

宿主按 `name` 解析模块。三处不一致的典型症状是**加载静默失败**或
「找不到插件」。`scripts/test-bundles.mjs` 就是在守这个。

### 硬约束：**没有 `dsh.bundle.patch` 的包装不上**

DSH 的 plugin-manager 装包前会 `inspect` spec，不是 bundle 就回
`not-a-bundle`，并且**把 `package.json` 与 `pnpm-lock.yaml` 回滚**。

**这条没有任何本地症状** —— 手工往 profile 的 `cordis.patch.yml` 里写 insert，
插件照样工作。只有陌生人从插件页装时才失败。本仓库最初 5 个包里 4 个踩了这个坑。

### 什么时候**不**该声明 bundle

`dsh-design-prompt` 是纯内容模块（只被 `import { composed }` 消费），
它**故意不声明** bundle —— 它不该出现在 profile 的 bundles 列表里。
非插件包那份测试会显式检查这一点。

---

## 2 系统提示：段（section）与 `text()` 函数

设计宪章是一段 system prompt。DSH 里注入提示的正确姿势**不是**运行时增删段：

```js
// ❌ v1 的做法：开关时增删段。同作用域注册同名段会报 "already registered"，
//    跨作用域遮蔽要走 agent.ctx，而那条路在 createScope 造的子作用域里不成立。
on:  ctx.systemPrompt.section({ name: 'design:stance', text: CHARTER })
off: disposer()
```

```js
// ✅ v2（现在）：段永远注册着，不激活时 text() 返回空串。
//    切换 = 翻一个 flag。不涉及增删，也就绕开了整套遮蔽问题。
ctx.systemPrompt.section({
  name: 'design:stance',
  order: 100,                                   // 身份段(0)之后，plan(500)/工具指引(1000+)之前
  text: (context) => {
    if (context.agent === void 0) return '';
    return activeFor(context.agent.session) ? CHARTER : '';
  },
});
```

`assemble()` **每轮调用一次**，所以「下一轮生效」是自然的，不需要额外的失效通知。

### `complete: true` 是个陷阱，别用

```js
ctx.systemPrompt.section({ name: 'x', complete: true, text: () => BIG })
```

语义是「把这一份当作**完整**的系统提示」—— 它会**挤掉所有其它 section**，
包括工具指引。而且**两个 `complete: true` 会让装配直接失败**。

本仓库的 `design-prompt` 早期就这么干过，防护手段只是文档里一句「别挂载」。
现在那段代码被删了，并且有测试断言它没有 `apply()`。

> 一句话：**需要替换身份用 `order` + 追加，需要可切换用 `text()` 返回空串。
> 都不需要 `complete`。**

---

## 3 会话状态放哪：三条路，一条是雷

| 做法 | 用在哪 | 代价 |
|---|---|---|
| **内存 Map** | `design-stance` 的装束状态 | 重启即失。对「会话内状态」正合适 |
| **sessionProjections** | 客户端 chip 读的状态 | 需要从**已知**事件类型派生，见下 |
| ~~`session.append(自定义类型)`~~ | **绝对不要** | **整个会话日志读不出来** |

### 为什么第三方插件不能写自定义事件类型

`dsh-session-persistence` 的校验：

```js
if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true) throw …
```

`KNOWN_SESSION_EVENT_TYPES` 是 `@deepseek-ai/dsh-session` 里的**固定集合**
（`plan/mode` 之所以能用，是因为它本来就在表里）。第三方插件既不能扩展它，
`session.append()` 也不暴露 `ignorable`。写了之后：

```
SessionQueryError: session "…" contains event type "design-stance/mode" (seq 16)
unknown to this harness and not marked ignorable; refusing to interpret the log
```

**整个会话废掉。**

`design-stance` 现在的做法：投影只监听**已知**事件
（`command/run` / `command/done`，且 `name === 'design'`），
不写任何自定义类型。

---

## 4 客户端（浏览器）半身

`design-stance` 有一个客户端 chip，声明方式：

```json
"dsh": {
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
}
```

- 入口在 `exports["./client"]`，模块形态是
  `window.__ModuleLoader__.load({ id, factory: (require) => … })`
- **不需要构建步骤**。宿主按 `plugins/??<pkg>/client.js&rev=<hash>` 提供，
  `&rev` 是必需的（省掉会 404）
- 输入栏的槽位：`conversation.input.{permission,plan,left,right,model}`。
  其中 **`kind: "list"` 的槽位必须带 `options.id`** —— 漏了会抛
  `list slot "conversation.input.left" requires options.id`，而且**错误被
  `slots.inject(…, () => register(…))` 的回调吞掉**，界面上没有任何痕迹。
  调客户端插件**必须开浏览器控制台**。

chip 的渲染条件照抄 `PlanChip`：不激活时 `return null`（不占位）。

---

## 5 两道闸门为什么这么设计

### 门一：渲染 → 看图

设计任务的最大失效模式是「代码看着对、渲染出来不对」。规则抓不到「不好看」，
所以必须让模型**看**。

但这个机制本身会**静默失效**，两次都踩过：

| 失效 | 症状 | 现在怎么防 |
|---|---|---|
| 翻页只认一个类名 | N 张字节相同的图 + 报告成功 | 两套类名都翻 + 内联样式兜底 |
| 把运行时克隆页当独立页 | 页数翻倍，多出来的渲成白页 | 只看**祖先是否隐藏**，不看元素自身的 display |
| 无从察觉 | —— | 返回 `distinct` + SHA1 指纹自查，重复就 warning |

**设计原则：闸门可以报错，不可以静默。** 遇到新的不确定性时，优先让它
**喊出来**（warning / 数字信号），而不是猜一个「应该对」的行为。

### 门二：确定性规则

`deck_lint` 把审美规则变成**代码判定** —— 同一条规则，弱模型会被抓住，
强模型会被放过，标准不随模型换代漂移。它**不**依赖 DOM 结构或类名约定
（只有门一有那个耦合），所以和门一是正交的。

---

## 6 为什么人格是「段」而不是 preset

agent preset 在**会话创建时**就定了。而真实工作是**阶段式**的：

```
调研 → 设计构建 → 交付
```

模式是会话级的，工作是阶段级的，两者错位，人就得到处切会话。
把「模式」降级成「换装」之后，同一会话里可以先按标准人格调研、
`/design` 穿上再做 deck —— 这正是 `design-stance` 存在的理由。

**代价与边界：**

- 装束状态在内存里，重启后要在新会话里重新 `/design`（设计人格本来就是会话内状态）
- 斜杠命令在**全新会话的欢迎页**上不可用（`command catalog requires a retained
  session`，`/plan` 同样如此）—— 所以额外提供了 `design_stance` **工具**，
  它随 agent 存在，第一轮就能用

---

## 7 目录约定的两条

1. **`packages/*` 的目录名不带 `dsh-` 前缀**（`packages/deck-render/`），
   但 npm 包名带（`dsh-deck-render`）。目录名是给眼睛看的，包名是给解析器看的。
2. **技能用 symlink 安装**（`scripts/install-skills.sh`）。技能是纯文件、无构建，
   symlink 之后改仓库即刻生效。跨文件系统 symlink 不可用时降级 `--copy`。

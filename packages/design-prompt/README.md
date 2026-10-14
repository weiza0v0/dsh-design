# dsh-design-prompt

**设计宪章的内容模块。** 8 章、约 77 KB，从
[OpenDesign](https://github.com/nexu-io/open-design)（Apache-2.0）抽取并重组。

```js
import { composed, meta } from 'dsh-design-prompt';

composed;          // 拼好的完整正文（8 章用 \n\n---\n\n 连接）
meta.parts;        // [{ file, bytes }, …]
meta.totalBytes;   // 77861
```

---

## ⚠️ 它**不是**插件 —— 这是有意的

本模块**没有导出 `apply()`**，也没有 `inject`。把它加进 profile 的
`dsh.profile.bundles` 不会挂载任何东西。

### 为什么（这段历史值得留着）

早期版本把自己做成了插件，注册一个 `complete: true` 的 section：

```js
ctx.systemPrompt.section({ name: 'design:composite', complete: true, text: () => COMPOSED })
```

`complete` 的语义是「把这一份当作**完整**的系统提示」，于是它会**挤掉所有其它
section** —— 包括工具指引。而当时防住这件事的手段，只是三份 README 里各写一句
「别挂载这个包」。

**把「别做 X」写成文档是最弱的护栏**：总有人不读，而且读了也不会在装错时收到
任何信号。真正的问题是它**不需要**成为插件 —— 内容只被 `import { composed }` 消费。
所以 `apply()` 被删掉了。

现在有测试守着这条：`npm test` 会断言 `apply === undefined`，
**不让那颗地雷长回来**。

---

## 谁在用它

[`dsh-design-stance`](../design-stance) —— 它把 `composed` 交给自己的 `text()` 函数，
设计人格生效时才注入：

```js
ctx.systemPrompt.section({
  name: 'design:stance',
  order: 100,
  text: (context) => activeFor(context.agent.session) ? STANCE_TEXT : '',
});
```

这是照 DSH 的 **plan mode**（`@deepseek-ai/dsh-plan-mode`）做的：
**section 常驻，`text()` 不激活时返回空串。** 切换只翻一个 flag ——
不增删 section，也就不需要 `complete`。

---

## 内容从哪来

| 文件 | 上游来源 | 改了什么 |
|---|---|---|
| `00-discovery.md` | OD 的 discovery / planning / huashu 哲学层 | 抽取、改写为单文件章节 |
| `01-charter.md` | `official-system.ts` 的 `OFFICIAL_DESIGNER_PROMPT` | 抽取；filesystem 档占位符已填 |
| `02-directions.md` | `directions.ts` 方向库 | 抽取（方向 + OKLch 色板 + 字体栈） |
| `03-craft-typography.md` | `craft/typography.md` | 抽取 |
| `04-craft-color.md` | `craft/color.md` | 抽取 |
| `05-craft-anti-ai-slop.md` | `craft/anti-ai-slop.md`（另参考 refero_skill） | 抽取 |
| `06-deck-framework.md` | contracts 的 `renderDeckFrameworkDirective('filesystem')` | 抽取 |
| `07-resources.md` | — | **本仓库自撰**：两道门 + 素材索引 |

**逐文件的许可与修改说明见仓库根的
[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md)。**

---

## 测试

```bash
npm test      # 15 项
```

除了内容完整性（8 章非空、总量不缩水、关键章节在位），**主要就是守
「它不再是个插件」这条**。

## 改内容的注意事项

- `index.js` 里的 `ORDER` 数组决定拼接顺序，文件名前缀即顺序。
  加章节要同时改 `ORDER` 和 `scripts/test-content.mjs` 里的断言数。
- 模块加载时会**立刻抛错**（缺文件 / 空文件），不让拼不完整的宪章上线。
- 改动了从上游抽取的内容，请同步更新 `THIRD-PARTY-NOTICES.md` ——
  那是 Apache-2.0 的要求。

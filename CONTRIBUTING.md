# Contributing

欢迎提 issue 和 PR。这个仓库是**给 agent 用的基础设施**，所以它对「失效」的容忍度
比一般项目低得多 —— 下面几条不是风格偏好，是这个项目的性质决定的。

---

## 开发环境

```bash
git clone <repo> && cd dsh-design
pnpm install
npm test              # 契约检查 + 全部工作区测试（307 项）
```

需要 **Node 22.19+ 或 24+** 与 **pnpm 12**。渲染测试还需要一个 Chromium
（`pnpm --filter dsh-deck-render exec playwright install chromium`）。

### 两条容易踩的工作区约定

`pnpm-workspace.yaml` 里有两项是**故意的**，改之前请先读这里的理由：

| 设置 | 值 | 为什么 |
|---|---|---|
| `nodeLinker` | `hoisted` | 与 DSH 宿主 profile 一致。插件靠宿主解析 `@deepseek-ai/*` |
| `autoInstallPeers` | `true` | `@deepseek-ai/dsh-tools` 声明了 11 个 DSH 内部 peer，它的入口一上来就 `import cordis`。不自动补齐就 `ERR_MODULE_NOT_FOUND` |

---

## 最重要的两条规矩

### ① 插件必须声明 `dsh.bundle.patch`

DSH 的 plugin-manager **只接受声明了 bundle patch 的包**，否则回
`not-a-bundle` 并**回滚安装**。

这条极其容易踩，因为**本地完全没有症状** —— 手工往 profile 的
`cordis.patch.yml` 里写一行 insert，一切正常工作，只有陌生人用插件页装时才失败。

`npm run test:bundles` 就是守这条的。新增插件包时，照
`packages/deck-lint/` 的样子加：

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

```yaml
# cordis.patch.yml
- insert:
    - id: your-plugin-id      # profile 内唯一
      name: 'dsh-your-plugin' # 必须 == npm 包名 == index.js 导出的 name
```

### ② 第三方插件**绝不能**往会话日志写自定义事件类型

```js
session.append('my-plugin/state', …)   // ← 会让整个会话日志读不出来
```

`dsh-session-persistence` 用一张**固定的** `KNOWN_SESSION_EVENT_TYPES` 表白名单校验
（`plan/mode` 之所以能用，是因为它本来就在表里）。第三方插件既不能扩展它，
`session.append()` 也不暴露 `ignorable` 参数。写了之后：

```
SessionQueryError: … contains event type "xxx" (seq 16)
unknown to this harness and not marked ignorable; refusing to interpret the log
```

**整个会话废掉。** 需要会话内状态就放内存（见 `design-stance` 的做法），
或者只从**已知**事件类型派生（`command/run` / `command/done` …）。

---

## 测试策略：每一层守什么

```bash
npm test                                        # 全部
node scripts/test-bundles.mjs                   # ① 契约：装得上
pnpm -r --workspace-concurrency=1 test          # ② 各包
```

| 层 | 守什么 | 为什么值得单独一行 |
|---|---|---|
| `scripts/test-bundles.mjs` | 每个插件包都声明了 bundle patch，三处名字一致 | 没有它，4/5 个包装不上而本地毫无症状 |
| `test-render.mjs` | 渲染的 5 种约定/陷阱 | 闸门静默失效时不会报错，只会交出一叠相同的图 |
| `test-tool.mjs` | `execute()` 返回值 ↔ `output.schema` ↔ 模型看到的文本 | 曾经「算出来了但忘记接上」，lib 测试全绿而模型看不到 |
| `test-content.mjs` | 宪章完整 + **没有 `apply()`** | 防止 `complete: true` 那颗地雷长回来 |
| `test-adapters.mjs` | 两条协议的全部出网路径 | 那些接口**要花钱**；未 mock 的调用会直接失败 |

**写测试时的两条默契：**

- **不出网、不花钱。** 需要网络的用桩（`test-adapters.mjs` 是范例）。
- **测试名写「为什么」**，不只是「什么」。这个仓库的注释密度是刻意的 ——
  它记录的是踩过的坑，不是代码在做什么。

---

## 加一个新插件包

1. `packages/<short>/`，`package.json` 的 `name` 用 `dsh-<short>`
2. `index.js` 导出 `name`（== 包名）与 `apply(ctx)`
3. 加 `cordis.patch.yml`，`package.json` 里声明 `dsh.bundle.patch`，
   `files` 数组要包含它
4. `peerDependencies` 声明 `@deepseek-ai/dsh-tools`（宿主机提供），
   `devDependencies` 里装一份以便跑测试
5. 补 `scripts.test`、`README.md`、`LICENSE`
6. `npm run test:bundles` 必须过

---

## 更新上游内容

`skills/od-deck/**` 与 `packages/design-prompt/content/**` 大部分来自
[OpenDesign](https://github.com/nexu-io/open-design)（Apache-2.0）。
改动它们时：

1. 对照 `THIRD-PARTY-NOTICES.md` 里的来源表定位上游文件
2. **同步更新该表里的「改了什么」一栏** —— 这是 Apache-2.0 对衍生作品的要求，
   不是可选的礼貌
3. 如果你把上游版本挪了，更新 `THIRD-PARTY-NOTICES.md` 里 pin 的 commit

---

## 提交与 PR

- 提交信息用中文或英文都行，但要说清**为什么**改 —— 只写「fix bug」的 PR 会被问。
- PR 描述里请写：改了哪个包 / 跑了什么验证 / 有没有需要同步 `THIRD-PARTY-NOTICES.md`。
- 动到渲染或 lint 行为时，**请附一张渲染出来的图或一条真实输出**。
  这类改动很难靠读代码判断对错。
- CI 必须绿。渲染 job 在容器里需要 `DECK_RENDER_ARGS="--no-sandbox --disable-dev-shm-usage"`
  （CI 已经配好）。

## 许可

贡献即表示你同意以本仓库的许可分发（自己的代码 MIT；从 OpenDesign 衍生的部分
保持 Apache-2.0 溯源，见 `THIRD-PARTY-NOTICES.md`）。

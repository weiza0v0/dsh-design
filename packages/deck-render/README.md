# dsh-deck-render

把 HTML deck / 页面渲染成 PNG，让 agent **看自己的产出**再改。

DSH 工具（`deck_render`）+ 独立 CLI。跨平台。

## 为什么需要它

设计类任务最大的失效模式是「代码看着对、渲染出来不对」——

- 中文字体回退成默认无衬线
- 行高不够，中文标题两行贴在一起
- 色板没绑对，出来一片灰
- 内容溢出容器被裁掉

**规则再全也抓不到「这页不好看」。** 只有把渲染结果给模型看，它才知道要改什么。

工具一次产出「拼图 + 单页 PNG」。模型 `read_image` 那张拼图就能**一次看全**，
比逐页读图省 N 倍 token。

## 安装

```bash
npm install dsh-deck-render          # 作为 DSH 插件
# 或直接用 CLI
npx dsh-deck-render deck.html
```

需要 Node 22.19+ 和一个浏览器（见下）。

### 浏览器从哪来（按优先级）

| 方式 | 参数 | 说明 |
|---|---|---|
| 连已有调试端口 | `cdp` | 最省事。用户已有浏览器在跑时用它 |
| 指定可执行文件 | `browser` | 交给 Playwright 拉起 |
| 都没给 | — | 先试默认 `127.0.0.1:9223`，不行再用 Playwright 自带 Chromium |
| 跳过那个默认探测 | 环境变量 `DECK_RENDER_NO_DEFAULT_CDP=1` | **自动化/CI 用**。见下方「静默接管」 |

Playwright 自带浏览器需要装一次：

```bash
npx playwright install chromium          # 或本包自带的：npx playwright-core install chromium
```

## 用法

### 作为 DSH 工具

```
deck_render(path="/abs/path/deck.html")
```

参数：

| 参数 | 说明 |
|---|---|
| `path` | **必填**，HTML 文件路径 |
| `out_dir` | 输出目录，默认 HTML 同级 `.render/` |
| `cdp` | 调试端口 endpoint，如 `http://127.0.0.1:9333` |
| `browser` | 浏览器可执行文件路径 |
| `slides` | 只渲某些页：`"3"` / 区间 `"2-5"` / 列表 `"2,6,9,16"` / 混合 `"1-3,7"` |

### 作为 CLI

```bash
node cli.mjs deck.html
node cli.mjs deck.html --cdp http://127.0.0.1:9333 --out ./shots
node cli.mjs deck.html --json
```

### 想让渲染无感（不弹标签页）

连用户的常驻浏览器会弹标签页。起一个**专用 headless 实例**：

```bash
./scripts/start-headless-browser.sh 9333          # 自动找浏览器
DECK_BROWSER=/path/to/chrome ./scripts/start-headless-browser.sh 9333
./scripts/start-headless-browser.sh --stop        # 只关本脚本起的那个
```

然后把 `cdp="http://127.0.0.1:9333"` 传给工具。

## 跨平台

**macOS / Linux / Windows / WSL 都适用**，只有一处平台分支。

| 关注点 | 处理方式 |
|---|---|
| 浏览器发现 | 按优先级试 CDP → 指定文件 → Playwright 自带；`start-headless-browser.sh` 会扫常见安装路径 |
| `file://` 路径 | **唯一平台分支**：若目标浏览器在 Windows 侧（由 UA 判定），路径换算成 `D:\…` —— 否则 Windows 浏览器读不懂 `/mnt/d/…` |
| 拼图合成 | **用 Playwright 里的 CSS grid 合成，不依赖 ImageMagick** —— 早期版本用 `montage`，给使用者加了系统依赖 |
| 拼图里的图片 | **base64 内嵌**，而不是 `file://` 引用 —— 否则目标浏览器读不到渲染输出目录（尤其跨 WSL/Windows 时） |
| 只借不关 | 连接别人的浏览器时**绝不调用 `close()`** —— Playwright 的 `connectOverCDP` + `close()` 会把那个浏览器真的关掉 |

### 实战修正（2026-10-14，来自一次真实 22 页 deck 会话）

一次真实会话（DSH，`workspace-write` 沙箱）暴露了三个问题，均已修复：

### ① 本机浏览器发现（最重要）

**症状**：`browserType.launch: Executable doesn't exist at …/chromium_headless_shell-1223/…`

**根因**：Playwright 自带的浏览器**按版本号锁定** —— `playwright-core@1.60.0` 只认 revision `1223`，
而机器上装的是 `1243`。于是「默认路径」（不传 `cdp` / `browser`）**必然失败**。

**代价**：那次会话有约 **12 步（≈40% 时间）**花在手工排障上 ——
装 Playwright、找不到 `libnspr4.so`、`find /` 超时、没有 root 装不了 apt 包、
最后下载解压 NSS 库到工作区、手工起 Chrome 再传 `cdp`。

**修法**：`discoverLocalBrowser()` 先在本机找现成 Chrome（Playwright 缓存的任意 revision +
系统安装路径），用 `launch({ executablePath })` 拉起 —— **`executablePath` 绕过版本检查**。
另外 `discoverChromeLibDirs()` 会在 Linux 上找含 `libnspr4.so` 的目录并注入 `LD_LIBRARY_PATH`。

现在默认路径实测可用：`via: launched local chrome-headless-shell`。

### ② `slides` 参数：文档承诺了没实现的能力

`slides` 的描述写着区间（`"2-5"`），代码却对区间直接 `throw`。模型照描述传
`slides="2,6,9,16"` 就撞到错误。**文档承诺的能力要么实现、要么别写。**

现在支持单页 `"3"` / 区间 `"2-5"` / 列表 `"2,6,9,16"` / 混合 `"1-3,7"`，升序去重。

### ③ 局部渲染会清空整个输出目录

旧实现在**每次**渲染开头删掉所有 `slide-*.png`。所以「只渲第 16 页」会把 1–15、17–n
**全删掉** —— 而调用方往往正等着读那几张图。那次会话里模型自己诊断出了这点：

> *"rendering with slides="16" seems to have overwritten the .render dir (only slide-16.png remains?)"*

现在只清「本次要重渲的那几页」，其余保留。

### ④ 翻页押注单一类名 —— 闸门静默失效（2026-10-14 复查发现）

**这是本工具最危险的一个缺陷，因为它没有任何外部症状。**

原实现翻页只 toggle `.active`：

```js
document.querySelectorAll('.slide').forEach((el, n) => el.classList.toggle('active', n === idx));
```

但同一体系里的两个交付物用了**两套不同的激活类约定**：

| 来源 | 激活类 |
|---|---|
| 章程 canonical skeleton、`html-ppt` 家族 | `.slide.active` |
| **`od-deck/templates/deck.html` + `assets/base.css`**（`runtime.js` 也只 toggle 它） | **`.slide.is-active`** |

而 `od-deck/SKILL.md` 明确让 agent「起点用 `templates/deck.html`」。实测后果：

```
deck_render(od-deck/templates/deck.html)
→ 报告 "12 page(s)" 成功

md5sum slide-*.png | sort | uniq -c
   12 1052145d5a3abf1b8dda450d8637d8da     ← 12 张字节完全相同
```

模型 `read_image` 看到的是**第 1 页重复 12 次**，却被告知「12 页都渲好了」——
于是它会得出「已验收」的结论。**静默失效比报错危险得多**：报错会让人去修，
静默失效会让人基于假象决策。

修法分两层：

**① 翻页不再押注类名**（`slidePages()`）：`active` / `is-active` 都翻，
再叠一层内联样式兜底（目标 `opacity/transform/z-index` 强制可见，其余
`display:none !important`）。完全不依赖任何框架的类语义。

**② 排除运行时克隆页**：修完类名后仍是 7 唯一 / 12 页。根因是
`od-deck/assets/runtime.js:167` 为「概览面板」把每页 `cloneNode(true)` 进
`.mini-slide`，而 `.overview{display:none}`（`base.css:125`）——
`querySelectorAll('.slide')` 数到 **6 真 + 6 克隆**，克隆页渲出来全是空白。

判别规则：**只看祖先是否被隐藏，不看元素自身的 `display`。**

| 场景 | 祖先 | 判定 |
|---|---|---|
| od-deck 克隆页（在 `.overview` 里） | `display:none` | 排除 ✅ |
| html-ppt 非活动页（`display:none` 在元素自己身上） | 正常 | 保留 ✅ |
| 手写、在文档流里的多页 | 正常 | 保留 ✅ |

必须**只看祖先**：本函数自己会把非目标页设成 `display:none`，
若把元素自身的 `display` 也算进去，第一次调用之后剩下的页就全被排除了。

**③ 重复页检测（兜底）**：按 SHA1 指纹自查，出现像素级相同的页就在结果里报警。

```
6 page(s) · 6 distinct → /path/.render
⚠️ 1 warning(s):
  - 3 页里有 1 页与其它页**像素级完全相同** —— 翻页很可能没生效 …
```

用 warning 而不是抛错：**真的重复内容**（刻意一样的章节分隔页）是合法的，
不能因为检测到重复就拒绝交付 —— 让模型自己判断。

返回结果里新增 `distinct` 字段（唯一页数）。**`pages` 和 `distinct` 不相等就是信号**：
将来第三种约定撞上来，这个数字会先变，warning 会紧跟着喊出来。

### 回归测试

```bash
cd <本包> && npm test
```

**39 项断言，分两层：**

| 文件 | 覆盖 | 断言 |
|---|---|---|
| `scripts/test-render.mjs` | 渲染核心：5 种约定/陷阱（`.active` / `.is-active` / 无激活类 / 隐藏面板里的克隆页 / 真重复内容） | 15 |
| `scripts/test-tool.mjs` | 工具面：`execute()` 返回值 ↔ `output.schema` ↔ 模型看到的文本，三者对账 | 24 |

**这两个测试存在的唯一理由是：让闸门不能静默失效。** 它失效时不会报错，
只会交出一叠相同的图。

第二个是补的 —— 第一次真栽在这一类坑上：我给 `renderDeck()` 加了 `distinct`，
也写进了 `output.schema`，`summarize()` 也读了它，**唯独忘了在 `execute()` 的
返回对象里带上**。于是"算出来了"和"模型看得到"之间断了线：

```
renderDeck() → 算出 8                              ✅
summarize()  → typeof undefined !== 'number' → 省略 ❌
schema       → 声明了 distinct，却永远填不上        ❌
```

lib 的单元测试全绿，模型看到的文本里却没有这个信号 —— 加了测试、跑绿了，
信号在真实会话里从未出现过。所以 `test-tool.mjs` 对每个字段做**双向对账**：
`execute()` 返回的必须被 schema 声明（否则可能被输出校验丢掉），
schema 声明的必须被 `execute()` 填（否则是死字段）。

### 验证

在一份真实的 22 页中文 deck 上实测：

| 场景 | 结果 |
|---|---|
| 全量渲染（默认路径，不传 cdp） | 22 页 ✅ |
| `slides="2,6,9,16"` | 正好渲 4 页 ✅ |
| 局部渲染后 | 22 张全在，未被误删 ✅ |
| `od-deck/templates/deck.html`（修复前） | 12 页，**1 个唯一** ❌ |
| `od-deck/templates/deck.html`（修复后） | 6 页，6 个唯一 ✅ |


### ⚠️ 默认会「静默接管」机器上开着的调试端口

不传 `cdp` 也不传 `browser` 时，renderer 会先探测 `127.0.0.1:9223`。**只要那里有东西在听，
它就接管** —— 包括跟你毫不相干的浏览器（比如给网页自动化用的那只 Windows Chrome）。

后果是渲染结果**随环境漂移**，而且报错很绕：那只是 Windows 浏览器，读不到 WSL 的 `/tmp`，
于是渲染一个临时文件会报「目标浏览器在 Windows 侧，但路径不在挂载盘」。

**所以自动化、CI、本地测试一律设：**

```bash
export DECK_RENDER_NO_DEFAULT_CDP=1   # 跳过默认探测，老实拉一只自己的浏览器
```

显式传 `cdp=` 仍然优先生效。本仓库的渲染测试就是这么做的 —— 否则「测试红绿」会由
你机器上碰巧开着什么决定，不由代码决定。

## 已知限制

- **从 WSL 拉起 Windows 浏览器（`.exe`）不可靠**：调试端口可达性、进程生命周期、
  文件句柄释放都要额外处理，实测不稳定，且会在共享盘留下 Windows 句柄锁死、
  WSL 删不掉的 profile 目录。所以 `browser` 参数只对**原生可执行文件**走 launch；
  Windows `.exe` 需要配合 `cdp` 使用（用 `start-headless-browser.sh` 起）。

  这个 helper 本身是**可行的**（它用 `--remote-debugging-port` 起 Windows Chrome，
  实测端口正常开放）—— 不可靠的是「工具内联拉起 + 用完自己关掉」那条路。

- **渲染视图固定 1920×1080**（按 deck 画布设计）。要别的尺寸请提 issue。

- **只识别 `.slide` 作为页面单位**，且**排除祖先被隐藏的 `.slide`**（运行时克隆进
  概览/打印面板的副本不算独立页）。非 deck 的普通 HTML 渲染成一整页。

## 它不做的事

- 不做设计决策 —— 那是 skill / 模型的事。这个工具只负责「让你看见」
- 不生成图片/视频 —— 只渲染已有的 HTML
- 不拼 PPTX —— 输出是 PNG（要可编辑 PPTX 请用 python-pptx 那条线）

## License

MIT

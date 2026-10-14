# 交付前的两道门（顺序不能反）

**写完或改完任何 HTML 交付物，必须走这两道门，缺一不可。** 它们覆盖的问题集不重叠：
门一看「不好看」，门二抓「AI 味」。

---

## 门一 · 用眼睛看：`deck_render` + `read_image`

```
deck_render(path="<你的 HTML 绝对路径>")
```

它产出一张**拼图**（所有页面并排）和每页的单图，然后用 `read_image` 打开那张拼图 ——
**一次调用就能看全**，不需要逐页读图。

```  
deck_render(path="/abs/path/deck.html")
read_image(file_path="<返回的 sheet 路径>")
```

**这一步不是可选的。** 代码看着对、渲染出来不对劲是最常见的情况 ——
中文字体回退、行高把标题挤在一起、色板没绑对、内容溢出容器，**只有看图才发现**。
规则再全也抓不到"这页不好看"。

看图时逐条问自己：

- 层次对不对？一眼能不能看出哪个是标题、哪个是辅助信息
- **中文行高够不够**？标题两行有没有贴在一起（CJK 需要 `line-height: 1.3–1.4`，
  比拉丁的 1.0–1.2 大）
- 留白够不够？还是塞满了
- 颜色是从方向库/设计系统绑来的，还是随手写的
- 有没有溢出、截断、错位
- 每页的信息密度是否一致（有的页挤、有的页空）

**看到问题就改，改完再渲染一次。两三轮是正常的。**

### 渲染相关

- 默认连本机已运行的调试端口；要指定用 `cdp` 参数（如 `cdp="http://127.0.0.1:9333"`）
- **想让渲染不弹标签页**：先起一个专用 headless 实例，再把它的 endpoint 传给工具 ——
  见 `~/.dsh` 侧说明或本仓库 `scripts/start-headless-browser.sh`
- 只渲某一页：`slides="3"`

---

## 门二 · 用规则查：`deck_lint`

视觉确认之后再跑规则闸门：

```
deck_lint(path="<你的 HTML 绝对路径>")
```

- **P0 必须清零**才算交付
- P1 逐条判断：修掉，或说明为什么不修
- P2 可忽略
- 每次改动 markup/样式后重跑

每条 finding 带 `snippet` —— 怀疑是误报就用 snippet 核对后说明理由，不要无视规则。

---

## 设计系统（品牌契约）

目录：`~/.dsh/skills/od-deck/design-systems/<name>/DESIGN.md`

已收录 20 套。按场景挑**一套**，读取它的 DESIGN.md，把其中的色板、字阶、间距、
字体栈当作权威 token。**不要混用两套的 token。**

| 场景 | 建议 |
|---|---|
| 学术论文 / 期刊 / 研究报告 | `publication` `paper` `editorial` |
| 技术文档 / 工程汇报 | `mono` `minimal` |
| 大留白 / 克制 / 高端 | `spacious` `refined` `elegant` |
| 产品发布 / 商业提案 | `stripe` `linear-app` `notion` |
| 通用稳妥 | `default` `clean` `professional` `premium` |

## 版式与组件

- 版式骨架库：`~/.dsh/skills/od-deck/references/layouts.md`
- 动效库：`~/.dsh/skills/od-deck/references/animations.md`
- 演讲者备注：`~/.dsh/skills/od-deck/references/presenter-mode.md`
- deck 引擎（seed）：`~/.dsh/skills/od-deck/templates/deck.html`
- 五维自评：`~/.dsh/skills/od-deck/craft/critique.md`
- 十六条规定性规则与标准修法：`~/.dsh/skills/od-deck/references/lint-rules.md`

## 视频：把 HTML 变成 MP4（本地渲染，零 API 成本）

需要动态交付物时，用 **HyperFrames** —— HTML 是唯一真相源，和 deck 同一套思路，
只差一个渲染器。**详细做法见 `hyperframes` 技能**（会自动加载）。

```bash
HF=~/.dsh/skills/hyperframes/scripts/hf.sh
$HF lint .<name>                                        # 先校验
$HF render -c .<name>/index.html -o <name>.mp4          # 6 秒 1080p ≈ 35 秒
```

构图源文件放进点号目录（`.<name>/`），只把 `.mp4` 留在工作区。

## 图片 / 视频 / 语音：调用生成模型（BYOK，要花钱）

```
media_models()                                  # 先看可用模型与已配置的凭据
media_generate(model="fal/flux-schnell", prompt="…")
media_generate(model="fal/veo-3", prompt="…", duration="5")
media_generate(model="openai/tts", prompt="要朗读的文本", voice="alloy")
```

**这些调用要用户自己付费**，所以**不要试探性生成** —— 先跟用户确认主体、风格、画幅。
视频会阻塞 1–5 分钟（最长 15 分钟），要提前说明在等。

生成的图片先用 `read_image` 看一眼再给用户。

> 与 HyperFrames 的分工：**动效/片头/转场** → HyperFrames（本地，免费）；
> **一张真实照片/一段实拍感镜头/一段配音** → `media_generate`（调模型，付费）。

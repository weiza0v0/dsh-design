---
name: od-deck
description: 把材料做成有设计判断的演示文稿（HTML deck / 幻灯片）。含 6 步工作流、20 套品牌级设计系统（DESIGN.md）、8 套风格方向、版式库、动效库与五维自检清单。用户说「做 PPT / 幻灯片 / deck / 演示文稿」「把这堆材料讲清楚」「排版好看点」「这份 deck 哪里不对」时加载。
whenToUse: 需要生成或重构演示文稿、slides、deck；或需要为一页内容选择字体/配色/版式；或要对已有页面做设计评审。纯数据读写 PPTX 不需要本技能（用 office-pptx）。
---

# od-deck · 演示文稿设计

从 [OpenDesign](https://github.com/nexu-io/open-design)（Apache-2.0）抽取的可移植设计资产。
**这里的价值不是"更多主题"，而是把审美变成可执行的决策链。**

上游许可：`html-ppt` 来自 [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)（MIT，见 `LICENSE-html-ppt`）；
五维评审来自 [alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design)。

## 核心原则

**平台负责版式、几何、配色、字阶和装饰；你只负责"这一页在做什么"和"上面放什么内容"。**
一旦你开始手写 `padding: 37px` 这类魔法数字，就已经绕过了这套系统，成品会立刻回到"AI 味"。

## 工作流（单向，不要跳步）

```
意图 → 叙事 → 选方向 → 绑设计系统 → 写页面 → 自检 → 渲染
```

### 1 · 意图
先问清楚，别猜：**受众是谁、要他们做什么决定、讲多久、什么场合**。
受众决定信息密度；决策目标决定哪一页是全场重点。

### 2 · 叙事（金字塔）
先出**大纲**再出画面。每页写一句"这页要让听众记住什么"，写不出来的页就是多余的。
参考 `references/layouts.md` 找合适的页型，不要先想视觉。

### 3 · 选方向（8 选 1，不要混）
`directions/<name>/<name>.md` + 同目录 `references/checklist.md`：

| 方向 | 适合 |
|---|---|
| `after-hours-editorial-template` | 深度长文、行业观察、有观点的叙述 |
| `field-notes-editorial-template` | 田野笔记、研究过程、一手材料 |
| `editorial-burgundy-principles-template` | 原则/宣言/价值观，强主张 |
| `digits-fintech-swiss-template` | 数字密集、财务、指标看板 |
| `swiss-creative-mode-template` | 克制的国际主义网格，学术/技术 |
| `swiss-user-research-video-template` | 用户研究、访谈结论 |
| `8-bit-orbit-video-template` | 轻松、复盘、非正式 |
| `weread-year-in-review-video-template` | 年度回顾、故事线 |

**一个 deck 只用一套方向。**混搭是 AI 味最主要的来源。

### 4 · 绑设计系统（`design-systems/<name>/DESIGN.md`）
`DESIGN.md` 是品牌契约：色板、字阶、间距、组件、语气、**反模式清单**。

学术/技术类优先看：`publication` `paper` `editorial` `mono` `minimal` `spacious` `refined`。
品牌级参考：`stripe` `linear-app` `apple` `notion` `figma`。

如果要"照着这张图/这个网站的感觉做"，先走 `craft/reference-design-contract.md`，
把感觉固化成一份 `DESIGN.md`（sections: visual-theme / color / typography / spacing /
layout / components / motion / voice / **anti-patterns**），再动手。

### 5 · 写页面
起点是 `templates/deck.html`，样式在 `assets/base.css`，字体在 `assets/fonts.css`，
导航/放映在 `assets/runtime.js` —— **整套复制到你项目里，不要改 `base.css`**。
版式、动效、演讲者备注分别查 `references/layouts.md` / `animations.md` / `presenter-mode.md`。
完整示例在 `references/full-decks.md`。

导航约定（`runtime.js` 已实现）：`←/→` 翻页、`Home/End` 首末、`N` 备注、`Esc` 收起。
发布前自检：每页都带 theme class；**不要连续 3 页同一 theme**。

### 6 · 自检（这一步不能省）
用 `craft/critique.md` 的五维评审先审自己，再交付：
**Philosophy / Visual hierarchy / Detail / Functionality / Innovation**，各 0–10，
输出三张清单：**Keep / Fix / Quick-wins**。

高频扣分项，逐条对照：
- 一页讲了两件事（拆页，别缩字号）
- 大标题下面直接跟正文，中间没有呼吸
- 连续三页同一种版式（单调）
- 数字没有参照物（"42%" 要说明相对什么）
- 加了没意义的装饰（发光、渐变、emoji 图标、无来源的配图）
- 图/表没有来源脚注

### 6.5 · 门禁 `deck_lint`（代码判定，不能省）

上面是"用眼睛看"，这条是**代码判定**。两者互补，缺一不可：

```
deck_lint(path="/绝对路径/你的deck.html")
```

- **P0 必须清零才允许交付。** P0 是"回归成 AI 味"的硬信号，不是建议。
- P1 逐条判断：修掉，或明确说明为什么不修。
- P2 可以忽略。
- **每次改动 markup 或样式后重跑**，哪怕只是调一行颜色。

`verdict` 为 `block` 时，不要向用户宣布完成 —— 按 finding 的 `fix` 改文件，再跑一遍。

每条 finding 都带 `snippet`。**如果判断是误报，用 snippet 核对后说明理由**，而不是无视规则。
规则的完整清单与标准修法见 `references/lint-rules.md`；第一次跑之前先读它，
这样你能一次改对，而不是被工具牵着走一轮。

### 6.6 · 交付 .pptx 前：跨渲染器几何检查

**这一条和上面所有检查都不同** —— 上面都在**同一个渲染器**里做，
抓不到"渲染器相关"的问题。这条是唯一需要**跨引擎**验证的门。

#### 病根是几何，不是行高

python-pptx 里每段文字住在一个**形状框**里。不同渲染器
（PowerPoint / LibreOffice / WPS）对**"文字装不下框"**的处理不一样：

- 有的把框撑开
- 有的裁掉
- 有的让文字**溢出框外**，撞到邻居

所以只要存在下面任一种情况，**同一份文件在不同软件里就是两个样子**：

1. **相邻文字框重叠** —— 哪怕视觉上还有空隙（框比字大）
2. **框高装不下自己的内容** —— 按「行数 × 字号 × 行高」算出来的高度小于框高

**真实案例**（一份 22 页 deck 的封面）：

```
大标题  top=2.15in  高=2.40in  → 占到 4.55in   行高 1.34（本来就设了）
副标题  top=4.42in              → 从 4.42in 开始
                                 ↑ 两个框重叠 0.13in
```

标题框 2.40in，而「2 行 × 66pt × 1.34」需要约 **2.46in** —— **框装不下自己**。
LibreOffice 让文字溢出，副标题就贴上去了。把标题框放到 2.75in、副标题推到
4.85in 之后，渲染干净了。

> 注意：**加行高在这例子里没用** —— 标题本来就有 1.34。
> 光看"未设行高"会误诊。

#### 规则

**① 相邻文字框不要重叠。** 依次排下来的元素，框底 ≤ 下一个框顶。

**② 框高按内容算足，再留 5–10% 余量。**

```python
# 中文行高：CJK 是方块字，行框比拉丁高。1.35–1.40 稳妥，单行标签 1.15 够
para.line_spacing = 1.35

# 框高 = 行数 × 字号(pt)/72 × 行高 × 1.08
lines = 2; size_pt = 66; lead = 1.34
box_height_in = lines * (size_pt / 72) * lead * 1.08      # ≈ 2.66in
```

**③ 中文字体要同时填两个槽位**，否则回退成默认黑体、衬线风格全丢：

```python
run.font.name = 'Noto Serif SC'                # 只设这个不够
rPr = run._r.get_or_add_rPr()
rPr.append(rPr.makeelement(qn('a:ea'), {'typeface': 'Noto Serif SC'}))
# 拉丁走 run.font.name，东亚走 a:ea
```

#### 验收：用**和你制作时不同**的引擎看

```bash
pptx-preview 你的.pptx --pages 1-4      # DSH 自带 wasm LibreOffice → PDF → PNG
```

然后 `read_image` 那张拼图。逐条问：

- 大标题下面那行，有没有贴上标题下沿
- 有没有哪个框的文字**跑出了框**（看边框位置和文字位置的关系）
- 相邻元素的间距是否一致（不一致通常意味着某个框在硬撑）
- 每页底部的来源行有没有被挤出画布

先跑几何审计，再肉眼确认：

```bash
python3 "$HOME/.dsh/skills/od-deck/scripts/audit-pptx-geometry.py" 你的.pptx
```

（脚本就在本技能目录的 `scripts/` 下。技能装在别处就把那个前缀换成实际路径。）

它报两类风险（估算是启发式的，会误判换行，**最终仍以渲染出来的图为准**）：

- **堆叠重叠 + 框近满** —— 上下相邻的框有重叠，且至少一方余量 < 15%
- **框余量不足** —— 内容高 × 1.15 > 框高

它**故意不报**这些情况，因为都无害：同一行的左右并排框、框里大量余量的重叠、
把标题拆成两个框分别上样式。

另有一个 `audit-pptx-design.py` 查配色/字体/渐变/emoji 合规性 ——
两个脚本管的事不重叠，交付前都跑。

## 反 AI-slop（`craft/anti-ai-slop.md`，七宗罪）

这套规则是**可判定的**，不是口味偏好 —— 上游有 linter 自动拦 P0：

1. **默认 Tailwind 靛蓝当强调色** —— 恰好是 `#6366f1` `#4f46e5` `#4338ca` `#3730a3` `#8b5cf6` `#7c3aed` `#a855f7` 这几个值。这是最典型的 AI 指纹，用当前 `DESIGN.md` 给的 `--accent`。
2. **hero 上的双色"信任"渐变** —— 紫→蓝、蓝→青、靛→粉。平面 + 有意图的字号永远赢。
3. **emoji 当功能图标** —— `✨🚀🎯⚡🔥💡` 出现在标题/按钮/列表项里。改用 1.6–1.8px 描边的单色 SVG + `currentColor`。
4. seed 绑了衬线体却在展示级文字上用无衬线。
5. ALL CAPS 字距 < 0.06em。
6. `var(--accent)` 一屏出现超过 2 次。
7. 编造数据 / 图表无来源。

配套读：`craft/typography-hierarchy-editorial.md`（编辑级字阶）、`craft/color.md`、
`craft/animation-discipline.md`、`craft/accessibility-baseline.md`。

中文排版另加：全角标点、中英混排加空格、中文优先字体栈、配图写署名与许可。

## 与 office-pptx 的分工

本技能产出的是 **HTML deck**（可 `Ctrl+P` 导 PDF，或拖进 Keynote/PowerPoint 转页面）。
需要**原生可编辑 .pptx**（每个字、每根图表柱都是可编辑形状）时，走 `office-pptx` 技能 + python-pptx，
**交 .pptx 前必须走 §6.6 的跨渲染器检查**（见上），
或考虑 pptwise / ppt-master 那条线。两者不冲突：本技能负责"长什么样"，pptx 线负责"交付格式"。

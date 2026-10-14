# 上游素材源索引

本技能（`od-deck`）是从 [OpenDesign](https://github.com/nexu-io/open-design) 抽取的**子集**。
完整素材库留在本地，**不需要启动它的 UI 或 daemon** —— 全是纯文件，`grep`/`cp` 就能用。

- 上游仓库：`~/tools/open-design`（Apache-2.0）
- 本技能：`~/.dsh/skills/od-deck`（已抽取的可用子集）

## 想找什么 → 去哪

| 我想要… | 路径 | 规模 |
|---|---|---|
| 不分品牌的审美硬规则 | `craft/` | 13 份，140 K |
| 某个具体风格的完整做法 | `skills/*-template/` | 165 个技能里的一类 |
| 可直接渲染的 deck / 网页起点 | `design-templates/` | 116 个，40 M |
| 品牌级设计契约 | `design-systems/<name>/DESIGN.md` | 154 套，42 M |
| 成品长什么样（参考答案） | `plugins/_official/examples/` | 183 个成品 |
| 某个插件的元数据/输入声明 | `plugins/_official/*/open-design.json` | 277+ 个插件 |
| 视频/动效提示词模板 | `plugins/_official/video-templates/` | 64 个 |
| 出图提示词模板 | `plugins/_official/image-templates/` | 45 个 |
| 可复用的 UI 片段 | `plugins/_official/atoms/` | 13 个 |
| 系统设计文档（架构/协议/适配器） | `docs/` | `architecture.md` · `skills-protocol.md` · `agent-adapters.md` · `modes.md` |

## 常用检索

```bash
R=~/tools/open-design

# 找某个主题的设计系统
grep -ril "editorial\|swiss\|publication" $R/design-systems/*/DESIGN.md

# 找某类成品参考
ls $R/plugins/_official/examples/ | grep -i "deck\|report\|paper"

# 看某个技能要求注入哪些通用规则
grep -A3 "craft:" $R/skills/*/SKILL.md | grep requires

# 列出所有 deck 模式的插件
grep -rl "mode: deck" $R/plugins/_official/*/*/open-design.json 2>/dev/null
```

## 上游分层（读文档时的地图）

它的 prompt 按固定顺序堆叠，冲突时**下层覆盖上层**：

```
0  身份/工作流宪章
1  discovery + planning + huashu 哲学层（含五维 critique、directions 库）
2  当前 DESIGN.md            ← 品牌 token，优先级最高
3  craft/ 通用规则            ← 品牌无关，被 DESIGN.md 覆盖
4  当前 skill 的 SKILL.md
5  deck 框架指令              ← 钉在最后，覆盖前面所有更软的措辞
```

`od-deck` 把这套关系压缩成了「6 步工作流 + 一 deck 一方向」的写法。

## 已知缺口（需要时再补）

- `plugins/_official/examples/` 183 个成品只搬了几个做方向参考，其余还在上游
- `design-templates/` 116 个只搬了 `html-ppt`（deck 引擎）
- `design-systems/` 154 套只搬了 20 套（文字排版相关）
- 视频线（`hyperframes` + 64 个视频模板）未搬 —— 那是**生成**不是剪辑，且需自带付费视频模型 key

## 许可

`html-ppt` 来自 [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill)（MIT，见 `LICENSE-html-ppt`）；
五维评审来自 [alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design)；
反 AI-slop 规则改编自 [referodesign/refero_skill](https://github.com/referodesign/refero_skill)（MIT）。
再分发时保留这些署名。

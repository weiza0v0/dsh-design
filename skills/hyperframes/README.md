# hyperframes（DSH skill）

把 **HTML 变成 MP4**。HTML 是唯一真相源：`data-*` 属性定时间、GSAP 管动画、CSS 管外观。

上游：[hyperframes](https://github.com/heygen-com/hyperframes)（HeyGen，Apache-2.0）。
本 skill 是它的**内容 + 适配层** —— 正文取自 OpenDesign 的 `design-templates/hyperframes/`，
只替换了 OD 专有的工作流段。

## 内容

| | |
|---|---|
| `SKILL.md` | 入口：DSH 工作流 + Approach / 时间轴契约 / 数据属性 |
| `references/` | 10 份：motion-principles · css-patterns · captions · tts · audio-reactive · html-in-canvas · transcript-guide · transitions.md 及其 `transitions/` 目录（14 份转场） |
| `palettes/` | 9 套配色：monochrome · dark-premium · neon-electric · warm-editorial … |
| `assets/` | 可直接拷的构图骨架（`scaffold.html` + `hyperframes.json` + `meta.json`） |
| `scripts/hf.sh` | **包装器** —— 见下 |
| `data-in-motion.md` · `house-style.md` · `patterns.md` · `visual-styles.md` | 视觉语言参考 |

## 为什么有 `hf.sh`

HyperFrames 需要 Chrome Headless Shell，而直接用它有两个坑：

1. **WSL 上 Chrome 缺 `libnspr4`/`libnss3`** —— 包装器按需补 `LD_LIBRARY_PATH`
   （anaconda 里恰好有这些库）
2. **`npx` 在本机会挂起** —— npm 缓存属主异常（`~/.npm` 属于 root）。包装器**刻意不用 npx**，
   改用数据目录里的本地安装

```bash
HF=~/.dsh/skills/hyperframes/scripts/hf.sh
$HF doctor                                          # 环境体检
$HF lint .<name>                                    # 校验构图
$HF render -c .<name>/index.html -o out.mp4         # 渲成 MP4
```

零配置即可用（会自动找浏览器与库）。

## CLI 安装位置

CLI **不在 skill 目录里**，在 `~/.local/share/dsh-hyperframes/`（362 MB，主要是
`onnxruntime-node`）。skill 只保留 328 KB 的内容 —— 否则技能扫描会被拖慢。

```bash
mkdir -p ~/.local/share/dsh-hyperframes && cd ~/.local/share/dsh-hyperframes
echo '{"private":true,"dependencies":{"hyperframes":"0.8.1"}}' > package.json
pnpm install
```

## 可选依赖（`doctor` 里标 ✗ 的都是可选）

| | 缺了会怎样 |
|---|---|
| `whisper-cpp` | 不能 `transcribe` 生成字幕 |
| Kokoro (`pip install kokoro-onnx`) | 不能用本地 TTS 旁白（可用 `media_generate` 的 `openai/tts` 代替） |
| MusicGen | 不能用本地生成背景音乐 |

**核心渲染只需要 Chrome + FFmpeg**，这两个本机都有。

## 实测

一份中文动效标题卡（1920×1080，6 秒，180 帧）：
`lint` 0 errors → `render` 25.7 秒 → 354.9 KB MP4。

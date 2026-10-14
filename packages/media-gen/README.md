# dsh-media-gen

**DSH 的图片 / 视频 / 语音生成工具（BYOK）。按「协议」适配，而不是按厂商。**

两个工具：`media_models`（看有哪些模型 + 凭证配好没）和 `media_generate`（真的生成）。

---

## 设计取舍：为什么是 2 个适配器而不是 29 个

OpenDesign 的 media 管道有 **3,978 行、29 个 renderer** —— 因为每家 provider 的
submit / poll / download 细节都不一样。但把它们拆开看，**只有两种协议**：

| 协议 | 形状 | 覆盖 |
|---|---|---|
| **`openai`** | `POST /images/generations` · `POST /audio/speech` | OpenAI、Azure、任何 OpenAI 兼容端点（**火山引擎的图片接口也是这个载荷**） |
| **`queue`** | 提交 → 拿 id → 轮询状态 → 取结果 URL → 下载 | fal.ai（kling / seedance / veo / wan / flux）、火山引擎视频（任务式） |

所以本包只有 `lib/providers.js` 里两个 ~60 行的适配器，加一张精选模型表把
`provider/model` 映射到「协议 + 端点 + 默认值」。

**表里没有的模型也能用** —— 直接传完整端点（见下方「自定义端点」）。

---

## 安装

```bash
dsh plugin --profile web add dsh-media-gen
# 重启 DSH
```

装好后新会话的工具集里会出现 `media_models` / `media_generate`。

---

## 凭据（BYOK）

优先级：**显式配置 → 环境变量 → 配置文件**。一个都没有时，
`media_models` 会如实报告「无」，`media_generate` 会明确拒绝并告诉你缺哪个变量。

### 方式一：环境变量

```bash
export FAL_KEY=...            # fal.ai（FLUX / kling / veo / seedance / wan / sora）
export ARK_API_KEY=...        # 火山引擎（豆包 seedream / seededit / seedance）
export OPENAI_API_KEY=...     # OpenAI（gpt-image-1 / dall-e-3 / tts）

# 可选：换端点（自建代理、Azure、任何兼容网关）
export OPENAI_BASE_URL=https://your-gateway/v1
export FAL_BASE_URL=... ARK_BASE_URL=...
```

### 方式二：配置文件

`~/.dsh/media-gen.json`（路径可用 `DSH_HOME` 或 `DECK_LIBS_MEDIA_CONFIG` 覆盖）：

```json
{
  "providers": {
    "fal":    { "apiKey": "...", "baseUrl": "https://fal.run" },
    "ark":    { "apiKey": "..." },
    "openai": { "apiKey": "...", "baseUrl": "https://api.openai.com/v1" }
  }
}
```

**环境变量压过配置文件** —— 临时换个 key 不用改文件。

---

## 模型表

`media_models` 会列出当前可用的（`ark/seedance` 需要额外配置，见下方「坑」）。

### 图片（9）

| id | 后端 | 说明 |
|---|---|---|
| `fal/flux-schnell` | fal `fal-ai/flux/schnell` | 最快最便宜，适合先试构图 |
| `fal/flux-dev` | fal `fal-ai/flux/dev` | 质量/速度平衡 |
| `fal/flux-pro-ultra` | fal `fal-ai/flux-pro/v1.1-ultra` | 最高质量；用 `aspect_ratio` 而不是命名尺寸 |
| `fal/ideogram-v3` | fal | 文字渲染强 |
| `fal/recraft-v3` | fal | 矢量/图标风格 |
| `ark/seedream-3.0` | 火山 `doubao-seedream-3-0-t2i-250415` | 中文语境友好（OpenAI 兼容载荷） |
| `ark/seededit-3.0` | 火山 `doubao-seededit-3-0-i2i-250628` | 图生图编辑 |
| `openai/gpt-image-1` | OpenAI | 指令遵循好 |
| `openai/dall-e-3` | OpenAI | — |

### 视频（6，全部走队列协议）

`fal/kling-2.1` · `fal/seedance-1-pro` · `fal/veo-3` · `fal/veo-2` ·
`fal/wan-2.1-t2v` · `fal/sora-2`

### 语音（1）

`openai/tts` —— 文本转语音，`voice` 参数默认 `alloy`，输出 mp3。

---

## 用法

```
media_models()                     ← 先看有哪些、凭证配好没

media_generate(
  model="fal/flux-schnell",
  prompt="一只橘猫坐在窗台，晨光，浅景深",
  aspect="16:9",
  out="./assets/hero.png"
)

media_generate(model="openai/tts", prompt="念这句话", out="./narration.mp3", voice="alloy")
```

`out` 给目录（以 `/` 结尾）或省略时，文件名从 prompt 前几个词推导：
`一只橘猫-坐在窗台.png`。非法字符会被去掉，超长会截断。

### 自定义端点

表里没有的模型，直接传端点：

| 写法 | 走什么 |
|---|---|
| `fal-ai/<endpoint>` | fal 队列协议，`<endpoint>` 原样拼到 `queue.fal.run` 后面 |
| `openai:<model>` | OpenAI 兼容端点，模型名取冒号后面的部分 |

```
media_generate(model="fal-ai/fal-ai/flux/schnell", prompt="…")   # 自己指定完整 slug
media_generate(model="openai:my-self-hosted-model", prompt="…")  # 自建网关
```

---

## 坑（都是实测踩出来的）

### 火山视频需要你自己创建接入点

火山的视频模型 id 不是名字，而是你账号下创建的**接入点 id**（形如 `ep-xxxxxxxx`）。
所以：

```bash
export ARK_VIDEO_MODEL=ep-xxxxxxxx
```

**注意**：这个变量是在**模块加载时**读取的。设完要重启 DSH 才会出现在 `media_models`
的列表里（没设时 `ark/seedance` 会被刻意隐藏 —— 列一个不能用的模型只会误导）。

### 视频调用会阻塞 1–5 分钟

队列协议最长等到 15 分钟（`maxMs`）。工具会通过 `onProgress` 把 provider 的
状态变化（`IN_QUEUE → IN_PROGRESS → COMPLETED`）收进结果里。**别静默干等。**

### 这些调用**要花钱**

`media_generate` 打的是真实的付费接口。工具描述里已经写了：**不要试探性地生成**，
先和用户确认主体 / 风格 / 比例再花这一刀。

---

## 测试

```bash
cd packages/media-gen && npm test     # 46 项断言
```

**全程零真实请求**：测试把 `globalThis.fetch` 换成桩，任何没被显式 mock 的出网调用
会**直接让测试失败**。这既是「不误花钱」的保证，也意味着「测试跑绿」等价于
「所有出网路径都被覆盖到了」：

- 模型表解析（已知 id / 自定义端点 / 未知 id）
- 凭据优先级（环境变量 → 配置文件 → 缺 key 的报错文案要指出**真实**配置路径）
- 协议 1：`b64_json` / `url` 下载 / 缺 `data[0]` / HTTP 错误带响应体 / speech 字节流
- 协议 2：轮询到完成 / `resultInStatus`（火山把结果放状态体里）/ 失败态 / 缺 task id / 超时
- 端到端 `generate()`：真的落盘、文件名推导

---

## 它不做的事

- **不渲染 HTML → 视频**。那是本地渲染，零 API 成本，走别的路径（本仓库的
  `skills/hyperframes` 是 HTML 视频合成）。
- 不做图片编辑 UI。`fal/ideogram-v3` 这类的能力取决于模型本身。
- 不缓存生成结果。每次调用都是新的付费请求。

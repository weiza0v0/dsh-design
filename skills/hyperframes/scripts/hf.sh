#!/usr/bin/env bash
#
# hf.sh —— HyperFrames CLI 的包装器
#
# 做三件事：
#   1. **找浏览器** —— HyperFrames 需要 Chrome Headless Shell。复用机器上已有的
#      （Playwright 缓存的 headless shell、系统 Chrome…）。
#   2. **补动态库** —— WSL 上 Playwright 的 Chrome 缺 libnspr4/libnss3，anaconda 里恰好有。
#   3. **找 CLI** —— 优先用 `$HYPERFRAMES_CLI_DIR` 下的安装（默认
#      ~/.local/share/dsh-hyperframes）。**刻意不用 npx**：本机 npm 缓存属主异常，
#      npx 会挂起。
#
# CLI 装在数据目录而不是 skill 目录里 —— skill 只放内容，否则 362 MB 的
# node_modules（主要是 onnxruntime）会拖慢技能扫描。
#
# 用法（与 hyperframes 完全一致）:
#   hf.sh init my-video --example blank --non-interactive
#   hf.sh lint .<name>
#   hf.sh render -c .<name>/index.html -o out.mp4
#   hf.sh doctor
#
# 覆盖:
#   HYPERFRAMES_BROWSER_PATH   浏览器路径
#   HYPERFRAMES_CLI_DIR        CLI 安装目录
#   HYPERFRAMES_BIN            CLI 入口（.mjs）
#   HF_LD_LIBRARY_PATH         额外库目录
#
set -euo pipefail

CLI_DIR="${HYPERFRAMES_CLI_DIR:-$HOME/.local/share/dsh-hyperframes}"

# ── 1. 找浏览器 ────────────────────────────────────────────────────
find_browser() {
  [ -n "${HYPERFRAMES_BROWSER_PATH:-}" ] && { echo "$HYPERFRAMES_BROWSER_PATH"; return; }
  for b in "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell; do
    [ -x "$b" ] && { echo "$b"; return; }
  done
  for c in google-chrome google-chrome-stable chromium chromium-browser \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return; }
  done
  return 1
}

if BROWSER="$(find_browser)"; then
  export HYPERFRAMES_BROWSER_PATH="$BROWSER"
  if ! "$BROWSER" --version >/dev/null 2>&1; then
    for lib in "${HF_LD_LIBRARY_PATH:-}" "$HOME/.apps/anaconda3/lib" /usr/lib/x86_64-linux-gnu; do
      [ -n "$lib" ] && [ -d "$lib" ] || continue
      if LD_LIBRARY_PATH="$lib:${LD_LIBRARY_PATH:-}" "$BROWSER" --version >/dev/null 2>&1; then
        export LD_LIBRARY_PATH="$lib:${LD_LIBRARY_PATH:-}"
        break
      fi
    done
  fi
fi

# 离线时不联网查 AI 技能注册表
export HYPERFRAMES_SKIP_SKILLS="${HYPERFRAMES_SKIP_SKILLS:-1}"

# ── 2. 找 CLI ──────────────────────────────────────────────────────
CLI="${HYPERFRAMES_BIN:-}"
if [ -z "$CLI" ] || [ ! -f "$CLI" ]; then
  if [ -x "$CLI_DIR/node_modules/.bin/hyperframes" ]; then
    exec "$CLI_DIR/node_modules/.bin/hyperframes" "$@"
  fi
  if [ -f "$CLI_DIR/node_modules/hyperframes/bin/hyperframes.mjs" ]; then
    CLI="$CLI_DIR/node_modules/hyperframes/bin/hyperframes.mjs"
  fi
fi
if [ -z "$CLI" ] || [ ! -f "$CLI" ]; then
  if command -v hyperframes >/dev/null 2>&1; then
    exec hyperframes "$@"
  fi
  echo "✗ 找不到 hyperframes CLI（找过 $CLI_DIR 和 PATH）。" >&2
  echo "  安装（用 pnpm —— 本机 npm 缓存权限异常会让 npx 挂起）：" >&2
  echo "    mkdir -p \"$CLI_DIR\" && cd \"$CLI_DIR\"" >&2
  echo "    echo '{\"private\":true,\"dependencies\":{\"hyperframes\":\"0.8.1\"}}' > package.json" >&2
  echo "    pnpm install" >&2
  exit 1
fi

exec node "$CLI" "$@"

#!/usr/bin/env bash
#
# start-headless-browser.sh —— 起一个**专用的 headless 浏览器**并开调试端口，
# 供 deck_render 通过 `cdp` 参数连接。
#
# 为什么需要它：deck_render 默认连接本机常驻的调试端口（可能是用户正在用的
# 浏览器，渲染时会弹标签页）。想让渲染完全无感，就用这个脚本起一个独立实例，
# 把它的 endpoint 传给 deck_render。
#
# 用法:
#   ./start-headless-browser.sh                  # 自动找浏览器，端口 9333
#   ./start-headless-browser.sh 9444             # 指定端口
#   DECK_BROWSER=/path/to/chrome ./start-headless-browser.sh
#   ./start-headless-browser.sh --stop           # 关掉（只关本脚本起的那个）
#
# 跨平台：macOS / Linux / WSL(调 Windows Chrome) 都适用。
#
set -euo pipefail

PORT="${1:-9333}"
STATE_DIR="${TMPDIR:-/tmp}/deck-render-headless"
PIDFILE="$STATE_DIR/pid"
PORTFILE="$STATE_DIR/port"

if [ "$PORT" = "--stop" ]; then
  if [ -f "$PIDFILE" ]; then
    PID="$(cat "$PIDFILE")"
    kill "$PID" 2>/dev/null || true
    rm -f "$PIDFILE" "$PORTFILE"
    echo "已请求关闭 (pid $PID)"
  else
    echo "没有正在运行的实例"
  fi
  exit 0
fi

# ── 找浏览器 ────────────────────────────────────────────────────────
find_browser() {
  if [ -n "${DECK_BROWSER:-}" ]; then echo "$DECK_BROWSER"; return; fi
  # WSL：优先 Windows 侧 Chrome（有完整中文字体与外网字体）
  for c in \
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
    [ -f "$c" ] && { echo "$c"; return; }
  done
  # 原生
  for c in google-chrome google-chrome-stable chromium chromium-browser \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "$HOME/.cache/ms-playwright"/*/chrome-linux*/chrome; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then echo "$c"; return; fi
  done
  return 1
}

BROWSER="$(find_browser)" || {
  echo "✗ 找不到浏览器。请用 DECK_BROWSER=/path/to/chrome 指定。" >&2
  exit 1
}

mkdir -p "$STATE_DIR"

# 已在跑就直接复用
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "http://127.0.0.1:$(cat "$PORTFILE")"
  exit 0
fi

# Windows .exe 需要 Windows 能读懂的 profile 路径
case "$BROWSER" in
  *.exe) PROFILE="C:\\Windows\\Temp\\deck-render-headless" ;;
  *)     PROFILE="$STATE_DIR/profile" ;;
esac

LOG="$STATE_DIR/browser.log"
"$BROWSER" \
  --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --disable-extensions --disable-background-networking \
  --remote-allow-origins='*' \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  about:blank > "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "$PORT" > "$PORTFILE"

# 等端口就绪
ENDPOINT="http://127.0.0.1:$PORT"
for _ in $(seq 1 40); do
  if curl -sf --max-time 2 "$ENDPOINT/json/version" >/dev/null 2>&1; then
    echo "$ENDPOINT"
    exit 0
  fi
  sleep 0.5
done

echo "✗ 浏览器在 20s 内没开放调试端口。日志：$LOG" >&2
tail -5 "$LOG" 2>/dev/null >&2 || true
exit 1

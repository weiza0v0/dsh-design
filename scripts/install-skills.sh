#!/usr/bin/env bash
#
# install-skills.sh —— 把本仓库 skills/ 下的技能装进 DSH 的技能目录
#
#   ./scripts/install-skills.sh            # symlink（推荐：改仓库即生效）
#   ./scripts/install-skills.sh --copy     # 复制（跨文件系统 / symlink 不可用时）
#   DSH_HOME=/path ./scripts/install-skills.sh
#
# 为什么默认 symlink：技能是**纯文件**，没有构建步骤。symlink 之后你在仓库里
# 改 SKILL.md，下一次会话直接生效，不用重装。
#
# 目标目录是本仓库外的东西（~/.dsh/skills），所以脚本会：
#   · 已存在**且是软链** → 覆盖（本脚本自己装的）
#   · 已存在**且不是软链** → 拒绝并提示（可能是你手工装的，不擅自覆盖）
#
set -euo pipefail

COPY=0
for arg in "$@"; do
  case "$arg" in
    --copy) COPY=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（可用 --copy）" >&2; exit 2 ;;
  esac
done

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(dirname "$here")
src="$repo/skills"
dst="${DSH_HOME:-$HOME/.dsh}/skills"

[ -d "$src" ] || { echo "✗ 找不到技能目录：$src" >&2; exit 1; }
mkdir -p "$dst"

echo "源：$src"
echo "目标：$dst"
echo

installed=0
for dir in "$src"/*/; do
  name=$(basename "$dir")
  target="$dst/$name"

  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "⚠️  $name：$target 已存在且不是软链 —— 跳过。"
    echo "    确认那是旧副本、可以替换时：mv \"$target\" \"$target.bak\" 后重跑本脚本。"
    continue
  fi

  rm -f "$target"
  if [ "$COPY" -eq 1 ]; then
    cp -r "${dir%/}" "$target"
    echo "✅ $name（已复制）"
  else
    ln -s "${dir%/}" "$target"
    echo "✅ $name → ${dir%/}"
  fi
  installed=$((installed + 1))
done

echo
echo "装好 $installed 个技能。重启 DSH 后新会话即可加载。"
echo "注意：插件的装法是 \`dsh plugin --profile web add <包名>\`，不是这个脚本。"

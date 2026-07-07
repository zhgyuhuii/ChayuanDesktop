#!/usr/bin/env bash
# =============================================================================
# fetch-deps.sh —— 麒麟V10 ARM「联网收集」脚本
# -----------------------------------------------------------------------------
# 作用:在一台【能联网、且软件源里有 webkit2gtk-4.1 的麒麟V10 aarch64 机器】上,
#       把 chayuan .deb 的全部运行时依赖(递归整棵树,含 libwebkit2gtk-4.1-0、
#       libayatana-appindicator3-1 等)下载成一批 arm64 .deb,存到 ./deps/。
#
#       这批 .deb 就是要随发布物一起分发的「内置 4.1 库」。最终用户在【离线】
#       的麒麟机上跑同目录的 install-offline.sh 即可装齐,无需联网。
#
# 背景:Chayuan 桌面壳是 Tauri v2,二进制在链接层绑死 libwebkit2gtk-4.1.so.0,
#       无法降级到 webkit2gtk-4.0。麒麟V10 若系统没预装 4.1,只能把 4.1 这套
#       依赖离线带过去。详见本目录 README.md。
#
# 用法:
#   ./fetch-deps.sh [chayuan.deb]
#     - 传了 chayuan.deb:自动读它 control 里的 Depends 作为顶层依赖,最精确。
#     - 没传:用下面 DEFAULT_TOP 的默认顶层依赖列表。
#
# 环境变量:
#   DEPS_DIR=deps     依赖 .deb 的输出目录(默认脚本同级 deps/)
#   SKIP_BASE=0       设为 1 则跳过 libc6 等系统基础包(减体积;离线机基础完整时可用)
#   NO_UPDATE=0       设为 1 则跳过 apt-get update
#
# 前提:目标收集机架构 = aarch64,且 `apt-cache policy libwebkit2gtk-4.1-0`
#       有候选版本。若显示 (none),说明这台机器的源里没有 4.1 —— 换一台有的,
#       或先给它配上有 4.1 的源(如较新的麒麟官方源 / openKylin 源)。
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPS_DIR="${DEPS_DIR:-$HERE/deps}"
SKIP_BASE="${SKIP_BASE:-0}"
NO_UPDATE="${NO_UPDATE:-0}"
CHAYUAN_DEB="${1:-}"

# 默认顶层依赖:对齐 tauri.conf.json 的 deb.depends + Tauri v2 tray-icon
# 自动注入的 appindicator。传入 chayuan.deb 时会被其真实 Depends 覆盖。
DEFAULT_TOP=(
  libwebkit2gtk-4.1-0
  libgtk-3-0
  libayatana-appindicator3-1
)

# 跳过的系统基础包(SKIP_BASE=1 时生效)。这些包麒麟离线机必然自带同版本,
# 带上只是徒增体积;但只在你确认离线机基础系统完整时才跳。
BASE_SKIP_RE='^(libc6|libc-bin|libgcc-s1|libstdc\+\+6|multiarch-support|dpkg|base-files)$'

C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
info() { printf '%s[*]%s %s\n' "$C_B" "$C_0" "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die()  { printf '%s[FAIL]%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

# ── 环境自检 ────────────────────────────────────────────────────────────────
command -v apt-get   >/dev/null || die "找不到 apt-get,本脚本只支持 Debian 系(含麒麟V10)"
command -v apt-cache >/dev/null || die "找不到 apt-cache"

ARCH="$(dpkg --print-architecture 2>/dev/null || echo unknown)"
if [ "$ARCH" != "arm64" ]; then
  warn "当前架构是 '$ARCH',不是 arm64(aarch64)。"
  warn "下到的 .deb 装不到麒麟 ARM 机上!请在麒麟V10 aarch64 机器上跑本脚本。"
  warn "若确实要交叉下载,请自行 dpkg --add-architecture arm64 并配 arm64 源(不推荐)。"
fi

# ── 确定顶层依赖 ────────────────────────────────────────────────────────────
declare -a TOP
if [ -n "$CHAYUAN_DEB" ]; then
  [ -f "$CHAYUAN_DEB" ] || die "指定的 deb 不存在:$CHAYUAN_DEB"
  command -v dpkg-deb >/dev/null || die "找不到 dpkg-deb,无法读取 $CHAYUAN_DEB 的 Depends"
  info "从 $CHAYUAN_DEB 读取真实 Depends ..."
  # Depends 形如:libwebkit2gtk-4.1-0, libgtk-3-0 (>= 3.24), libc6 | libc6-dev
  # 处理:按逗号拆 -> 备选取第一个(| 前)-> 去掉版本约束 (...) -> 去空白
  raw="$(dpkg-deb -f "$CHAYUAN_DEB" Depends 2>/dev/null || true)"
  [ -n "$raw" ] || die "读不到 $CHAYUAN_DEB 的 Depends 字段"
  IFS=',' read -ra parts <<< "$raw"
  for p in "${parts[@]}"; do
    name="${p%%|*}"                       # 备选依赖取第一个
    name="$(echo "$name" | sed -E 's/\(.*\)//; s/[[:space:]]//g')"
    [ -n "$name" ] && TOP+=("$name")
  done
  ok "解析到 ${#TOP[@]} 个顶层依赖:${TOP[*]}"
else
  TOP=("${DEFAULT_TOP[@]}")
  info "未传 chayuan.deb,使用默认顶层依赖:${TOP[*]}"
  warn "建议把 chayuan .deb 作为参数传入,依赖会更精确:./fetch-deps.sh Chayuan_x.y.z_arm64.deb"
fi

# ── apt update(可跳过)──────────────────────────────────────────────────────
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
if [ "$NO_UPDATE" != "1" ]; then
  info "apt-get update ..."
  $SUDO apt-get update || warn "apt-get update 失败,继续用现有索引(可能有包下不到)"
fi

# ── 校验 4.1 是否可得(核心前提)──────────────────────────────────────────────
if ! apt-cache policy libwebkit2gtk-4.1-0 2>/dev/null | grep -q 'Candidate:.*[0-9]'; then
  warn "======================================================================"
  warn "这台机器的软件源里【没有 libwebkit2gtk-4.1-0】候选版本!"
  warn "  apt-cache policy libwebkit2gtk-4.1-0  ->  Candidate: (none)"
  warn "收集不到 4.1 就无法给离线麒麟机装 Chayuan。请:"
  warn "  1) 换一台源里有 4.1 的麒麟V10 aarch64 机器,或"
  warn "  2) 给这台机配上含 4.1 的源(较新麒麟官方源 / openKylin 源)后重试。"
  warn "======================================================================"
  die "缺 libwebkit2gtk-4.1-0,终止。"
fi
ok "确认软件源有 libwebkit2gtk-4.1-0 候选,可以收集。"

# ── 递归展开依赖树 ──────────────────────────────────────────────────────────
info "递归解析依赖树(apt-cache depends --recurse)..."
# 只保留「包名行」(顶格的包名),丢弃 Depends:/PreDepends: 等缩进关系行与
# <虚拟包> 行。不同 apt 版本输出略有差异,这里用宽松匹配。
mapfile -t PKGS < <(
  apt-cache depends --recurse --no-recommends --no-suggests \
    --no-conflicts --no-breaks --no-replaces --no-enhances \
    "${TOP[@]}" 2>/dev/null \
    | grep -E '^[a-z0-9]' \
    | grep -v '<' \
    | sort -u
)
[ "${#PKGS[@]}" -gt 0 ] || die "依赖解析结果为空,请检查顶层依赖名是否正确"
info "依赖树共 ${#PKGS[@]} 个候选包(含系统基础库)。"

# ── 逐个下载 ────────────────────────────────────────────────────────────────
mkdir -p "$DEPS_DIR"
cd "$DEPS_DIR"
info "开始下载到:$DEPS_DIR"
downloaded=0; skipped=0; failed=0
FAILED_LIST=()
for pkg in "${PKGS[@]}"; do
  if [ "$SKIP_BASE" = "1" ] && [[ "$pkg" =~ $BASE_SKIP_RE ]]; then
    skipped=$((skipped+1)); continue
  fi
  # apt-get download 只下当前源里存在的包;虚拟包/不存在的会失败,记录后继续。
  if apt-get download "$pkg" >/dev/null 2>&1; then
    downloaded=$((downloaded+1))
    printf '  %s[+]%s %s\n' "$C_G" "$C_0" "$pkg"
  else
    failed=$((failed+1)); FAILED_LIST+=("$pkg")
  fi
done

# ── 生成清单 ────────────────────────────────────────────────────────────────
MANIFEST="$DEPS_DIR/manifest.txt"
{
  echo "# Chayuan 麒麟V10 ARM 离线依赖清单"
  echo "# 收集机架构: $ARCH"
  echo "# 顶层依赖: ${TOP[*]}"
  echo "# 生成: fetch-deps.sh"
  echo "# ---- 已下载 .deb ----"
  ls -1 "$DEPS_DIR"/*.deb 2>/dev/null | xargs -r -n1 basename || true
} > "$MANIFEST"

echo
ok  "下载完成:成功 $downloaded,跳过 $skipped,失败 $failed"
[ "$failed" -gt 0 ] && warn "以下包未下到(多为虚拟包/系统必备,通常离线机已自带,可忽略):${FAILED_LIST[*]}"
info "依赖 .deb 目录:$DEPS_DIR"
info "清单:$MANIFEST"
echo
info "下一步:把整个 kylin-offline/ 目录(含 deps/ 和 chayuan .deb)拷到离线麒麟机,"
info "        在离线机上跑:  ./install-offline.sh  即可安装。"

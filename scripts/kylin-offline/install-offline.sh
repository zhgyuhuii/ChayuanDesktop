#!/usr/bin/env bash
# =============================================================================
# install-offline.sh —— 麒麟V10 ARM「离线安装」脚本
# -----------------------------------------------------------------------------
# 作用:在【不联网】的麒麟V10 aarch64 机器上,先把 deps/ 里 fetch-deps.sh 收集
#       好的依赖 .deb(含 webkit2gtk-4.1 全家桶、appindicator 等)装上,再装
#       Chayuan 主程序 .deb。全程不访问网络。
#
# 用法:
#   ./install-offline.sh [chayuan.deb]
#     - 传了 chayuan.deb:安装它。
#     - 没传:自动在脚本同级目录找唯一的 Chayuan*.deb / chayuan*.deb。
#
# 目录约定(与 fetch-deps.sh 产出一致):
#   kylin-offline/
#     ├── install-offline.sh   <- 本脚本
#     ├── fetch-deps.sh
#     ├── deps/                <- 依赖 .deb(联网机上 fetch-deps.sh 生成)
#     │     └── *.deb
#     └── Chayuan_x.y.z_arm64.deb   <- 主程序(把它放进本目录)
#
# 需要 root:脚本会在需要时自动 sudo;或直接用 root 跑。
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPS_DIR="${DEPS_DIR:-$HERE/deps}"
CHAYUAN_DEB="${1:-}"

C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
info() { printf '%s[*]%s %s\n' "$C_B" "$C_0" "$*"; }
ok()   { printf '%s[OK]%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '%s[WARN]%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die()  { printf '%s[FAIL]%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

command -v dpkg >/dev/null || die "找不到 dpkg,本脚本只支持 Debian 系(含麒麟V10)"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

# ── 架构自检 ────────────────────────────────────────────────────────────────
ARCH="$(dpkg --print-architecture 2>/dev/null || echo unknown)"
[ "$ARCH" = "arm64" ] || warn "当前架构 '$ARCH' 不是 arm64,arm64 的 .deb 可能装不上。"

# ── 定位主程序 deb ──────────────────────────────────────────────────────────
if [ -z "$CHAYUAN_DEB" ]; then
  mapfile -t cands < <(find "$HERE" -maxdepth 1 -iname '*chayuan*.deb' | sort)
  case "${#cands[@]}" in
    0) die "本目录没找到 Chayuan*.deb。把主程序 .deb 放到 $HERE/ 下,或作为参数传入。" ;;
    1) CHAYUAN_DEB="${cands[0]}" ;;
    *) warn "本目录有多个 chayuan .deb,请显式指定其一:"
       printf '   %s\n' "${cands[@]}" >&2
       die "用法:./install-offline.sh <某个.deb>" ;;
  esac
fi
[ -f "$CHAYUAN_DEB" ] || die "主程序 deb 不存在:$CHAYUAN_DEB"
ok "主程序:$CHAYUAN_DEB"

# ── 检查依赖目录 ────────────────────────────────────────────────────────────
shopt -s nullglob
DEP_DEBS=("$DEPS_DIR"/*.deb)
shopt -u nullglob
if [ "${#DEP_DEBS[@]}" -eq 0 ]; then
  warn "依赖目录为空:$DEPS_DIR"
  warn "若这台机器系统源本就有 4.1 依赖,可忽略;否则请先在联网麒麟机跑 fetch-deps.sh。"
else
  info "发现 ${#DEP_DEBS[@]} 个依赖 .deb,准备安装。"
fi

# ── 安装依赖(多遍 dpkg 以吸收内部顺序依赖)──────────────────────────────────
if [ "${#DEP_DEBS[@]}" -gt 0 ]; then
  info "安装依赖库(dpkg -i,多遍解决安装顺序)..."
  # dpkg -i 不会自动排序依赖,某些包会因为「依赖尚未装」第一遍失败;
  # 反复跑几遍,后装的补齐前面缺的,直到不再有进展。
  last_fail=999
  for round in 1 2 3 4; do
    set +e
    $SUDO dpkg -i "${DEP_DEBS[@]}" >/tmp/kylin_dpkg.log 2>&1
    rc=$?
    set -e
    # 统计还有多少「依赖问题」未解决
    fails=$(grep -c 'dependency problems\|依赖关系问题\|尚未配置' /tmp/kylin_dpkg.log 2>/dev/null || echo 0)
    info "  第 $round 遍:dpkg 返回码 $rc,剩余依赖问题计数 $fails"
    [ "$rc" -eq 0 ] && { ok "依赖全部安装完成(第 $round 遍)"; break; }
    # 没有进展就停,避免死循环
    if [ "$fails" -ge "$last_fail" ]; then
      warn "第 $round 遍后依赖问题不再减少,停止重试。"
      break
    fi
    last_fail="$fails"
  done
fi

# ── 安装主程序 ──────────────────────────────────────────────────────────────
info "安装 Chayuan 主程序 ..."
set +e
$SUDO dpkg -i "$CHAYUAN_DEB" >/tmp/kylin_dpkg_main.log 2>&1
main_rc=$?
set -e
if [ "$main_rc" -ne 0 ]; then
  warn "主程序 dpkg 报依赖问题,尝试用本地依赖修复(不联网)..."
  # -f install 修复依赖;--no-download 严禁联网(离线环境,缺就直接报)。
  # 指定 archives 目录,让 apt 从本地 deps/ 取包。
  set +e
  $SUDO apt-get -f install --no-download -y \
    -o Dir::Cache::archives="$DEPS_DIR" >/tmp/kylin_apt_fix.log 2>&1
  fix_rc=$?
  # 再装一遍主程序
  $SUDO dpkg -i "$CHAYUAN_DEB" >>/tmp/kylin_dpkg_main.log 2>&1
  main_rc=$?
  set -e
fi

# ── 结果校验 ────────────────────────────────────────────────────────────────
echo
info "===== 安装结果校验 ====="
fatal=0

# 1) webkit2gtk-4.1 运行时 .so 是否就位(这是最容易缺、也最致命的一项)
if ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4.1'; then
  ok "libwebkit2gtk-4.1 运行库已就位"
else
  warn "未找到 libwebkit2gtk-4.1 运行库 —— Chayuan 启动会白屏/崩溃!"
  warn "  说明依赖没装齐。请回到联网麒麟机跑 fetch-deps.sh 补全 deps/ 后重试。"
  fatal=1
fi

# 2) appindicator(托盘,缺了通常只是没托盘图标,不致命)
if ldconfig -p 2>/dev/null | grep -q 'libayatana-appindicator3'; then
  ok "libayatana-appindicator3 已就位"
else
  warn "未找到 libayatana-appindicator3(托盘图标库),托盘可能不显示,一般不影响主功能。"
fi

# 3) 主程序包状态
pkgname="$(dpkg-deb -f "$CHAYUAN_DEB" Package 2>/dev/null || echo '')"
if [ -n "$pkgname" ] && dpkg -l "$pkgname" 2>/dev/null | grep -q '^ii'; then
  ok "主程序包 '$pkgname' 状态 = 已正确安装 (ii)"
else
  warn "主程序包未处于 'ii' 已安装状态。查看:/tmp/kylin_dpkg_main.log"
  fatal=1
fi

echo
if [ "$fatal" -eq 0 ]; then
  ok  "安装完成!可以从应用菜单启动 Chayuan,或命令行运行其可执行文件。"
else
  die "安装未完全成功。关键依赖或主程序缺失,详见上面的 [WARN] 与 /tmp/kylin_*.log。"
fi

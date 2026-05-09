#!/usr/bin/env bash
# ====================================================================
# 察元 AI 单机版桌面安装包构建脚本 — macOS / Linux 通用入口。
#
# 与 Windows 端 build-desktop.cmd / build-desktop.ps1 同形,开关命名一致
# (改用 sh 风格连字符):
#
#   ./build-desktop.sh                                  全量构建
#   ./build-desktop.sh --skip-server                    跳过 sidecar PyInstaller
#   ./build-desktop.sh --skip-healthcheck               跳过 /healthz 探测
#   ./build-desktop.sh --skip-frontend                  跳过 Tauri bundle
#   ./build-desktop.sh --skip-install                   跳过 pnpm install
#   ./build-desktop.sh --skip-typecheck                 跳过 pnpm typecheck
#   ./build-desktop.sh --bundle-only                    跳过前 4 步,只重做 Tauri bundle
#   ./build-desktop.sh --clean                          构建前先清 dist + bundle
#   ./build-desktop.sh --verbose                        透传 PyInstaller / pnpm 完整 stdout
#
# 跨架构注意
# ---------
#   x86_64 与 ARM64(aarch64 / arm64)产物**完全不互通**:
#     Intel Mac .dmg     ⇄ Apple Silicon Mac .dmg   不兼容(Rosetta 可勉强,但不推荐)
#     Linux x86_64 .deb  ⇄ Linux ARM64 .deb         不兼容
#     Linux x86_64 .AppImage ⇄ aarch64 .AppImage    不兼容
#
#   本脚本**只为 host 架构出包**;要支持双架构请在两台对应 CPU 的机器
#   (或 CI 双 runner)分别跑一次。脚本会在产物清单里明确标出当前 host
#   架构,提醒分发时不要错配。
#
#   sidecar 二进制由 packaging/pyinstaller/build.py 按 ``rust target triple``
#   命名为 ``chayuan-server-<triple>``,Tauri externalBin 会自动按 host triple
#   找文件。所以脚本不需要手动改名。
# ====================================================================

set -euo pipefail

# ── 0. 路径 + 平台识别 ────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="$SCRIPT_DIR"
SERVER_DIR="$WORKSPACE/chayuan-server"
SERVER_PKG_DIR="$SERVER_DIR/libs/chayuan-server"
CLIENT_DIR="$WORKSPACE/chayuan-client"
DESKTOP_DIR="$CLIENT_DIR/apps/desktop"
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"
TAURI_BUNDLE="$DESKTOP_DIR/src-tauri/target/release/bundle"

UNAME_S="$(uname -s)"
UNAME_M="$(uname -m)"

# Rust target triple,与 packaging/pyinstaller/build.py::rust_target_triple() 对齐。
case "$UNAME_S" in
    Darwin)
        OS_NAME=macos
        case "$UNAME_M" in
            arm64|aarch64) ARCH=aarch64 ; TRIPLE=aarch64-apple-darwin ;;
            x86_64|amd64)  ARCH=x86_64  ; TRIPLE=x86_64-apple-darwin  ;;
            *) echo "[FAIL] unsupported macOS arch: $UNAME_M" >&2 ; exit 2 ;;
        esac
        SIDECAR_NAME="chayuan-server-${TRIPLE}"
        ;;
    Linux)
        OS_NAME=linux
        case "$UNAME_M" in
            aarch64|arm64) ARCH=aarch64 ; TRIPLE=aarch64-unknown-linux-gnu ;;
            x86_64|amd64)  ARCH=x86_64  ; TRIPLE=x86_64-unknown-linux-gnu  ;;
            *) echo "[FAIL] unsupported Linux arch: $UNAME_M" >&2 ; exit 2 ;;
        esac
        SIDECAR_NAME="chayuan-server-${TRIPLE}"
        ;;
    *)
        echo "[FAIL] 本脚本仅支持 macOS / Linux;Windows 请用 build-desktop.cmd" >&2
        exit 2
        ;;
esac

SIDECAR_PATH="$BINARIES_DIR/$SIDECAR_NAME"

# ── 1. 参数解析 ──────────────────────────────────────────────────
SKIP_SERVER=0
SKIP_HEALTHCHECK=0
SKIP_FRONTEND=0
SKIP_INSTALL=0
SKIP_TYPECHECK=0
BUNDLE_ONLY=0
CLEAN=0
VERBOSE=0

usage() {
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-server)      SKIP_SERVER=1 ;;
        --skip-healthcheck) SKIP_HEALTHCHECK=1 ;;
        --skip-frontend)    SKIP_FRONTEND=1 ;;
        --skip-install)     SKIP_INSTALL=1 ;;
        --skip-typecheck)   SKIP_TYPECHECK=1 ;;
        --bundle-only)      BUNDLE_ONLY=1 ;;
        --clean)            CLEAN=1 ;;
        --verbose|-v)       VERBOSE=1 ;;
        -h|--help)          usage ;;
        *)
            echo "[FAIL] 未知参数: $1" >&2
            echo "可用参数:--skip-server / --skip-healthcheck / --skip-frontend / --skip-install / --skip-typecheck / --bundle-only / --clean / --verbose" >&2
            exit 2 ;;
    esac
    shift
done

if [[ "$BUNDLE_ONLY" == "1" ]]; then
    SKIP_SERVER=1
    SKIP_HEALTHCHECK=1
    SKIP_INSTALL=1
    SKIP_TYPECHECK=1
fi

# ── 2. 颜色 + 日志助手 ────────────────────────────────────────────
if [[ -t 1 ]] && [[ "${NO_COLOR:-}" == "" ]]; then
    C_RESET=$'\033[0m' ; C_BOLD=$'\033[1m'
    C_GREEN=$'\033[32m' ; C_YELLOW=$'\033[33m' ; C_RED=$'\033[31m' ; C_CYAN=$'\033[36m'
else
    C_RESET= ; C_BOLD= ; C_GREEN= ; C_YELLOW= ; C_RED= ; C_CYAN=
fi

step() { echo "${C_BOLD}${C_CYAN}» $*${C_RESET}"; }
ok()   { echo "${C_GREEN}[OK]${C_RESET} $*"; }
skip() { echo "${C_YELLOW}[SKIP]${C_RESET} $*"; }
fail() { echo "${C_RED}[FAIL]${C_RESET} $*" >&2; }
note() { echo "    ${C_YELLOW}↪${C_RESET} $*"; }

invoke_step() {
    local name="$1" ; shift
    local workdir="$1" ; shift
    step "▸ $name"
    if [[ "$VERBOSE" == "1" ]]; then
        ( cd "$workdir" && "$@" )
    else
        local logfile
        logfile="$(mktemp -t chayuan-build-XXXXXX.log)"
        if ( cd "$workdir" && "$@" ) >"$logfile" 2>&1 ; then
            ok "$name"
            rm -f "$logfile"
        else
            local rc=$?
            fail "$name 失败 (rc=$rc),最后 50 行:"
            tail -n 50 "$logfile" | sed 's/^/    /'
            note "完整日志: $logfile"
            exit $rc
        fi
    fi
}

# ── 3. 工作区 + 工具链探测 ────────────────────────────────────────
step '工作区'
note "OS:        $OS_NAME"
note "Arch:      $ARCH ($TRIPLE)"
note "Workspace: $WORKSPACE"
note "Sidecar:   $SIDECAR_NAME"
[[ -d "$SERVER_DIR" ]] || { fail "找不到 chayuan-server 目录" ; exit 2; }
[[ -d "$CLIENT_DIR" ]] || { fail "找不到 chayuan-client 目录" ; exit 2; }

require_cmd() {
    local cmd="$1" hint="$2"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        fail "缺工具 '$cmd'。$hint"
        exit 127
    fi
    note "$cmd -> $(command -v "$cmd")"
}

step '工具链检查'
if [[ "$SKIP_SERVER" != "1" ]]; then
    require_cmd python3 "请装 Python 3.10+ (https://www.python.org/downloads/)"
    if ! command -v poetry >/dev/null 2>&1; then
        note "未检测到 poetry,后端打包将走 ${C_BOLD}python3 -m pip / pyinstaller${C_RESET}"
    else
        note "poetry -> $(command -v poetry)"
    fi
fi
if [[ "$SKIP_FRONTEND" != "1" ]]; then
    require_cmd pnpm "请装 pnpm (corepack enable;npm i -g pnpm)"
    require_cmd cargo "请装 Rust (https://rustup.rs)"
fi

# ── 4. 可选清理 ──────────────────────────────────────────────────
if [[ "$CLEAN" == "1" ]]; then
    step '清理'
    rm -rf "$SERVER_DIR/dist" 2>/dev/null && note "清 chayuan-server/dist" || true
    rm -rf "$TAURI_BUNDLE" 2>/dev/null && note "清 src-tauri/target/release/bundle" || true
fi

# ── 5. Step 1: chayuan-server PyInstaller ─────────────────────────
if [[ "$SKIP_SERVER" == "1" ]]; then
    step 'Step 1 [skipped]'
    if [[ ! -f "$SIDECAR_PATH" ]]; then
        fail "传了 --skip-server 但 sidecar 不存在: $SIDECAR_PATH"
        note "去掉 --skip-server 重跑,或先复制其它机器上同 triple 的 sidecar 进来。"
        exit 1
    fi
    sz=$(du -m "$SIDECAR_PATH" | awk '{print $1}')
    ok "复用现有 sidecar: $SIDECAR_PATH (${sz} MB)"
else
    step 'Step 1: chayuan-server PyInstaller'
    # 杀残留(上次 healthz 探测没干净时常见)
    pkill -f 'chayuan-server' 2>/dev/null && note "已清理残留 chayuan-server 进程" || true

    # 优先 poetry,无 poetry 用裸 python(假定 deps 已用 pip 装好)
    if command -v poetry >/dev/null 2>&1; then
        invoke_step 'pyinstaller (poetry)' "$SERVER_DIR" \
            poetry run python packaging/pyinstaller/build.py
    else
        # 检查 pyinstaller 是否就绪
        if ! python3 -c "import PyInstaller" 2>/dev/null; then
            fail "python3 找不到 PyInstaller。请先 'pip install pyinstaller>=6.0' 或装 poetry。"
            exit 127
        fi
        invoke_step 'pyinstaller (python3)' "$SERVER_DIR" \
            python3 packaging/pyinstaller/build.py
    fi

    if [[ ! -f "$SIDECAR_PATH" ]]; then
        fail "PyInstaller 跑完了但 sidecar 没出现在: $SIDECAR_PATH"
        note "build.py 是按 host triple ($TRIPLE) 命名的,如果实际产物名不一致,看 build.py::rust_target_triple"
        exit 1
    fi
    chmod +x "$SIDECAR_PATH"
    sz=$(du -m "$SIDECAR_PATH" | awk '{print $1}')
    ok "Sidecar 已就位: $SIDECAR_PATH (${sz} MB)"
fi

# ── 6. Step 2: /healthz 探测 ─────────────────────────────────────
if [[ "$SKIP_HEALTHCHECK" == "1" ]]; then
    step 'Step 2 [skipped]'
else
    step 'Step 2: sidecar /healthz 探测'
    tmp_data="$(mktemp -d -t chayuan-health-XXXXXX)"
    export CHAYUAN_ROOT="$tmp_data"
    note "临时数据目录(测完即删):$tmp_data"

    stdout_log="$(mktemp -t chayuan-health-stdout-XXXXXX.log)"
    stderr_log="$(mktemp -t chayuan-health-stderr-XXXXXX.log)"

    "$SIDECAR_PATH" start -a --single-machine \
        > "$stdout_log" 2> "$stderr_log" &
    sidecar_pid=$!
    note "PID=$sidecar_pid;最长等 180s 直到 /healthz 200(onefile 解压 + bootstrap 慢)"

    deadline=$(( $(date +%s) + 180 ))
    ready=0
    while [[ $(date +%s) -lt $deadline ]]; do
        if ! kill -0 "$sidecar_pid" 2>/dev/null; then
            break  # 子进程已退出,跳出等待
        fi
        if curl -fsS --max-time 2 'http://127.0.0.1:62581/healthz' >/dev/null 2>&1; then
            ready=1
            break
        fi
        sleep 0.8
    done

    # 杀整棵进程树
    if kill -0 "$sidecar_pid" 2>/dev/null; then
        kill -TERM "$sidecar_pid" 2>/dev/null || true
        sleep 1
        kill -KILL "$sidecar_pid" 2>/dev/null || true
    fi
    pkill -f 'chayuan-server' 2>/dev/null || true
    rm -rf "$tmp_data" 2>/dev/null || true

    if [[ "$ready" == "1" ]]; then
        ok 'sidecar 180s 内 /healthz 返 200'
        rm -f "$stdout_log" "$stderr_log"
    else
        fail 'sidecar 启动失败或 /healthz 不响应。stderr 尾部:'
        tail -n 40 "$stderr_log" | sed 's/^/    /'
        note "stdout 日志: $stdout_log"
        note "stderr 日志: $stderr_log"
        exit 1
    fi
fi

# ── 7. Step 3: chayuan-client Tauri bundle ────────────────────────
if [[ "$SKIP_FRONTEND" == "1" ]]; then
    step 'Step 3 [skipped]'
else
    step 'Step 3: chayuan-client Tauri bundle'

    if [[ "$SKIP_INSTALL" == "1" ]]; then
        skip 'Step 3a [pnpm install] (--skip-install)'
    else
        invoke_step 'pnpm install' "$CLIENT_DIR" pnpm install --frozen-lockfile
    fi

    if [[ "$SKIP_TYPECHECK" == "1" ]]; then
        skip 'Step 3b [pnpm typecheck] (--skip-typecheck)'
    else
        invoke_step 'pnpm typecheck' "$CLIENT_DIR" pnpm typecheck
    fi

    if [[ "$BUNDLE_ONLY" == "1" ]]; then
        # cargo / vite 走增量缓存,只重做 Tauri bundle(makensis / dmg / deb / appimage 等)
        invoke_step 'tauri build (bundle-only)' "$DESKTOP_DIR" \
            pnpm exec tauri build
    else
        invoke_step 'pnpm build:desktop' "$CLIENT_DIR" pnpm build:desktop
    fi

    # 列出产物 — Tauri 默认输出文件名已经带架构后缀
    artifacts=()
    if [[ -d "$TAURI_BUNDLE" ]]; then
        for sub in dmg macos deb appimage rpm; do
            for f in "$TAURI_BUNDLE/$sub"/* ; do
                [[ -f "$f" ]] && artifacts+=("$f")
            done
        done
    fi
    if [[ "${#artifacts[@]}" == "0" ]]; then
        fail "Tauri bundle 没产出文件;看 $TAURI_BUNDLE"
        exit 1
    fi
    ok 'Tauri bundle 完成:'
    for a in "${artifacts[@]}"; do
        sz=$(du -m "$a" | awk '{print $1}')
        echo "    $a (${sz} MB)"
    done
fi

# ── 8. 总结 ──────────────────────────────────────────────────────
step '完成'
note "host: $OS_NAME / $ARCH ($TRIPLE)"
note "sidecar:   $SIDECAR_PATH"
if [[ "$SKIP_FRONTEND" != "1" ]]; then
    note "installer: $TAURI_BUNDLE/{dmg,macos,deb,appimage,rpm}/"
fi
echo ""
echo "${C_BOLD}${C_YELLOW}⚠ 本次产物只能跑在 ${ARCH} 架构机器上${C_RESET}"
echo "  其它架构请在对应 CPU 机器上重跑本脚本(或 CI 双 runner)。"
echo ""
echo "${C_GREEN}[OK] 全部步骤通过${C_RESET}"

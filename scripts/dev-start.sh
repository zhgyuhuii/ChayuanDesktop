#!/usr/bin/env bash
# dev-start.sh — 一键启动 chayuan-server 开发环境(macOS / Linux)
#
# 做什么:
#   1. 检测 host 平台 → 用对的 vendor/services/<engine>/<platform>/ 子目录
#   2. 检查 Python (poetry / pip) + chayuan-server 已 editable install
#   3. 检查 vendor binary(llama-server / whisper-server)就位,缺时给指引
#   4. 检查 CHAYUAN_ROOT 数据目录可写,默认 ~/.chayuan-dev
#   5. 顺手起 chayuan-server start -a --single-machine,前台运行
#
# 用法:
#   bash scripts/dev-start.sh                       # 默认前台跑
#   bash scripts/dev-start.sh --bg                  # 后台跑,PID 写到 /tmp/chayuan-dev.pid
#   bash scripts/dev-start.sh --check-only          # 只 preflight,不启
#   bash scripts/dev-start.sh --port 62581          # 自定义 API 端口
#   CHAYUAN_VENDOR_PLATFORM=linux-x64 bash ...      # 强制 vendor 平台
#   CHAYUAN_ROOT=/tmp/dev bash ...                  # 自定义数据目录
set -euo pipefail

# ────────────────────────── 编码:确保终端 UTF-8 ────────────────
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export PYTHONIOENCODING="utf-8"

# ────────────────────────── 参数解析 ────────────────────────────
BG=0
CHECK_ONLY=0
PORT="62581"
while [ $# -gt 0 ]; do
    case "$1" in
        --bg) BG=1; shift ;;
        --check-only) CHECK_ONLY=1; shift ;;
        --port) PORT="$2"; shift 2 ;;
        --port=*) PORT="${1#*=}"; shift ;;
        -h|--help)
            grep -E '^#' "$0" | sed 's/^# \?//' | head -25
            exit 0 ;;
        *) echo "[dev-start] 未知参数 $1" >&2; exit 64 ;;
    esac
done

# ────────────────────────── 输出辅助 ────────────────────────────
RED=$(printf '\033[0;31m'); GREEN=$(printf '\033[0;32m')
YELLOW=$(printf '\033[1;33m'); BOLD=$(printf '\033[1m'); RESET=$(printf '\033[0m')
ok()    { echo "${GREEN}✓${RESET} $*"; }
warn()  { echo "${YELLOW}⚠${RESET} $*" >&2; }
err()   { echo "${RED}✗${RESET} $*" >&2; }
step()  { echo "${BOLD}→${RESET} $*"; }

# ────────────────────────── 定位仓库 ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER="$REPO/chayuan-server"

cd "$REPO"
step "工作目录:$REPO"

# ────────────────────────── 1. host 平台检测 ────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
    Darwin)
        case "$ARCH" in
            arm64|aarch64) PLAT="macos-arm64" ;;
            *)             PLAT="macos-x64" ;;
        esac ;;
    Linux)
        case "$ARCH" in
            aarch64|arm64) PLAT="linux-arm64" ;;
            *)             PLAT="linux-x64" ;;
        esac ;;
    *) err "不支持的 OS:$OS。Windows 请用 scripts/dev-start.ps1"; exit 1 ;;
esac
PLAT="${CHAYUAN_VENDOR_PLATFORM:-$PLAT}"
ok "host:$OS $ARCH → vendor 子目录 = $PLAT"

# ────────────────────────── 2. Python + chayuan 包 ──────────────
step "Step 1/4: 检查 Python 环境"
PYTHON_BIN=""
if command -v poetry >/dev/null 2>&1; then
    if (cd "$SERVER" && poetry env info --path >/dev/null 2>&1); then
        PYTHON_BIN="$(cd "$SERVER" && poetry env info --path)/bin/python"
        ok "poetry venv 就绪:$PYTHON_BIN"
    else
        warn "poetry 在,但 venv 未建。先跑 'cd chayuan-server && poetry install --only main'"
    fi
fi
if [ -z "$PYTHON_BIN" ]; then
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN="$(command -v python3)"
        # 两种合法情况:1) pip install -e 装了;2) 源码树 + PYTHONPATH
        export PYTHONPATH="$SERVER/libs/chayuan-server${PYTHONPATH:+:$PYTHONPATH}"
        if "$PYTHON_BIN" -c "import chayuan" 2>/dev/null; then
            ok "Python:$PYTHON_BIN(可 import chayuan,PYTHONPATH=$SERVER/libs/chayuan-server)"
        else
            warn "Python 在 ($PYTHON_BIN) 但 import chayuan 失败"
            echo "    解法 1:cd chayuan-server && pip install -e libs/chayuan-server" >&2
            echo "    解法 2:检查 chayuan-server/libs/chayuan-server/chayuan/__init__.py 存在" >&2
            [ $CHECK_ONLY -eq 0 ] && exit 2
        fi
    else
        err "找不到 python3 也找不到 poetry"
        echo "    macOS:  brew install python@3.12 poetry" >&2
        echo "    Linux:  apt install -y python3.12 python3-pip;pip install poetry" >&2
        exit 1
    fi
fi

# ────────────────────────── 3. vendor binary ────────────────────
step "Step 2/4: 检查 vendor 二进制"
LLAMA_DIR="$SERVER/vendor/services/llama-server/$PLAT"
WHISPER_DIR="$SERVER/vendor/services/whisper-server/$PLAT"

if [ -x "$LLAMA_DIR/llama-server" ]; then
    ok "llama-server:$LLAMA_DIR/llama-server"
else
    warn "llama-server 不在 $LLAMA_DIR/"
    echo "    解法:bash scripts/install-llama-server.sh --target $PLAT" >&2
    [ $CHECK_ONLY -eq 0 ] && [ "$PLAT" != "linux-arm64" ] && exit 2
fi

if [ -x "$WHISPER_DIR/whisper-server" ]; then
    ok "whisper-server:$WHISPER_DIR/whisper-server"
else
    warn "whisper-server 不在 $WHISPER_DIR/(ASR 会 fallback Python faster-whisper)"
    echo "    解法:bash scripts/install-whisper-server.sh --target $PLAT" >&2
fi

# ────────────────────────── 4. CHAYUAN_ROOT ─────────────────────
step "Step 3/4: CHAYUAN_ROOT 数据目录"
CHAYUAN_ROOT="${CHAYUAN_ROOT:-$HOME/.chayuan-dev}"
mkdir -p "$CHAYUAN_ROOT"
if [ ! -w "$CHAYUAN_ROOT" ]; then
    err "CHAYUAN_ROOT=$CHAYUAN_ROOT 不可写"
    exit 1
fi
export CHAYUAN_ROOT
export CHAYUAN_VENDOR_PLATFORM="$PLAT"
ok "CHAYUAN_ROOT=$CHAYUAN_ROOT(env CHAYUAN_VENDOR_PLATFORM=$PLAT)"

# 首次需 chayuan init -q,创建基础 yaml
if [ ! -f "$CHAYUAN_ROOT/basic_settings.yaml" ]; then
    step "首次启动:跑 chayuan init -q 初始化数据目录"
    if command -v poetry >/dev/null 2>&1; then
        (cd "$SERVER" && poetry run python -m chayuan init -q --profile local)
    else
        (cd "$SERVER" && "$PYTHON_BIN" -m chayuan init -q --profile local)
    fi
    ok "基础 yaml 已生成 → $CHAYUAN_ROOT/"
fi

if [ $CHECK_ONLY -eq 1 ]; then
    ok "preflight 全部通过(--check-only)"
    exit 0
fi

# ────────────────────────── 5. 启 chayuan-server ────────────────
step "Step 4/4: 启 chayuan-server (port=$PORT)"
LOG_FILE="${TMPDIR:-/tmp}/chayuan-dev.log"
PID_FILE="${TMPDIR:-/tmp}/chayuan-dev.pid"

# 清理已有进程
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    warn "已有 dev sidecar pid=$(cat "$PID_FILE"),先杀掉"
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    sleep 1
fi

if command -v poetry >/dev/null 2>&1 && (cd "$SERVER" && poetry env info --path >/dev/null 2>&1); then
    CMD=(poetry run python -m chayuan start -a --single-machine)
else
    CMD=("$PYTHON_BIN" -m chayuan start -a --single-machine)
fi

cd "$SERVER"
if [ $BG -eq 1 ]; then
    nohup "${CMD[@]}" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    ok "后台启动 pid=$(cat "$PID_FILE"),日志:$LOG_FILE"
    echo "    tail -f $LOG_FILE   # 看日志"
    echo "    curl http://127.0.0.1:$PORT/healthz   # 探活"
    echo "    kill \$(cat $PID_FILE)   # 关掉"
else
    ok "前台启动(Ctrl+C 退出)"
    exec "${CMD[@]}"
fi

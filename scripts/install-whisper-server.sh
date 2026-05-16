#!/usr/bin/env bash
# install-whisper-server.sh — 装 whisper-server 二进制 (Mac / Linux)
#
# 现状(2026-05-16):whisper.cpp upstream 官方只发 Windows pre-built
# (whisper-bin-Win32.zip / whisper-bin-x64.zip,从 v1.7.6 起),**没有**
# Linux/Mac 现成 binary。所以本脚本走两条路:
#
#  1. Mac:优先用 `brew install whisper-cpp`(主仓 formula,带 whisper-server),
#         brew 不在就 fallback 到源码 cmake build。
#  2. Linux:只能源码 cmake build,需要 cmake + g++ + git。
#
# 用法: bash scripts/install-whisper-server.sh [tag]
#   tag: 可选 git tag(源码 build 时 checkout 用),默认 v1.7.6
set -euo pipefail

VERSION="${1:-v1.7.6}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# 注意:必须装到 chayuan-server/vendor/services/ 才能被
# chayuan/server/model_registry/local_runtime.py:_default_install_services_dirs()
# 的 parents[5] = chayuan-server 搜到(跟 install-llama-server.sh 一致)。
DEST_DIR="$REPO_ROOT/chayuan-server/vendor/services/whisper-server"

mkdir -p "$DEST_DIR"

OS="$(uname -s)"
case "$OS" in
    Darwin|Linux) ;;
    *)
        echo "[install-whisper-server] 不支持的 OS: $OS(只支持 macOS / Linux)" >&2
        exit 1
        ;;
esac

# ────────────────────────── 路径 1:macOS brew ──────────────────────────
try_brew() {
    [ "$OS" = "Darwin" ] || return 1
    command -v brew >/dev/null 2>&1 || return 1
    echo "[install-whisper-server] 检测到 brew,尝试 brew install whisper-cpp..."
    if ! brew list whisper-cpp >/dev/null 2>&1; then
        brew install whisper-cpp || return 1
    fi
    local brew_bin
    brew_bin="$(brew --prefix whisper-cpp 2>/dev/null)/bin/whisper-server"
    [ -x "$brew_bin" ] || return 1
    cp -f "$brew_bin" "$DEST_DIR/whisper-server"
    chmod +x "$DEST_DIR/whisper-server"
    # mac brew formula 把 .dylib 链到 cellar,运行时不需要拷
    printf 'brew:%s\n%s\n' "$(brew list --versions whisper-cpp | awk '{print $2}')" "$(date '+%Y-%m-%d')" > "$DEST_DIR/VERSION"
    return 0
}

# ────────────────────────── 路径 2:源码 cmake build ──────────────────────
try_build_from_source() {
    for tool in cmake make git cc; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "[install-whisper-server] 构建需要 $tool 但未安装" >&2
            echo "    macOS:  brew install cmake git" >&2
            echo "    Linux:  apt install -y cmake build-essential git  # 或 dnf/yum 等价" >&2
            return 1
        fi
    done

    local SRC="${TMPDIR:-/tmp}/whisper.cpp-$VERSION-src"
    if [ ! -d "$SRC/.git" ]; then
        rm -rf "$SRC"
        echo "[install-whisper-server] git clone whisper.cpp@$VERSION → $SRC"
        git clone --depth 1 --branch "$VERSION" https://github.com/ggml-org/whisper.cpp.git "$SRC"
    else
        echo "[install-whisper-server] 复用已有 src tree $SRC"
        (cd "$SRC" && git fetch --depth 1 origin "$VERSION" && git checkout FETCH_HEAD) || true
    fi

    echo "[install-whisper-server] cmake -B build -DWHISPER_BUILD_SERVER=ON ..."
    (
        cd "$SRC"
        cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON >/dev/null
        cmake --build build --target whisper-server -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
    )

    local BUILT
    BUILT="$(find "$SRC/build" -name whisper-server -type f -executable | head -n 1 || true)"
    if [ -z "$BUILT" ]; then
        echo "[install-whisper-server] cmake build 完了但找不到 whisper-server 产物 $SRC/build/" >&2
        return 1
    fi

    # 清旧 binary + 共享库
    find "$DEST_DIR" -maxdepth 1 -type f \
        \( -name "whisper-server" -o -name "*.dylib" -o -name "*.so" -o -name "*.so.*" \) \
        -delete 2>/dev/null || true

    cp -f "$BUILT" "$DEST_DIR/whisper-server"
    chmod +x "$DEST_DIR/whisper-server"

    # 同时收 build/ 里的 .so / .dylib(whisper.cpp 多个共享库依赖)
    find "$SRC/build" \( -name "*.dylib" -o -name "*.so" -o -name "*.so.*" \) -type f \
        -exec cp -f {} "$DEST_DIR/" \; 2>/dev/null || true

    printf 'src:%s\n%s\n' "$VERSION" "$(date '+%Y-%m-%d')" > "$DEST_DIR/VERSION"
    return 0
}

ok=0
echo "[install-whisper-server] OS=$OS DEST=$DEST_DIR"
if try_brew; then
    ok=1
    echo "[install-whisper-server] brew 装好 → $DEST_DIR"
elif try_build_from_source; then
    ok=1
    echo "[install-whisper-server] 源码 build 完成 → $DEST_DIR"
fi

if [ $ok -eq 0 ]; then
    echo "[install-whisper-server] 装失败。可选解法:" >&2
    echo "  - macOS:brew install whisper-cpp;然后重跑本脚本" >&2
    echo "  - Linux:装 cmake / build-essential / git;然后重跑本脚本" >&2
    echo "  - 或直接拷一份你自己编好的 whisper-server 到 $DEST_DIR/" >&2
    exit 1
fi

echo ""
echo "[install-whisper-server] 完成。$DEST_DIR 内容:"
ls -lh "$DEST_DIR"

echo ""
echo "[install-whisper-server] 验证 binary..."
"$DEST_DIR/whisper-server" --help 2>&1 | head -3 || {
    echo "[install-whisper-server] whisper-server --help 失败,可能依赖库缺失" >&2
    exit 2
}
echo "[install-whisper-server] OK"

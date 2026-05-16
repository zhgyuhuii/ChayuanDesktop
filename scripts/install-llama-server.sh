#!/usr/bin/env bash
# 下载 llama-server pre-built binary 到 vendor/services/llama-server/<platform>/
#
# 用法:
#   bash scripts/install-llama-server.sh [version] [--target <plat>]
#
#   version: llama.cpp release tag,默认 b4404
#   --target: vendor 平台子目录名 + 对应 upstream asset。不传 = 自动按 host 选。
#     支持:
#       linux-x64          (ubuntu x64,默认 Linux host)
#       linux-arm64        (Docker fallback,不走本脚本;装方法见 README)
#       macos-arm64        (Apple Silicon,默认 macOS arm64 host)
#       macos-x64          (Intel Mac,默认 macOS x86_64 host)
#       win-x64            (AVX2 默认)
#       win-x64-avx        (AVX 老 Sandy/Ivy Bridge)
#       win-x64-avx512     (Skylake-X / Xeon)
#       win-x64-noavx      (Pentium/VM)
#       win-arm64          (Surface Pro X / Copilot+)
#
# 例:
#   bash scripts/install-llama-server.sh                      # 自动 host
#   bash scripts/install-llama-server.sh b4404 --target win-x64-noavx
set -euo pipefail

VERSION="b4404"
TARGET=""
# 解析 args:第一个非 -- 开头的非空 arg 当 VERSION,--target <val> 取 TARGET
while [ $# -gt 0 ]; do
    case "$1" in
        --target) TARGET="$2"; shift 2 ;;
        --target=*) TARGET="${1#*=}"; shift ;;
        -h|--help)
            grep -E '^#' "$0" | sed 's/^# \?//'
            exit 0 ;;
        --) shift; break ;;
        -*) echo "[install] 未知参数 $1" >&2; exit 64 ;;
        *) VERSION="$1"; shift ;;
    esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(dirname "$HERE")"

# 自动 host 检测(TARGET 没传时用)
detect_host_target() {
    OS="$(uname -s)"
    M="$(uname -m)"
    case "$OS" in
        Linux)
            case "$M" in
                aarch64|arm64) echo "linux-arm64" ;;
                *)             echo "linux-x64" ;;
            esac ;;
        Darwin)
            case "$M" in
                arm64|aarch64) echo "macos-arm64" ;;
                *)             echo "macos-x64" ;;
            esac ;;
        *) echo "" ;;
    esac
}

if [ -z "$TARGET" ]; then
    TARGET="$(detect_host_target)"
    if [ -z "$TARGET" ]; then
        echo "[install] 不支持的 host OS $(uname -s),请显式传 --target" >&2
        exit 1
    fi
fi

# target → upstream asset name
case "$TARGET" in
    linux-x64)        ASSET="llama-$VERSION-bin-ubuntu-x64.zip" ;;
    macos-arm64)      ASSET="llama-$VERSION-bin-macos-arm64.zip" ;;
    macos-x64)        ASSET="llama-$VERSION-bin-macos-x64.zip" ;;
    win-x64)          ASSET="llama-$VERSION-bin-win-avx2-x64.zip" ;;
    win-x64-avx)      ASSET="llama-$VERSION-bin-win-avx-x64.zip" ;;
    win-x64-avx512)   ASSET="llama-$VERSION-bin-win-avx512-x64.zip" ;;
    win-x64-noavx)    ASSET="llama-$VERSION-bin-win-noavx-x64.zip" ;;
    win-arm64)        ASSET="llama-$VERSION-bin-win-llvm-arm64.zip" ;;
    linux-arm64)
        echo "[install] linux-arm64 upstream 没发 zip。" >&2
        echo "  解法 1:docker create ghcr.io/ggml-org/llama.cpp:server (arm64) + cp /app/* 到 vendor/.../linux-arm64/" >&2
        echo "  解法 2:在 ARM Linux 机上源码 cmake build" >&2
        exit 2 ;;
    *) echo "[install] 未识别的 target: $TARGET" >&2; exit 1 ;;
esac

DEST="$WORKSPACE/chayuan-server/vendor/services/llama-server/$TARGET"
mkdir -p "$DEST"

URL="https://github.com/ggerganov/llama.cpp/releases/download/$VERSION/$ASSET"
TMPZIP="/tmp/$ASSET"

echo "[install-llama-server] target=$TARGET asset=$ASSET dest=$DEST"
echo "[install-llama-server] 下载 $URL"
curl -L -o "$TMPZIP" "$URL"
echo "[install-llama-server] 下完 $(du -h "$TMPZIP" | cut -f1)"

TMP_EXTRACT="/tmp/llama-$VERSION-$TARGET-extract"
rm -rf "$TMP_EXTRACT"
mkdir -p "$TMP_EXTRACT"
# 解压:unzip 首选,bsdtar / python3 zipfile 兜底(AL8 / Alpine minimal 默认不带 unzip)
if command -v unzip >/dev/null 2>&1; then
    unzip -q "$TMPZIP" -d "$TMP_EXTRACT"
elif command -v bsdtar >/dev/null 2>&1; then
    bsdtar -xf "$TMPZIP" -C "$TMP_EXTRACT"
elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$TMPZIP" "$TMP_EXTRACT"
else
    echo "[install-llama-server] 没找到 unzip / bsdtar / python3,无法解压 $TMPZIP" >&2
    exit 2
fi

# 清旧 binary / dll / so / dylib(保留 LICENSE 之类不动)
find "$DEST" -maxdepth 1 -type f \
    \( -name '*.exe' -o -name '*.dll' -o -name '*.so' -o -name '*.dylib' \
       -o -name 'llama-server' -o -name 'ggml-metal.metal' \) \
    -delete 2>/dev/null || true

# Win 包结构:zip 顶层就是 *.exe + *.dll。Mac/Linux 包:build/bin/ 下。
# 通配两种,只拷主 binary + 共享库 / Metal shader。
find "$TMP_EXTRACT" -type f \
    \( -name 'llama-server' -o -name 'llama-server.exe' \
       -o -name '*.dll' -o -name '*.so' -o -name '*.dylib' \
       -o -name 'ggml-metal.metal' \) \
    -exec cp -f {} "$DEST/" \;

[ -f "$DEST/llama-server" ] && chmod +x "$DEST/llama-server"

# 写元数据
echo -e "$VERSION\n$(date +%Y-%m-%d)" > "$DEST/VERSION"
# 如果 LICENSE 不存在,从 zip 里拷一份
if [ ! -f "$DEST/LICENSE" ]; then
    LIC=$(find "$TMP_EXTRACT" -type f -name 'LICENSE' | head -1 || true)
    [ -n "$LIC" ] && cp "$LIC" "$DEST/LICENSE"
fi

rm "$TMPZIP"
rm -rf "$TMP_EXTRACT"

echo
echo "[install-llama-server] 完成 → $DEST:"
ls -lh "$DEST"

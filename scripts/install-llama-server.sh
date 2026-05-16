#!/usr/bin/env bash
# 下载 llama-server (Linux/Mac dev 用) 到 vendor/services/llama-server/
set -euo pipefail

VERSION="${1:-b4404}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(dirname "$HERE")"
DEST="$WORKSPACE/chayuan-server/vendor/services/llama-server"

mkdir -p "$DEST"

OS="$(uname -s)"
case "$OS" in
    Linux)  ZIP="llama-$VERSION-bin-ubuntu-x64.zip" ;;
    Darwin) ZIP="llama-$VERSION-bin-macos-arm64.zip" ;;
    *) echo "[install] 不支持的 OS: $OS" >&2; exit 1 ;;
esac

URL="https://github.com/ggerganov/llama.cpp/releases/download/$VERSION/$ZIP"
TMPZIP="/tmp/$ZIP"

echo "[install-llama-server] 下载 $URL"
curl -L -o "$TMPZIP" "$URL"
echo "[install-llama-server] 下完 $(du -h "$TMPZIP" | cut -f1)"

TMP_EXTRACT="/tmp/llama-$VERSION-extract"
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

# 清旧二进制
find "$DEST" -maxdepth 1 -type f \( -name '*.exe' -o -name '*.dll' -o -name '*.so' -o -name '*.dylib' -o -name 'llama-server' \) -delete 2>/dev/null || true

# 拷 llama-server + .so / .dylib
find "$TMP_EXTRACT" -type f \( -name 'llama-server' -o -name '*.so' -o -name '*.dylib' \) -exec cp -v {} "$DEST/" \;

echo -e "$VERSION\n$(date +%Y-%m-%d)" > "$DEST/VERSION"
rm "$TMPZIP"
rm -rf "$TMP_EXTRACT"

echo
echo "[install-llama-server] 完成:"
ls -lh "$DEST"

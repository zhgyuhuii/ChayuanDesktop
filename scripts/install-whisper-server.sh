#!/usr/bin/env bash
# install-whisper-server.sh — 下载 whisper.cpp `whisper-server` (Mac / Linux)
# 用法: bash scripts/install-whisper-server.sh [tag]
#   tag: 可选，指定优先 release tag，默认 v1.7.4
set -euo pipefail

VERSION="${1:-v1.7.4}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST_DIR="$REPO_ROOT/vendor/services/whisper-server"

mkdir -p "$DEST_DIR"

OS="$(uname -s)"
case "$OS" in
    Darwin)
        ASSET="whisper-bin-macos-arm64.tar.gz"
        PLATFORM="macos-arm64"
        ;;
    Linux)
        ASSET="whisper-bin-linux-x64.tar.gz"
        PLATFORM="linux-x64"
        ;;
    *)
        echo "[install-whisper-server] 不支持的 OS: $OS" >&2
        exit 1
        ;;
esac

# 多 tag fallback：优先用参数传入版本，再依次尝试旧版
TAGS=()
TAGS+=("$VERSION")
for fallback in "v1.7.4" "v1.7.3" "v1.7.2"; do
    # 去重：只添加不在 TAGS 中的版本
    already=0
    for t in "${TAGS[@]}"; do
        [ "$t" = "$fallback" ] && already=1 && break
    done
    [ $already -eq 0 ] && TAGS+=("$fallback")
done

TMP="${TMPDIR:-/tmp}/whisper-server-$$"
mkdir -p "$TMP"
trap "rm -rf '$TMP'" EXIT

ok=0
for tag in "${TAGS[@]}"; do
    URL="https://github.com/ggerganov/whisper.cpp/releases/download/$tag/$ASSET"
    echo "[install-whisper-server] 尝试拉 $URL"
    if curl -fsSL "$URL" -o "$TMP/asset.tar.gz" 2>/dev/null; then
        EXTRACT_DIR="$TMP/extract"
        mkdir -p "$EXTRACT_DIR"
        tar -xzf "$TMP/asset.tar.gz" -C "$EXTRACT_DIR"

        SERVER_BIN="$(find "$EXTRACT_DIR" -name "whisper-server" -type f | head -n 1 || true)"
        if [ -z "$SERVER_BIN" ]; then
            echo "[install-whisper-server] $tag tarball 里没找到 whisper-server，试下一个 tag"
            rm -rf "$EXTRACT_DIR" "$TMP/asset.tar.gz"
            continue
        fi

        # 清旧 binary 和库文件
        find "$DEST_DIR" -maxdepth 1 -type f \
            \( -name "whisper-server" -o -name "*.dylib" -o -name "*.so" -o -name "*.so.*" \) \
            -delete 2>/dev/null || true

        # 拷 whisper-server binary
        cp "$SERVER_BIN" "$DEST_DIR/whisper-server"
        chmod +x "$DEST_DIR/whisper-server"

        # Mac/Linux：若 tarball 附带共享库一并复制
        find "$EXTRACT_DIR" \( -name "*.dylib" -o -name "*.so" -o -name "*.so.*" \) -type f \
            -exec cp -f {} "$DEST_DIR/" \;

        # 写 VERSION 文件
        printf '%s\n%s\n' "$tag" "$(date '+%Y-%m-%d')" > "$DEST_DIR/VERSION"

        ok=1
        echo "[install-whisper-server] 装好 $tag ($PLATFORM) → $DEST_DIR"
        break
    else
        echo "[install-whisper-server] $tag 下载失败"
    fi
done

if [ $ok -eq 0 ]; then
    echo "[install-whisper-server] 所有 release tag 都失败，检查网络 / GitHub release 可达性" >&2
    exit 1
fi

echo ""
echo "[install-whisper-server] 完成。$DEST_DIR 内容:"
ls -lh "$DEST_DIR"

# 验证 binary 可执行
echo ""
echo "[install-whisper-server] 验证 binary..."
"$DEST_DIR/whisper-server" --help 2>&1 | head -3 || {
    echo "[install-whisper-server] whisper-server --help 失败，可能依赖库缺失" >&2
    exit 2
}
echo "[install-whisper-server] OK"

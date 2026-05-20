#!/usr/bin/env bash
# install-whisper-server.sh — 装 whisper-server 二进制 (Mac / Linux)
#
# 注:版本号 / GitHub 镜像清单同时被「应用内运行时服务下载」复用 —— 真源是
# chayuan-server/.../chayuan/server/runtime/install_service.py
# (_WHISPER_VERSION / _whisper_asset_for / _GH_MIRRORS)。Windows 预编译 zip
# 走 install_service.py 直接下;本脚本只管 Mac/Linux 的 docker/brew/源码路径。
#
# 现状(2026-05-16):whisper.cpp upstream 官方只发 Windows pre-built,**没有**
# Linux/Mac binary。本脚本两条路:
#
#  1. Mac:优先 `brew install whisper-cpp`,brew 不在就源码 cmake build。
#  2. Linux:用 Docker (ghcr.io/ggml-org/whisper.cpp:main, amd64 only) 提取,
#     或源码 cmake build。
#
# 用法:
#   bash scripts/install-whisper-server.sh [tag] [--target <plat>]
#
#   tag: 可选 git tag,默认 v1.7.6
#   --target: 平台子目录名。不传 = 按 host 自动:
#     linux-x64    (Docker 提取或源码 build)
#     linux-arm64  (源码 build,Docker 无 arm64)
#     macos-arm64  (brew 或源码)
#     macos-x64    (brew 或源码)
set -euo pipefail

VERSION=""
TARGET=""
while [ $# -gt 0 ]; do
    case "$1" in
        --target) TARGET="$2"; shift 2 ;;
        --target=*) TARGET="${1#*=}"; shift ;;
        -h|--help)
            grep -E '^#' "$0" | sed 's/^# \?//'; exit 0 ;;
        --) shift; break ;;
        -*) echo "[install] 未知参数 $1" >&2; exit 64 ;;
        *) VERSION="$1"; shift ;;
    esac
done
VERSION="${VERSION:-v1.7.6}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 自动 host 检测(TARGET 没传时)
detect_host_target() {
    case "$(uname -s)" in
        Darwin)
            case "$(uname -m)" in
                arm64|aarch64) echo "macos-arm64" ;;
                *)             echo "macos-x64" ;;
            esac ;;
        Linux)
            case "$(uname -m)" in
                aarch64|arm64) echo "linux-arm64" ;;
                *)             echo "linux-x64" ;;
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

case "$TARGET" in
    linux-x64|linux-arm64|macos-arm64|macos-x64) ;;
    *) echo "[install] 未识别的 target: $TARGET (支持 linux-x64/linux-arm64/macos-arm64/macos-x64)" >&2; exit 1 ;;
esac

DEST_DIR="$REPO_ROOT/chayuan-server/vendor/services/whisper-server/$TARGET"
mkdir -p "$DEST_DIR"
OS="$(uname -s)"
echo "[install-whisper-server] target=$TARGET version=$VERSION dest=$DEST_DIR"

# ────────────────────────── 路径 0:Linux x64 Docker 提取 ────────────────
try_docker_linux() {
    [ "$TARGET" = "linux-x64" ] || return 1
    command -v docker >/dev/null 2>&1 || return 1
    echo "[install-whisper-server] 尝试从 ghcr.io/ggml-org/whisper.cpp:main (amd64) 提取..."
    docker pull --platform linux/amd64 ghcr.io/ggml-org/whisper.cpp:main >/dev/null 2>&1 || return 1
    local cid
    cid="$(docker create --platform linux/amd64 ghcr.io/ggml-org/whisper.cpp:main 2>/dev/null)" || return 1
    # 清旧 binary + .so(保留 LICENSE 等)
    find "$DEST_DIR" -maxdepth 1 -type f \
        \( -name 'whisper-server' -o -name '*.so' -o -name '*.so.*' -o -name 'Makefile' \
           -o -name 'CMakeCache.txt' -o -name 'cmake_install.cmake' \) -delete 2>/dev/null || true
    docker cp "$cid:/app/build/bin/whisper-server" "$DEST_DIR/whisper-server" >/dev/null 2>&1
    # 只挑 .so / .so.* 文件,过滤 docker cp 顺手带的 Makefile / CMakeCache 等
    local stage; stage="$(mktemp -d)"
    docker cp "$cid:/app/build/src/." "$stage/src/" >/dev/null 2>&1 || true
    docker cp "$cid:/app/build/ggml/src/." "$stage/ggml/" >/dev/null 2>&1 || true
    # 注意 find -o 优先级:括起来不让 -type 偏到 -o 另一边。
    # 我们要的是 "(name 匹配 lib*.so* )AND ( 文件或软链 )"。
    find "$stage" \( -name 'lib*.so' -o -name 'lib*.so.*' \) \
                  \( -type f -o -type l \) \
        -exec cp -a {} "$DEST_DIR/" \; 2>/dev/null || true
    rm -rf "$stage"
    docker rm "$cid" >/dev/null 2>&1 || true
    [ -x "$DEST_DIR/whisper-server" ] || return 1
    chmod +x "$DEST_DIR/whisper-server"
    printf 'docker:ghcr.io/ggml-org/whisper.cpp:main (amd64)\n%s\n' "$(date '+%Y-%m-%d')" > "$DEST_DIR/VERSION"
    return 0
}

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
    # GitHub 镜像支持:墙内设 export GITHUB_MIRROR="https://gh-proxy.com/",
    # git clone URL 拼成 https://gh-proxy.com/https://github.com/...(这类
    # 代理支持 git 协议)。后续 git fetch 走 clone 时设好的 origin,自动同源。
    # 注:老的 ghproxy.com 已废弃,用 gh-proxy.com 或 ghfast.top。
    local WHISPER_REPO="https://github.com/ggml-org/whisper.cpp.git"
    if [ -n "${GITHUB_MIRROR:-}" ]; then
        WHISPER_REPO="${GITHUB_MIRROR%/}/https://github.com/ggml-org/whisper.cpp.git"
        echo "[install-whisper-server] 经 GitHub 镜像:${GITHUB_MIRROR%/}/"
    fi
    if [ ! -d "$SRC/.git" ]; then
        rm -rf "$SRC"
        echo "[install-whisper-server] git clone whisper.cpp@$VERSION → $SRC"
        git clone --depth 1 --branch "$VERSION" "$WHISPER_REPO" "$SRC"
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
echo "[install-whisper-server] OS=$OS target=$TARGET DEST=$DEST_DIR"
# 优先级:Docker(只对 linux-x64) > brew(Mac) > cmake build(都行)
if try_docker_linux; then
    ok=1
    echo "[install-whisper-server] Docker 提取完成 → $DEST_DIR"
elif try_brew; then
    ok=1
    echo "[install-whisper-server] brew 装好 → $DEST_DIR"
elif try_build_from_source; then
    ok=1
    echo "[install-whisper-server] 源码 build 完成 → $DEST_DIR"
fi

if [ $ok -eq 0 ]; then
    echo "[install-whisper-server] 装失败。可选解法:" >&2
    echo "  - macOS:brew install whisper-cpp;然后重跑本脚本" >&2
    echo "  - Linux x64:装 docker(本脚本会自动从 ghcr.io 提取);或装 cmake build-essential git 走源码" >&2
    echo "  - Linux arm64:upstream Docker 没 arm64,必须装 cmake build-essential git 走源码" >&2
    echo "  - 或直接拷一份你自己编好的 whisper-server 到 $DEST_DIR/" >&2
    exit 1
fi

echo ""
echo "[install-whisper-server] 完成。$DEST_DIR 内容:"
ls -lh "$DEST_DIR"

echo ""
echo "[install-whisper-server] 验证 binary..."
# 动态链接:loader 默认不看 exe 旁路径,要 LD_LIBRARY_PATH;chayuan-server runtime
# spawn 时会自动注入,这里 verify 手动设。Mac 用 DYLD_LIBRARY_PATH。
case "$OS" in
    Darwin) LDV="DYLD_LIBRARY_PATH=$DEST_DIR" ;;
    *)      LDV="LD_LIBRARY_PATH=$DEST_DIR" ;;
esac
# 不能 `set -e` 让验证失败拖垮整个脚本 —— GLIBC 错误是软警告
set +e
verify_out=$(env "$LDV" "$DEST_DIR/whisper-server" --help 2>&1)
verify_exit=$?
set -e
echo "$verify_out" | head -3
if [ $verify_exit -ne 0 ]; then
    if echo "$verify_out" | grep -qiE 'glibc|glibcxx|cxxabi|version not found|no version information'; then
        echo "[install-whisper-server] ⚠ 本机 glibc/glibcxx 比 binary 要求旧,跑不起来" >&2
        echo "  目标用户机器(Ubuntu 22.04+)上是可运行的;参考 docs/DEV-LOCAL-RUNTIME.md §3.1。" >&2
    else
        echo "[install-whisper-server] whisper-server --help 真失败,binary 可能不完整" >&2
        exit 2
    fi
fi
echo "[install-whisper-server] OK"

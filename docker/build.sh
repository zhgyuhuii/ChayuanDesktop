#!/usr/bin/env bash
# ====================================================================
# 察元 集成镜像构建脚本
#   - 基础环境镜像(系统依赖 + Python 依赖):按 poetry.lock 哈希自动构建/复用,
#     依赖不变就零拉取;依赖变了(poetry.lock 改)自动重建一次。
#   - 应用镜像:FROM 基础镜像,只跑 COPY 层(改代码/version bump 重建零依赖拉取)。
#   - 镜像 tag 与系统版本(VERSION 文件)一致。
#
# 用法:
#   ./build.sh                  # 自动:base 按 poetry.lock 复用/构建,主镜像 tag=VERSION
#   ./build.sh --rebuild-base   # 强制重建 base(刷 apt 系统包 / poetry 版本时用)
#   ./build.sh --no-cache       # 主镜像层不用缓存(依赖仍来自 base,不重拉)
#   DOCKER="sudo docker" ./build.sh   # 该机 docker 需要 sudo 时
# ====================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
DOCKER="${DOCKER:-docker}"

REBUILD_BASE=0
NOCACHE=""
for a in "$@"; do
    case "$a" in
        --rebuild-base) REBUILD_BASE=1 ;;
        --no-cache)     NOCACHE="--no-cache" ;;
        -h|--help)      sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "[build] 未知参数:$a(支持 --rebuild-base / --no-cache)" >&2; exit 2 ;;
    esac
done

# 1) 版本号:取本地 VERSION(镜像 tag 与系统版本一致)
VERSION="$(tr -d ' \t\r\n' < VERSION)"
[ -n "$VERSION" ] || { echo "[build] VERSION 为空" >&2; exit 1; }

# 2) base tag = poetry.lock 内容哈希(依赖不变则哈希不变 -> base 复用)
LOCK="chayuan-server/libs/chayuan-server/poetry.lock"
[ -f "$LOCK" ] || { echo "[build] 找不到 $LOCK" >&2; exit 1; }
LOCK_HASH="$(sha256sum "$LOCK" | cut -c1-12)"
BASE_TAG="chayuan-base:${LOCK_HASH}"

echo "[build] VERSION=${VERSION}  BASE=${BASE_TAG}"

# 3) base:不存在 或 --rebuild-base -> 构建(依赖只在这里下载一次)
if [ "$REBUILD_BASE" = "1" ] || ! $DOCKER image inspect "$BASE_TAG" >/dev/null 2>&1; then
    echo "[build] 构建基础环境镜像 ${BASE_TAG} (下载/安装全部依赖)..."
    $DOCKER build $NOCACHE \
        -f docker/Dockerfile.base \
        --build-arg LOCK_HASH="$LOCK_HASH" \
        -t "$BASE_TAG" -t chayuan-base:latest \
        .
else
    echo "[build] 复用已存在的基础环境镜像 ${BASE_TAG}(依赖未变,零拉取)"
fi

# 4) 应用镜像:FROM base,tag = 系统 VERSION + latest
echo "[build] 构建应用镜像 chayuan-server:${VERSION} ..."
$DOCKER build $NOCACHE \
    -f docker/Dockerfile \
    --build-arg BASE_IMAGE="$BASE_TAG" \
    -t "chayuan-server:${VERSION}" -t chayuan-server:latest \
    .

echo "[build] 完成:chayuan-server:${VERSION}  (= chayuan-server:latest),base=${BASE_TAG}"
echo "[build] 起服务:cd docker && ${DOCKER} compose up -d"

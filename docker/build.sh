#!/usr/bin/env bash
# ====================================================================
# 察元 集成镜像构建脚本
#   - 基础环境镜像(系统依赖 + Python 依赖):按 poetry.lock 哈希自动构建/复用,
#     依赖不变就零拉取;依赖变了(poetry.lock 改)自动重建一次。
#   - 前端依赖镜像(chayuan-web-base):按 pnpm-lock.yaml 哈希自动构建/复用,pnpm fetch
#     把 node 依赖固化在此,应用镜像离线 install,改业务代码重建零联网拉前端依赖。
#   - 应用镜像:FROM 基础镜像,只跑 COPY 层(改代码/version bump 重建零依赖拉取)。
#   - 镜像 tag 与系统版本(VERSION 文件)一致。
#
# 用法:
#   ./build.sh                  # 自动:base 按 poetry.lock 复用/构建,主镜像 tag=VERSION
#   ./build.sh --rebuild-base   # 强制重建 base(刷 apt 系统包 / poetry 版本时用)
#   ./build.sh --no-cache       # 主镜像层不用缓存(依赖仍来自 base,不重拉)
#   ./build.sh --no-clean       # 跳过构建前的历史镜像清理(默认会清)
#   ./build.sh --no-models      # 不 seed 本地模型(镜像不含 chat/embedding/rerank/asr)
#   ./build.sh --models-flavor=lite   # 只 seed 瘦身集(~1GB);默认 full(~2.8GB 全自包含)
#   ./build.sh --models-source=hf     # 下载源 auto|hf|modelscope;默认 modelscope(墙内稳)
#   ./build.sh --reseed         # vendor 已有模型也强制重下
#   DOCKER="sudo docker" ./build.sh   # 该机 docker 需要 sudo 时
#
# 默认在构建前清理历史镜像:删旧版本 chayuan tag、旧 hash 的 chayuan-base、
# 悬空(<none>)层;保留本次要用的 chayuan-server:latest、本次 VERSION、当前 BASE_TAG,
# 既腾空间又不破坏 base 复用、不误删在用的 latest。
# ====================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
DOCKER="${DOCKER:-docker}"

REBUILD_BASE=0
NOCACHE=""
CLEAN=1
SEED_MODELS=1
RESEED=0
MODELS_FLAVOR="full"
MODELS_SOURCE="modelscope"
for a in "$@"; do
    case "$a" in
        --rebuild-base) REBUILD_BASE=1 ;;
        --no-cache)     NOCACHE="--no-cache" ;;
        --no-clean)     CLEAN=0 ;;
        --no-models)        SEED_MODELS=0 ;;
        --reseed)           RESEED=1 ;;
        --models-flavor=*)  MODELS_FLAVOR="${a#*=}" ;;
        --models-source=*)  MODELS_SOURCE="${a#*=}" ;;
        -h|--help)      sed -n '2,24p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "[build] 未知参数:$a(支持 --rebuild-base / --no-cache / --no-clean / --no-models / --reseed / --models-flavor= / --models-source=)" >&2; exit 2 ;;
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

# 2b) web base tag = pnpm-lock.yaml 内容哈希(前端依赖不变则复用,pnpm fetch 不重拉)
PNPM_LOCK="chayuan-client/pnpm-lock.yaml"
[ -f "$PNPM_LOCK" ] || { echo "[build] 找不到 $PNPM_LOCK" >&2; exit 1; }
PNPM_LOCK_HASH="$(sha256sum "$PNPM_LOCK" | cut -c1-12)"
WEB_BASE_TAG="chayuan-web-base:${PNPM_LOCK_HASH}"

echo "[build] VERSION=${VERSION}  BASE=${BASE_TAG}  WEB_BASE=${WEB_BASE_TAG}"

# 2.5) 清理历史镜像(默认开;--no-clean 跳过)。在算出 VERSION/BASE_TAG 之后、
#      构建之前跑,保留本次要用的 latest / VERSION / 当前 BASE_TAG。
clean_history() {
    echo "[build] 清理历史镜像(保留 :latest / :${VERSION} / ${BASE_TAG})..."
    # 旧版本的 chayuan tag(非 latest、非本次 VERSION)
    $DOCKER images chayuan --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | grep -Ev ":(latest|${VERSION})$|<none>" \
        | while read -r img; do
            echo "  - rmi $img"; $DOCKER rmi "$img" >/dev/null 2>&1 || true
          done
    # 旧 hash 的 chayuan-base(非当前 lock hash、非 latest)
    $DOCKER images chayuan-base --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | grep -Ev ":(${LOCK_HASH}|latest)$|<none>" \
        | while read -r img; do
            echo "  - rmi $img"; $DOCKER rmi "$img" >/dev/null 2>&1 || true
          done
    # 旧 hash 的 chayuan-web-base(非当前 pnpm-lock hash、非 latest)
    $DOCKER images chayuan-web-base --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | grep -Ev ":(${PNPM_LOCK_HASH}|latest)$|<none>" \
        | while read -r img; do
            echo "  - rmi $img"; $DOCKER rmi "$img" >/dev/null 2>&1 || true
          done
    # 悬空(<none>)层 —— rebuild 替换 tag 后遗留的旧层,最占盘
    $DOCKER image prune -f >/dev/null 2>&1 || true
}
[ "$CLEAN" = "1" ] && clean_history || echo "[build] 跳过历史镜像清理(--no-clean)"

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

# 3b) web base:不存在 或 --rebuild-base -> 构建(前端依赖只在这里 pnpm fetch 一次)
if [ "$REBUILD_BASE" = "1" ] || ! $DOCKER image inspect "$WEB_BASE_TAG" >/dev/null 2>&1; then
    echo "[build] 构建前端依赖基础镜像 ${WEB_BASE_TAG} (pnpm fetch 拉全部依赖)..."
    $DOCKER build $NOCACHE \
        -f docker/Dockerfile.webbase \
        --build-arg PNPM_LOCK_HASH="$PNPM_LOCK_HASH" \
        -t "$WEB_BASE_TAG" -t chayuan-web-base:latest \
        .
else
    echo "[build] 复用已存在的前端依赖基础镜像 ${WEB_BASE_TAG}(依赖未变,零拉取)"
fi

# 3.5) seed 本地模型 + ImageMagick 进 vendor/(与 desktop install-vendor 同一套脚本),
#      让 single-machine 镜像开箱自带 chat/embedding/rerank/asr 模型。默认开;--no-models 跳过;
#      已 seed 过则幂等跳过(--reseed 强制)。失败 fail-loud,不会静默出无模型镜像。
seed_vendor_models() {
    if [ "$SEED_MODELS" = "0" ]; then
        echo "[build] 跳过 vendor 模型 seed(--no-models):镜像不含本地模型,single-machine 会报 no local candidate"
        return 0
    fi
    if [ "$RESEED" = "0" ] && ls chayuan-server/vendor/bundled_models/chat/*/*.gguf >/dev/null 2>&1; then
        echo "[build] vendor/bundled_models 已有 chat 模型,跳过 seed(--reseed 强制重下)"
    else
        echo "[build] seed 本地模型 -> vendor/bundled_models/(flavor=${MODELS_FLAVOR} source=${MODELS_SOURCE},复用 desktop install-vendor)..."
        bash scripts/install-vendor.sh --flavor "$MODELS_FLAVOR" --components models --source "$MODELS_SOURCE"
    fi
    echo "[build] seed ImageMagick -> vendor/services/imagemagick/<platform>/ ..."
    python3 scripts/seed-bundled-assets.py imagemagick \
        || echo "[build] [WARN] ImageMagick seed 失败:字幕 TextClip 渲染会缺(不阻断构建,可后补)"
}
seed_vendor_models

# 4) 应用镜像:FROM base + web base,只跑 COPY + 离线 install + 前端 build
echo "[build] 构建应用镜像 chayuan:${VERSION} ..."
$DOCKER build $NOCACHE \
    -f docker/Dockerfile \
    --build-arg BASE_IMAGE="$BASE_TAG" \
    --build-arg WEB_BASE_IMAGE="$WEB_BASE_TAG" \
    -t "chayuan:${VERSION}" -t chayuan:latest \
    .

echo "[build] 完成:chayuan:${VERSION}  (= chayuan:latest),base=${BASE_TAG},web-base=${WEB_BASE_TAG}"
echo "[build] 起服务:cd docker && ${DOCKER} compose up -d"

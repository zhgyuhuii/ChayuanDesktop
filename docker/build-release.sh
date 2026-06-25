#!/usr/bin/env bash
# ====================================================================
# 察元 release 镜像构建 + 推送阿里云 ACR
#   - 瘦身一体化镜像(docker/Dockerfile.release,FROM python:3.12-slim slim runtime)
#   - 复用 chayuan-base(已是 CPU torch)/ chayuan-web-base,不重下依赖
#   - registry/namespace 参数化:命令行 > 环境变量 > docker/.env.release
#   - 凭证走 ACR_USERNAME / ACR_PASSWORD 环境变量或 docker login 交互,绝不入库
#
# 用法:
#   ./build-release.sh                       # 构建 + 推(REGISTRY/NAMESPACE 从 .env.release)
#   ./build-release.sh --no-push             # 只本地构建 chayuan:<ver>-slim,不推
#   REGISTRY=... NAMESPACE=... ./build-release.sh
#   ./build-release.sh --registry r --namespace n
#   ./build-release.sh --rebuild-base        # 透传(改了 base torch+cpu 后首次需要)
#   DOCKER="sudo docker" ./build-release.sh
# ====================================================================
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
DOCKER="${DOCKER:-docker}"

# 加载 .env.release(若有);命令行参数随后覆盖
[ -f docker/.env.release ] && set -a && . docker/.env.release && set +a

PUSH=1; NOCACHE=""; PASS_REBUILD=""
while [ $# -gt 0 ]; do
    case "$1" in
        --no-push) PUSH=0 ;;
        --no-cache) NOCACHE="--no-cache" ;;
        --rebuild-base) PASS_REBUILD="--rebuild-base" ;;
        --registry) REGISTRY="$2"; shift ;;
        --namespace) NAMESPACE="$2"; shift ;;
        -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "[release] 未知参数:$1" >&2; exit 2 ;;
    esac
    shift
done

VER="$(tr -d ' \t\r\n' < VERSION)"
[ -n "$VER" ] || { echo "[release] VERSION 为空" >&2; exit 1; }

# 确保 base / web-base 就绪(复用 build.sh 的哈希判定逻辑:直接调它构建依赖镜像)
echo "[release] 确保 base / web-base 就绪..."
DOCKER="$DOCKER" ./docker/build.sh ${PASS_REBUILD} --base-only --no-clean >/tmp/_release_base.log 2>&1 \
    || { echo "[release] base/web-base 准备失败,见 /tmp/_release_base.log" >&2; tail -20 /tmp/_release_base.log; exit 1; }

LOCAL_TAG="chayuan:${VER}-slim"
echo "[release] 构建 ${LOCAL_TAG} (slim runtime)..."
$DOCKER build $NOCACHE -f docker/Dockerfile.release \
    --build-arg BASE_IMAGE="chayuan-base:latest" \
    --build-arg WEB_BASE_IMAGE="chayuan-web-base:latest" \
    -t "${LOCAL_TAG}" -t "chayuan:latest-slim" \
    .
$DOCKER images "${LOCAL_TAG}"

if [ "$PUSH" = "0" ]; then
    echo "[release] --no-push:仅本地构建完成 ${LOCAL_TAG}"
    exit 0
fi

: "${REGISTRY:?[release] 缺 REGISTRY(命令行 / 环境变量 / docker/.env.release)}"
: "${NAMESPACE:?[release] 缺 NAMESPACE}"
REMOTE="${REGISTRY}/${NAMESPACE}/chayuan"
echo "[release] 打远程 tag ${REMOTE}:${VER} / :latest"
$DOCKER tag "${LOCAL_TAG}" "${REMOTE}:${VER}"
$DOCKER tag "${LOCAL_TAG}" "${REMOTE}:latest"

echo "[release] 登录 ${REGISTRY}..."
if [ -n "${ACR_USERNAME:-}" ] && [ -n "${ACR_PASSWORD:-}" ]; then
    echo "${ACR_PASSWORD}" | $DOCKER login "${REGISTRY}" -u "${ACR_USERNAME}" --password-stdin
else
    $DOCKER login "${REGISTRY}"
fi

echo "[release] 推送..."
$DOCKER push "${REMOTE}:${VER}"
$DOCKER push "${REMOTE}:latest"
echo "[release] 完成:${REMOTE}:${VER} (= :latest)"

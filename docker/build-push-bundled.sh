#!/usr/bin/env bash
# ====================================================================
# 察元「开箱即用」发布镜像:把系统运行必须模型 + llama 等 sidecar 打进镜像,
# 构建后推送到 Docker Hub(cmdbird/chayuan)和阿里云 ACR(个人版)。
#
#   打进镜像的模型(系统运行必须):
#     chat / embedding / rerank / asr / tts / ocr  (~3.6 GB)
#   llama-server / whisper-server / imagemagick 二进制已在 docker/Dockerfile
#   里 COPY,无需本脚本处理。
#
# 机制:模型以「硬链接」暂存到 docker/seed_models/(零额外磁盘),Dockerfile
#   COPY 进镜像 /chayuan/bundled_seed;entrypoint 启动时按 cap 铺到挂载的
#   vendor/bundled_models(空则铺,幂等)→ 零下载开箱即用 + 宿主机可见。
#
# 用法:
#   ./build-push-bundled.sh                 # 构建 + 推送 Hub & ACR(覆盖 :latest)
#   ./build-push-bundled.sh --no-push       # 只构建本地镜像,不推送
#   ./build-push-bundled.sh --keep-seed     # 构建后保留 docker/seed_models 暂存
#   ./build-push-bundled.sh --rebuild-base  # 透传给 build.sh(刷 base)
#   DOCKER="sudo docker" ./build-push-bundled.sh   # 该机 docker 需 sudo 时
#
# 凭据:复用当前 docker 已登录态(root 已 login Docker Hub + 阿里云 ACR)。
#   未登录时 push 会失败,按提示 `docker login` / `docker login <ACR_HOST>` 后重跑。
# ====================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
DOCKER="${DOCKER:-docker}"

# ── 发布坐标(真源见 memory/website 部署文档)──────────────────────
HUB_REPO="cmdbird/chayuan"
ACR_HOST="crpi-4i9j7th8clu2wz0j.cn-beijing.personal.cr.aliyuncs.com"
ACR_REPO="${ACR_HOST}/cmdbird/chayuan"

# 打进镜像的「系统运行必须」cap
CAPS=(chat embedding rerank asr tts ocr)
BM="chayuan-server/vendor/bundled_models"
SEED="docker/seed_models"

NO_PUSH=0
KEEP_SEED=0
BUILD_ARGS=()
for a in "$@"; do
    case "$a" in
        --no-push)   NO_PUSH=1 ;;
        --keep-seed) KEEP_SEED=1 ;;
        --rebuild-base|--no-cache|--no-clean) BUILD_ARGS+=("$a") ;;
        -h|--help)   sed -n '2,33p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) echo "[bp] 未知参数:$a" >&2; exit 2 ;;
    esac
done

VERSION="$(tr -d ' \t\r\n' < VERSION)"
[ -n "$VERSION" ] || { echo "[bp] VERSION 为空" >&2; exit 1; }
echo "[bp] 发布版本 = ${VERSION}"

# ── 1. 校验 6 个 cap 都有真实模型文件 ─────────────────────────────
echo "[bp] 校验必须模型就绪 ..."
missing=0
for cap in "${CAPS[@]}"; do
    n=$(find "$BM/$cap" -type f ! -name '.gitkeep' ! -path '*/.cache/*' 2>/dev/null | wc -l)
    if [ "$n" -eq 0 ]; then
        echo "  [缺] $cap 目录无模型文件 —— 先跑:"
        echo "       python3.11 scripts/install-bundled-models.py --only $cap --source hf --endpoint https://huggingface.co --no-menu --workspace $REPO_ROOT"
        missing=1
    else
        sz=$(du -sh "$BM/$cap" 2>/dev/null | cut -f1)
        echo "  [ok] $cap ($sz)"
    fi
done
[ "$missing" -eq 0 ] || { echo "[bp] 有 cap 缺模型,中止。" >&2; exit 1; }

# ── 2. 清理模型目录下载残留(只删垃圾,保留可运行文件)──────────────
echo "[bp] 清理模型目录下载残留(.cache / *.lock / *.incomplete)..."
find "${CAPS[@]/#/$BM/}" -type d -name ".cache" -prune -exec rm -rf {} + 2>/dev/null || true
find "${CAPS[@]/#/$BM/}" \( -name "*.incomplete" -o -name "*.part" -o -name "*.lock" \
     -o -name "*.metadata" -o -name "._____temp" \) -delete 2>/dev/null || true

# ── 3. 构建上下文保持精简:seed_models 只留 .gitkeep(不把模型塞进上下文)──
#   血泪:把 3.6G 模型放进 docker/seed_models 再 COPY,buildkit 会把整份上下文
#   拷进 /var/lib/docker → 模型在盘上同时存 3 份(vendor 源 + 上下文拷贝 + 镜像
#   层),19G 盘被撑爆 100%(2026-07-18)。故改「先构建瘦镜像 → docker cp 模型
#   进容器 → docker commit」:构建上下文不含模型,模型只存 2 份(源 + 镜像层)。
echo "[bp] 确保构建上下文精简(seed_models 仅 .gitkeep)..."
find "$SEED" -mindepth 1 -maxdepth 1 ! -name '.gitkeep' -exec rm -rf {} + 2>/dev/null || true
mkdir -p "$SEED"; touch "$SEED/.gitkeep"

# ── 4. 构建瘦镜像(不含模型;base/web-base 自动复用或重建)──────────
echo "[bp] 构建瘦镜像 chayuan:${VERSION}(暂不含模型)..."
if [ "${#BUILD_ARGS[@]}" -gt 0 ]; then
    DOCKER="$DOCKER" ./docker/build.sh "${BUILD_ARGS[@]}"
else
    DOCKER="$DOCKER" ./docker/build.sh
fi

# ── 4b. 把模型注入镜像(docker cp → commit,不经构建上下文)──────────
echo "[bp] 注入内置模型到镜像 /chayuan/bundled_seed(docker cp + commit)..."
BAKE_CID=""
bake_cleanup() { [ -n "$BAKE_CID" ] && $DOCKER rm -f "$BAKE_CID" >/dev/null 2>&1 || true; }
trap bake_cleanup EXIT
BAKE_CID="$($DOCKER create "chayuan:${VERSION}")"
[ -n "$BAKE_CID" ] || { echo "[bp] 创建临时容器失败" >&2; exit 1; }
# docker cp 对 created 态容器即可用,无需 start
for cap in "${CAPS[@]}"; do
    echo "  - cp $cap → /chayuan/bundled_seed/$cap"
    $DOCKER cp "$BM/$cap" "${BAKE_CID}:/chayuan/bundled_seed/${cap}"
    df -h / | awk 'NR==2{print "    盘剩余 "$4" ("$5" 用)"}'
done
# commit 保留原镜像 config(ENTRYPOINT/CMD/ENV/EXPOSE 等默认继承)
$DOCKER commit "$BAKE_CID" "chayuan:${VERSION}" >/dev/null
$DOCKER rm -f "$BAKE_CID" >/dev/null 2>&1 || true
BAKE_CID=""
$DOCKER tag "chayuan:${VERSION}" chayuan:latest
echo "[bp] 模型已注入 chayuan:${VERSION}(= :latest)"

# ── 5. 打发布 tag ─────────────────────────────────────────────────
echo "[bp] 打发布 tag(Hub + ACR,含 :latest)..."
for target in "$HUB_REPO" "$ACR_REPO"; do
    $DOCKER tag "chayuan:${VERSION}" "${target}:${VERSION}"
    $DOCKER tag "chayuan:${VERSION}" "${target}:latest"
    echo "  - ${target}:${VERSION} + :latest"
done

if [ "$NO_PUSH" -eq 1 ]; then
    echo "[bp] --no-push:仅本地构建完成,未推送。"
    echo "[bp] 手动推送:"
    for target in "$HUB_REPO" "$ACR_REPO"; do
        echo "    $DOCKER push ${target}:${VERSION} && $DOCKER push ${target}:latest"
    done
    exit 0
fi

# ── 6. 推送(复用现有 docker 登录态)────────────────────────────────
push_repo() {
    local target="$1"
    echo "[bp] 推送 ${target}:${VERSION} ..."
    if ! $DOCKER push "${target}:${VERSION}"; then
        echo "[bp] ✗ 推送 ${target}:${VERSION} 失败(多半未登录)。" >&2
        echo "    Docker Hub: $DOCKER login" >&2
        echo "    阿里云 ACR: $DOCKER login ${ACR_HOST}" >&2
        return 1
    fi
    echo "[bp] 推送 ${target}:latest ..."
    $DOCKER push "${target}:latest"
}
push_repo "$HUB_REPO"
push_repo "$ACR_REPO"

echo ""
echo "[bp] ✅ 完成。已推送(覆盖 :latest):"
echo "     Docker Hub : ${HUB_REPO}:${VERSION} + :latest"
echo "     阿里云 ACR : ${ACR_REPO}:${VERSION} + :latest"
echo "[bp] 用户拉取一键脚本:docker/pull.sh(已指向 cmdbird/chayuan)"

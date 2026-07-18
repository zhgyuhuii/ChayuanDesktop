#!/usr/bin/env bash
# entrypoint:同时跑 nginx (前端 + API 反代) + chayuan-server (Python)
# tini 在 PID 1,本脚本是 PID 2;chayuan 退出 -> 脚本退出 -> tini 收 nginx
set -e

echo "[entrypoint] booting chayuan-server docker image"
echo "[entrypoint] CHAYUAN_ROOT       = ${CHAYUAN_ROOT}"
echo "[entrypoint] CHAYUAN_PROFILE    = ${CHAYUAN_PROFILE}"
echo "[entrypoint] CHAYUAN_VECTOR_STORE = ${CHAYUAN_VECTOR_STORE}"

# 数据目录初始化(volume 第一次挂载是空目录)
mkdir -p "${CHAYUAN_ROOT}" \
         "${CHAYUAN_ROOT}/data" \
         "${CHAYUAN_ROOT}/data/knowledge_base" \
         "${CHAYUAN_ROOT}/data/files" \
         /chayuan/logs \
         /chayuan/app/chayuan-server/vendor/bundled_models

# 开箱即用:把镜像内置的「种子模型」铺到挂载的 bundled_models 目录。
# 背景:模型打进镜像时放在 /chayuan/bundled_seed(不被 volume 覆盖的位置);
# 而 compose 通常把宿主机目录挂到 vendor/bundled_models(会盖住镜像内容)。
# 这里在启动时把种子按 cap 拷进挂载目录 —— 目标 cap 为空才拷(尊重用户自备模型),
# 幂等。这样:① 零下载开箱即用 ② 模型出现在宿主机挂载目录(可见/可换) ③ 持久化。
SEED_DIR=/chayuan/bundled_seed
TARGET_MODELS=/chayuan/app/chayuan-server/vendor/bundled_models
if [ -d "$SEED_DIR" ]; then
    for capdir in "$SEED_DIR"/*/; do
        [ -d "$capdir" ] || continue
        cap="$(basename "$capdir")"
        # 种子该 cap 有实际内容才处理(空 cap 跳过)
        [ -n "$(ls -A "$capdir" 2>/dev/null)" ] || continue
        # 目标 cap 为空才铺(用户已放模型则保留其自备)
        if [ -z "$(ls -A "$TARGET_MODELS/$cap" 2>/dev/null)" ]; then
            mkdir -p "$TARGET_MODELS/$cap"
            if cp -a "$capdir". "$TARGET_MODELS/$cap/" 2>/dev/null; then
                echo "[entrypoint] 已铺设内置模型到挂载目录: $cap"
            else
                echo "[entrypoint] 警告:铺设内置模型失败: $cap(不阻断启动)"
            fi
        fi
    done
fi

# 用户可以 bind mount 自己的 yaml 配置到 /chayuan/config,这里 symlink 到 CHAYUAN_ROOT
if [ -d /chayuan/config ] && [ "$(ls -A /chayuan/config 2>/dev/null)" ]; then
    echo "[entrypoint] /chayuan/config 有内容,符号链接到 ${CHAYUAN_ROOT}/"
    for f in /chayuan/config/*.yaml; do
        [ -f "$f" ] || continue
        ln -sf "$f" "${CHAYUAN_ROOT}/$(basename "$f")"
    done
fi

# 启 nginx (后台);失败 -> 整个容器退出
echo "[entrypoint] starting nginx ..."
nginx -t
nginx -g 'daemon off;' &
NGINX_PID=$!
echo "[entrypoint] nginx pid=$NGINX_PID listening on :80"

# 信号转发:容器收 SIGTERM/SIGINT,我们也杀 nginx + chayuan
trap 'echo "[entrypoint] shutdown..."; kill -TERM $NGINX_PID 2>/dev/null || true; exit 0' TERM INT

# chayuan-server foreground (PID 2 子进程,日志直出 stdout)
echo "[entrypoint] starting chayuan-server: chayuan $*"
cd /chayuan/app/chayuan-server/libs/chayuan-server
exec python -m chayuan "$@"

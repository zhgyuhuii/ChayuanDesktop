#!/usr/bin/env bash
# entrypoint(split 部署 server 镜像):只跑 chayuan-server(Python),不起 nginx。
# tini 在 PID 1,本脚本 PID 2;chayuan 退出 -> 脚本退出 -> tini 收容器(前端在另一个容器,不受影响)。
set -e

echo "[entrypoint.server] booting chayuan-server (split, no nginx)"
echo "[entrypoint.server] CHAYUAN_ROOT         = ${CHAYUAN_ROOT}"
echo "[entrypoint.server] CHAYUAN_PROFILE      = ${CHAYUAN_PROFILE}"
echo "[entrypoint.server] CHAYUAN_VECTOR_STORE = ${CHAYUAN_VECTOR_STORE}"

mkdir -p "${CHAYUAN_ROOT}" \
         "${CHAYUAN_ROOT}/data" \
         "${CHAYUAN_ROOT}/data/knowledge_base" \
         "${CHAYUAN_ROOT}/data/files" \
         /chayuan/logs \
         /chayuan/app/chayuan-server/vendor/bundled_models

if [ -d /chayuan/config ] && [ "$(ls -A /chayuan/config 2>/dev/null)" ]; then
    echo "[entrypoint.server] /chayuan/config 有内容,符号链接到 ${CHAYUAN_ROOT}/"
    for f in /chayuan/config/*.yaml; do
        [ -f "$f" ] || continue
        ln -sf "$f" "${CHAYUAN_ROOT}/$(basename "$f")"
    done
fi

cd /chayuan/app/chayuan-server/libs/chayuan-server
echo "[entrypoint.server] starting chayuan-server: chayuan $*"
exec python -m chayuan "$@"

#!/usr/bin/env bash
# chayuan-server 容器入口脚本
#
# 用法（由 Dockerfile 指定为 ENTRYPOINT）：
#   CMD=api              → 启动 API 服务（chayuan start --api）
#   CMD=webui            → 启动 webui（chayuan start --webui）
#   CMD=panel            → 启动配置面板（chayuan start --config）
#   CMD=worker           → 启动异步入库 worker（chayuan worker）
#   CMD=all              → 一个容器起 API+webui+panel（调试用，不推荐 prod）
#   CMD=bash|sh|...      → 直接透传给 exec
#
# 关键逻辑：
#   1. 如果 /data 下没有 basic_settings.yaml，先跑 `chayuan init --profile prod -q`；
#   2. 等待 postgres / redis 就绪（若配置了连接串且相应命令可用）；
#   3. 再 exec 对应进程。
set -euo pipefail

CHAYUAN_ROOT="${CHAYUAN_ROOT:-/data}"
ROLE="${1:-${CHAYUAN_ROLE:-api}}"
if [ "$#" -gt 0 ]; then shift; fi

log() { echo "[chayuan-entrypoint] $*"; }

ensure_config() {
    if [ ! -f "${CHAYUAN_ROOT}/basic_settings.yaml" ]; then
        log "首次启动：${CHAYUAN_ROOT}/basic_settings.yaml 不存在，执行 init --profile=${CHAYUAN_INIT_PROFILE:-prod}"
        chayuan init --profile "${CHAYUAN_INIT_PROFILE:-prod}" --non-interactive || {
            log "init 失败；继续启动（service 会报错便于排查）"
        }
    else
        log "${CHAYUAN_ROOT}/basic_settings.yaml 已存在，跳过 init"
    fi
}

# 粗暴 TCP 探活，避免 chayuan 起来前 pg / redis / milvus 还没到就绪；
# 只有配置了 env 时才探。bash 的 /dev/tcp 不需要 nc/telnet。
wait_tcp() {
    local host="$1" port="$2" name="$3" timeout="${4:-60}"
    if [ -z "$host" ] || [ -z "$port" ]; then return 0; fi
    log "等待 ${name} ${host}:${port}（最多 ${timeout}s）..."
    for i in $(seq 1 "$timeout"); do
        if (echo > "/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
            log "${name} 就绪。"
            return 0
        fi
        sleep 1
    done
    log "${name} ${host}:${port} 在 ${timeout}s 内未就绪（继续启动，留给应用本地重试）。"
    return 0
}

wait_deps() {
    # 从 env 读，允许外部用 env 显式跳过
    local pg_host="${CHAYUAN_WAIT_PG_HOST:-${CHAYUAN_PG_HOST:-postgres}}"
    local pg_port="${CHAYUAN_WAIT_PG_PORT:-${CHAYUAN_PG_PORT:-5432}}"
    local redis_host="${CHAYUAN_WAIT_REDIS_HOST:-redis}"
    local redis_port="${CHAYUAN_WAIT_REDIS_PORT:-6379}"
    local milvus_host="${CHAYUAN_WAIT_MILVUS_HOST:-${CHAYUAN_MILVUS_HOST:-milvus}}"
    local milvus_port="${CHAYUAN_WAIT_MILVUS_PORT:-${CHAYUAN_MILVUS_PORT:-19530}}"

    if [ "${CHAYUAN_SKIP_DEP_WAIT:-0}" = "1" ]; then
        log "CHAYUAN_SKIP_DEP_WAIT=1 跳过依赖探活"
        return 0
    fi

    wait_tcp "$pg_host"     "$pg_port"     "postgres" 60
    wait_tcp "$redis_host"  "$redis_port"  "redis"    30
    # worker / api / webui 都可能间接用 milvus，统一探
    wait_tcp "$milvus_host" "$milvus_port" "milvus"   90
}

ensure_config
wait_deps

case "$ROLE" in
    api)
        log "启动角色：api"
        exec chayuan start --api "$@"
        ;;
    webui)
        log "启动角色：webui"
        exec chayuan start --webui "$@"
        ;;
    panel|config|config-panel)
        log "启动角色：config-panel"
        exec chayuan start --config "$@"
        ;;
    worker)
        log "启动角色：ingest worker"
        exec chayuan worker "$@"
        ;;
    all)
        log "启动角色：all（调试用）"
        exec chayuan start -a "$@"
        ;;
    init)
        log "只做初始化（不启动服务）"
        exec chayuan init --profile "${CHAYUAN_INIT_PROFILE:-prod}" --non-interactive "$@"
        ;;
    bash|sh|shell)
        log "进入 shell"
        exec bash
        ;;
    *)
        # 当做原生命令透传
        exec "$ROLE" "$@"
        ;;
esac

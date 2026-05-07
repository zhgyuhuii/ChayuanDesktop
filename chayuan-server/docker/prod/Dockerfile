# ============================================================================
# chayuan-server 生产镜像（多阶段构建）
#
# 设计要点：
#   - 基于 python:3.11-slim，成镜像 ~1.4GB（包含 torch/langchain 生态）
#   - builder 阶段用 poetry 装依赖到 venv，runtime 阶段只复制 venv + 源码
#   - 额外补装 P2/P3 运行态依赖：redis / arq / bcrypt / prometheus_client
#   - 非 root 用户 chayuan (UID 1001) 运行，CHAYUAN_ROOT=/data 作为数据卷
#   - 一个镜像通吃 api / worker / webui：入口脚本按 CHAYUAN_ROLE 分派
#   - 首次运行（/data 为空）时自动跑 `chayuan init --profile prod --non-interactive`
#
# 构建（在仓库根目录执行；版本号对齐 libs/chayuan-server/pyproject.toml）：
#   docker build -f docker/prod/Dockerfile -t chayuan-server:1.0.0.0 .
# 也可以用 compose 自动按 CHAYUAN_IMAGE_TAG 打 tag：
#   CHAYUAN_IMAGE_TAG=1.0.0.0 docker compose -f docker/prod/docker-compose.yaml build
# ============================================================================

# ---------------------------------------------------------------------------
# 1) builder：poetry 装依赖
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    POETRY_VERSION=1.8.3 \
    POETRY_HOME=/opt/poetry \
    POETRY_CACHE_DIR=/opt/poetry-cache \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_VIRTUALENVS_CREATE=true \
    POETRY_NO_INTERACTION=1

# apt 重试：镜像里偶发 502，单次 apt-get install 很脆弱；这里用一个简单 retry 循环兜一下
RUN set -eux; \
    for i in 1 2 3; do \
        apt-get update \
        && apt-get install -y --no-install-recommends --fix-missing \
            build-essential git curl ca-certificates \
            libpq-dev libjpeg-dev zlib1g-dev \
        && break || sleep 5; \
    done \
 && rm -rf /var/lib/apt/lists/*

RUN pip install "poetry==${POETRY_VERSION}"

WORKDIR /build

# 先只拷依赖声明，最大化利用层缓存
COPY libs/chayuan-server/pyproject.toml libs/chayuan-server/poetry.lock ./libs/chayuan-server/

WORKDIR /build/libs/chayuan-server

# 只装主依赖组；test/lint 不进 prod 镜像。venv 会建在 ./.venv（in-project）。
RUN poetry install --only main --no-root

# 拷源码到同一路径，保持包导入路径稳定
COPY libs/chayuan-server ./

# 把项目自身装进 venv
RUN poetry install --only main

# 运行期额外依赖（代码里 optional，但 prod 镜像要真装上）
RUN ./.venv/bin/pip install --no-cache-dir \
        "redis>=5.0.0,<6.0.0" \
        "arq>=0.26.0,<0.27.0" \
        "bcrypt>=4.0.0,<5.0.0" \
        "prometheus_client>=0.20.0,<1.0.0"


# ---------------------------------------------------------------------------
# 2) runtime：清爽镜像
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CHAYUAN_ROOT=/data \
    CHAYUAN_ROLE=api \
    CHAYUAN_INIT_PROFILE=prod \
    PATH="/opt/venv/bin:${PATH}" \
    TZ=Asia/Shanghai

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libpq5 libjpeg62-turbo zlib1g tini tzdata curl \
 && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

# 非 root 用户
RUN groupadd -g 1001 chayuan \
 && useradd -u 1001 -g 1001 -s /bin/bash -d /home/chayuan -m chayuan \
 && mkdir -p /data /app \
 && chown -R chayuan:chayuan /data /app

# 从 builder 拷源码 + venv（venv 已经是 in-project 的 .venv）
COPY --from=builder /build/libs/chayuan-server /app/libs/chayuan-server

# /opt/venv 指向 in-project .venv，保持 PATH 一致
RUN ln -sf /app/libs/chayuan-server/.venv /opt/venv

COPY docker/prod/entrypoint.sh /usr/local/bin/chayuan-entrypoint
RUN chmod +x /usr/local/bin/chayuan-entrypoint

WORKDIR /app/libs/chayuan-server
USER chayuan

# 7861 api / 8501 webui / 8502 config panel / 9090 metrics（和 7861 复用，无需单独开）
EXPOSE 7861 8501 8502

VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=6 \
    CMD curl -fsS "http://127.0.0.1:7861/healthz" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/chayuan-entrypoint"]
CMD ["api"]

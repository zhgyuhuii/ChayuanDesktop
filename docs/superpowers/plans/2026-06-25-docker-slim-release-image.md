# 察元 Docker 瘦身 release 镜像 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把容器镜像从 11.6GB 砍到 ~2-2.5GB:源头把 torch CUDA 换成 CPU(dev 镜像顺带降到 ~4GB),再新增 slim runtime 的 release 镜像 + 推阿里云 ACR 的发布脚本。

**Architecture:** 两段式。① 改 `docker/Dockerfile.base`:`poetry install` 后用 pip 把 CUDA torch + 16 个 nvidia-cu13 库 + triton 替换为 `torch==2.11.0+cpu`(无 GPU 处处成立,不动共享 pyproject)。② 新增 `docker/Dockerfile.release` 三阶段(web-builder / deps-builder strip / FROM python:3.12-slim 的 slim runtime),`runtime` 不继承胖 base,只 COPY 清洗后的 site-packages;`docker/build-release.sh` 构建并推 ACR,registry/namespace 参数化、密码走 env。现有 `Dockerfile` / `build.sh` / `Dockerfile.webbase` 不动。

**Tech Stack:** Docker multi-stage (BuildKit), Python 3.12, poetry, pip, pytorch CPU index, 阿里云 ACR, bash。

**前置事实(已实测,勿再质疑):**
- 11GB 根因 = torch 2.11.0 CUDA 版拖 16 个 nvidia-cu13 库(~7-8GB 装机)。详见 `docs/superpowers/specs/2026-06-25-docker-slim-release-image-design.md`。
- `torch-2.11.0+cpu-cp312-cp312-manylinux_2_28_x86_64.whl` 在 `https://download.pytorch.org/whl/cpu` 存在,可直接钉版本;CPU 版不依赖 nvidia-* / triton。
- lock 里只有 `torch`(及其传递 nvidia/triton)是 locked;torchvision/torchaudio 是运行时按需装,不在本计划范围。
- 仓库 root 所有,所有写文件 / git 操作需 `sudo`(见记忆 commit-procedure-chayuan-desktop)。固定分支 `main` → `origin/main`。
- 本沙箱无法跑 docker 实建(无本地镜像、build >1h)。每个 Task 的「验证」给出**在有 docker + base 镜像的构建机上**执行的确切命令与预期输出;沙箱内只做静态校验(文件存在、grep、bash -n、纯 ASCII 检查)。

---

## File Structure

- `docker/Dockerfile.base`(改):`poetry install` 之后加一层 torch CUDA→CPU 替换。
- `docker/Dockerfile.release`(新):三阶段 slim 构建,产出最终发布镜像内容。
- `docker/build-release.sh`(新):构建 release 镜像 + 打 ACR tag + login + push;参数化 registry。
- `docker/.env.release.example`(新):REGISTRY / NAMESPACE 模板,不含密码。
- `docker/.gitignore`(改):忽略真 `.env.release`。
- `docker/README.md`(改):补 release 发布流程说明。

---

## Task 1: Dockerfile.base 把 torch 换成 CPU 版(源头修复)

**Files:**
- Modify: `docker/Dockerfile.base`(在第 69 行 `pip install minio` 之后、`ARG LOCK_HASH` 之前插入)

- [ ] **Step 1: 在 Dockerfile.base 插入 torch CPU 替换层**

在 `RUN pip install --no-cache-dir "minio>=7.2,<8.0"` 之后插入:

```dockerfile
# ── torch CUDA → CPU ───────────────────────────────────────────────
# poetry 从 PyPI 默认源装的 torch 2.11.0 是 CUDA 版,强制拖进 16 个 nvidia-cu13
# 运行时库(cublas/cudnn/nccl/cufft/cusolver/cusparse/cusparselt/nvshmem/triton…),
# 装机后 ~7-8GB。服务器/容器无 GPU,这些 CUDA 库一字节用不到 —— 桌面打包早用
# torch+cpu(build.py 第1122行 torch-2.5.1+cpu)。这里把 CUDA torch 替换为 CPU 版,
# 镜像从 ~11GB 降到 ~4GB。【不改 pyproject/poetry.lock,只在 pip 层替换,不影响桌面打包】。
# 国内拉 download.pytorch.org 慢时:--build-arg TORCH_CPU_INDEX=<国内 cpu 镜像>。
ARG TORCH_CPU_INDEX=https://download.pytorch.org/whl/cpu
RUN pip uninstall -y torch triton \
        nvidia-cublas-cu13 nvidia-cuda-cupti-cu13 nvidia-cuda-nvrtc-cu13 \
        nvidia-cuda-runtime-cu13 nvidia-cudnn-cu13 nvidia-cufft-cu13 nvidia-cufile-cu13 \
        nvidia-curand-cu13 nvidia-cusolver-cu13 nvidia-cusparse-cu13 nvidia-cusparselt-cu13 \
        nvidia-nccl-cu13 nvidia-nvjitlink-cu13 nvidia-nvshmem-cu13 nvidia-nvtx-cu13 \
        2>/dev/null || true \
    && pip install --no-cache-dir "torch==2.11.0+cpu" --index-url "${TORCH_CPU_INDEX}" \
    && python -c "import torch; assert torch.version.cuda is None, torch.version.cuda; print('[base] torch', torch.__version__, 'cuda=', torch.version.cuda)"
```

- [ ] **Step 2: 沙箱静态校验**

Run:
```bash
grep -n "torch==2.11.0+cpu" docker/Dockerfile.base
grep -nP '[^\x00-\x7F]' docker/Dockerfile.base | grep -v '#' | head   # 注释里中文允许,这里只看有无异常
```
Expected: 第一条命中 1 行;Dockerfile 允许中文注释(非 .ps1),无需纯 ASCII。

- [ ] **Step 3: 构建机重建 base 并验证(有 docker 的机器)**

Run:
```bash
cd /work/chayuan-desktop/docker
DOCKER="sudo docker" ./build.sh --rebuild-base
sudo docker run --rm chayuan-base:latest python -c "import torch;print(torch.__version__, torch.version.cuda)"
sudo docker run --rm chayuan-base:latest pip list 2>/dev/null | grep -iE "^nvidia|^triton" || echo "NO nvidia/triton (good)"
sudo docker images chayuan-base:latest
```
Expected: 打印 `2.11.0+cpu None`;无 nvidia/triton 包;base 镜像 SIZE 从 ~11.2GB 降到 ~4GB 量级。

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop
sudo git add docker/Dockerfile.base
sudo git commit -m "fix(docker): base 装 torch+cpu 替换 CUDA 版,镜像 11GB→~4GB

poetry 默认源 torch 2.11.0 是 CUDA 版拖 16 个 nvidia-cu13 库 ~7-8GB,
服务器无 GPU 纯死重。pip 层替换为 torch==2.11.0+cpu,不动 pyproject。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 新增 Dockerfile.release(slim runtime 三阶段)

**Files:**
- Create: `docker/Dockerfile.release`

参照现有 `docker/Dockerfile`(web-builder 段、sidecar COPY/伪软链修复、ENV/EXPOSE/HEALTHCHECK/ENTRYPOINT)照搬,差异只在 runtime 不 FROM base 而 FROM python:3.12-slim。

- [ ] **Step 1: 写 Dockerfile.release**

```dockerfile
# syntax=docker/dockerfile:1.6
# ====================================================================
# 察元 一体化镜像 — release slim 版(体积优化,推 ACR 用)
#   与 docker/Dockerfile 的区别:runtime 不继承胖 base,而是 FROM python:3.12-slim,
#   只 COPY deps-builder 清洗(strip)后的 site-packages → 甩掉 build-essential /
#   poetry / pip 缓存。torch 已在 Dockerfile.base 换成 CPU(Task 1),这里只做 strip。
#   预期 ~2-2.5GB(对照 dev ~4GB)。构建较慢(不复用 base 层缓存),发布偶发可接受。
#   build context 必须是 repo 根。一般用 docker/build-release.sh 驱动。
# ====================================================================
ARG BASE_IMAGE=chayuan-base:latest
ARG WEB_BASE_IMAGE=chayuan-web-base:latest

# ── Stage 1: 前端(与 docker/Dockerfile 的 web-builder 完全一致) ──
FROM ${WEB_BASE_IMAGE} AS web-builder
ENV CI=1
WORKDIR /chayuan-client
COPY chayuan-client/pnpm-workspace.yaml chayuan-client/package.json chayuan-client/pnpm-lock.yaml ./
COPY chayuan-client/tsconfig.base.json ./
COPY chayuan-client/packages ./packages
COPY chayuan-client/apps    ./apps
COPY chayuan-client/e2e-desktop ./e2e-desktop
COPY chayuan-client/images ./images
ENV TAURI_SKIP_DEVSERVER_CHECK=1
RUN pnpm install --offline --frozen-lockfile || pnpm install
ENV VITE_API_BASE="" \
    VITE_THIN_CLIENT="0"
RUN pnpm -F web build:vite

# ── Stage 2: 清洗依赖(strip site-packages,产出干净树) ──
FROM ${BASE_IMAGE} AS deps-builder
# site-packages 路径(POETRY_VIRTUALENVS_CREATE=false → 装进系统 site-packages)
RUN python - <<'PY'
import sysconfig, pathlib
sp = sysconfig.get_paths()["purelib"]
pathlib.Path("/tmp/sp_path").write_text(sp)
print("site-packages:", sp)
PY
# strip:删 tests/__pycache__/docs/examples、静态库/头文件,strip .so 调试符号。
# 保留 .dist-info(importlib.metadata 要用)。失败一律容错,不阻断构建。
RUN SP="$(cat /tmp/sp_path)" && set -x \
 && find "$SP" -depth -type d \( -name tests -o -name test -o -name __pycache__ -o -name docs -o -name examples \) -exec rm -rf {} + 2>/dev/null || true \
 && find "$SP" -type f \( -name '*.pyc' -o -name '*.pyo' -o -name '*.a' -o -name '*.h' -o -name '*.hpp' \) -delete 2>/dev/null || true \
 && find "$SP" -type f -name '*.so' -exec strip --strip-unneeded {} + 2>/dev/null || true \
 && du -sh "$SP" || true

# ── Stage 3: slim runtime(全新瘦底,不继承 base) ──
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DEBIAN_FRONTEND=noninteractive
ARG APT_MIRROR=mirrors.aliyun.com
# 只装运行时库(无 build-essential / git / poetry / pip 缓存)。
# libgl1 / libglib2.0-0 是 opencv-python 运行时 dlopen 需要。
RUN if [ -n "$APT_MIRROR" ]; then \
        for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
            [ -f "$f" ] && sed -i "s|deb.debian.org|$APT_MIRROR|g; s|security.debian.org|$APT_MIRROR|g" "$f" || true; \
        done; \
    fi; \
    apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 libstdc++6 libgcc-s1 \
        ffmpeg libsndfile1 libmagic1 \
        libgl1 libglib2.0-0 \
        nginx-light curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* /var/log/nginx/*

# 拷清洗后的 site-packages 覆盖 slim 自带的(slim 的 site-packages 基本空)
COPY --from=deps-builder /tmp/sp_path /tmp/sp_path
RUN SP_SRC="$(cat /tmp/sp_path)" && echo "copy from $SP_SRC" > /tmp/_marker
COPY --from=deps-builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages

# 后端源码
WORKDIR /chayuan/app
COPY chayuan-server/libs/chayuan-server/chayuan ./chayuan-server/libs/chayuan-server/chayuan
COPY chayuan-server/libs/chayuan-server/langchain_chayuan ./chayuan-server/libs/chayuan-server/langchain_chayuan

# sidecar 二进制 + 伪软链自修复(照搬 docker/Dockerfile)
COPY chayuan-server/vendor/services ./chayuan-server/vendor/services
RUN chmod +x \
        /chayuan/app/chayuan-server/vendor/services/llama-server/linux-x64/llama-server \
        /chayuan/app/chayuan-server/vendor/services/whisper-server/linux-x64/whisper-server \
        /chayuan/app/chayuan-server/vendor/services/imagemagick/linux-x64/magick \
    2>/dev/null || true
RUN find /chayuan/app/chayuan-server/vendor/services -path '*/linux-x64/*' -type f ! -type l | while IFS= read -r f; do \
        [ "$(stat -c%s "$f")" -le 256 ] || continue; \
        [ "$(head -c4 "$f" | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] && continue; \
        tgt=$(cat "$f"); d=$(dirname "$f"); \
        [ -n "$tgt" ] && [ -e "$d/$tgt" ] || continue; \
        rm -f "$f" && ln -s "$tgt" "$f" && echo "repaired symlink: $f -> $tgt"; \
    done

# bundled 资产
COPY chayuan-server/vendor/bundled_fonts ./chayuan-server/vendor/bundled_fonts
COPY chayuan-server/vendor/bundled_bgm ./chayuan-server/vendor/bundled_bgm
COPY chayuan-server/vendor/bundled_video_clips ./chayuan-server/vendor/bundled_video_clips

# 前端 dist + nginx + entrypoint
COPY --from=web-builder /chayuan-client/apps/web/dist /chayuan/web
COPY docker/nginx.conf      /etc/nginx/nginx.conf
COPY docker/entrypoint.sh   /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

RUN mkdir -p /chayuan/app/chayuan-server/vendor/bundled_models \
             /chayuan/data /chayuan/logs

ENV CHAYUAN_ROOT=/chayuan/data \
    CHAYUAN_PROFILE=single-machine \
    CHAYUAN_AUTH=anonymous \
    CHAYUAN_REDIS=disabled \
    CHAYUAN_QUEUE=inproc \
    CHAYUAN_VECTOR_STORE=sqlite-vec \
    CHAYUAN_AUTO_INSTALL_DEPS=false \
    CHAYUAN_ROOT_IGNORE_STATE=1 \
    CHAYUAN_VENDOR_PLATFORM=linux-x64 \
    PYTHONPATH=/chayuan/app/chayuan-server/libs/chayuan-server

EXPOSE 80 62581 8502
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
    CMD curl -fsS http://127.0.0.1/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["start", "-a", "--single-machine"]
```

注:`COPY --from=deps-builder /usr/local/lib/python3.12/site-packages …` 用了固定路径(python:3.12-slim 的 purelib 即此路径,与 base 同基底镜像,路径一致)。`/tmp/sp_path` 那两步只是留痕/自检,可保留。

- [ ] **Step 2: 沙箱静态校验**

Run:
```bash
cd /work/chayuan-desktop
test -f docker/Dockerfile.release && echo OK
grep -c "FROM " docker/Dockerfile.release    # 预期 3
grep -n "FROM python:3.12-slim AS runtime" docker/Dockerfile.release
grep -n "build-essential\|poetry install" docker/Dockerfile.release || echo "no build tools in release (good)"
```
Expected: `OK`;3 个 FROM;runtime 行命中;无 build-essential/poetry。

- [ ] **Step 3: 构建机实建并量体积(有 docker)**

Run:
```bash
cd /work/chayuan-desktop
VER="$(tr -d ' \t\r\n' < VERSION)"
sudo docker build -f docker/Dockerfile.release \
  --build-arg BASE_IMAGE=chayuan-base:latest \
  --build-arg WEB_BASE_IMAGE=chayuan-web-base:latest \
  -t "chayuan:${VER}-slim" .
sudo docker images "chayuan:${VER}-slim"
```
Expected: 构建成功;SIZE ~2-2.5GB 量级。

- [ ] **Step 4: 容器冒烟(有 docker)**

Run:
```bash
VER="$(tr -d ' \t\r\n' < VERSION)"
cid=$(sudo docker run -d -p 18080:80 "chayuan:${VER}-slim")
sleep 60
sudo docker exec "$cid" python -c "import torch,cv2,faiss,sentence_transformers,onnxruntime,moviepy; print('imports ok; cuda=',torch.version.cuda)"
curl -fsS http://127.0.0.1:18080/healthz && echo " healthz ok"
sudo docker rm -f "$cid"
```
Expected: `imports ok; cuda= None`;healthz 返回成功。若某库 import 因 strip 失败 → 回到 Step 1 给该库的 .so 加 strip 白名单(从 find 的 -name 过滤里排除其目录)。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
sudo git add docker/Dockerfile.release
sudo git commit -m "feat(docker): 新增 Dockerfile.release slim runtime(~2.5GB)

FROM python:3.12-slim 不继承胖 base,只 COPY strip 后的 site-packages,
甩掉 build-essential/poetry/pip 缓存。前端/sidecar/源码照搬现有 Dockerfile。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: build-release.sh + .env.release.example + .gitignore

**Files:**
- Create: `docker/build-release.sh`
- Create: `docker/.env.release.example`
- Modify: `docker/.gitignore`

- [ ] **Step 1: 写 docker/.env.release.example**

```bash
# 察元 release 发布配置模板。复制为 docker/.env.release 并改成你的值。
# 真 .env.release 不入库(docker/.gitignore 已忽略)。【不要在此放密码】。
# 阿里云 ACR 示例:
REGISTRY=registry.cn-hangzhou.aliyuncs.com
NAMESPACE=your-namespace
# 镜像名固定为 chayuan;最终 tag = ${REGISTRY}/${NAMESPACE}/chayuan:<version>
#
# 登录凭证走环境变量(不落本文件):
#   export ACR_USERNAME=...        # 阿里云账号 / RAM 用户
#   export ACR_PASSWORD=...        # ACR 访问凭证密码
# 未设则 build-release.sh 走 docker login 交互输入。
```

- [ ] **Step 2: 写 docker/build-release.sh**

```bash
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
DOCKER="$DOCKER" ./docker/build.sh ${PASS_REBUILD} --no-clean >/tmp/_release_base.log 2>&1 \
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
```

- [ ] **Step 3: 追加 docker/.gitignore 忽略真 .env.release**

在 `docker/.gitignore` 末尾追加(若未含):

```
.env.release
```

- [ ] **Step 4: 沙箱静态校验**

Run:
```bash
cd /work/chayuan-desktop
sudo chmod +x docker/build-release.sh
bash -n docker/build-release.sh && echo "syntax ok"
test -f docker/.env.release.example && echo "env example ok"
grep -q "^.env.release$" docker/.gitignore && echo "gitignore ok"
./docker/build-release.sh --help | head -3
```
Expected: `syntax ok` / `env example ok` / `gitignore ok`;--help 打印用法。

- [ ] **Step 5: 构建机验 --no-push(有 docker)**

Run:
```bash
cd /work/chayuan-desktop
DOCKER="sudo docker" ./docker/build-release.sh --no-push
sudo docker images | grep -E "chayuan:.*-slim"
```
Expected: 构建出 `chayuan:<ver>-slim` 与 `chayuan:latest-slim`,SIZE ~2-2.5GB。

- [ ] **Step 6: Commit**

```bash
cd /work/chayuan-desktop
sudo git add docker/build-release.sh docker/.env.release.example docker/.gitignore
sudo git commit -m "feat(docker): build-release.sh 构建 slim 镜像并推阿里云 ACR

registry/namespace 参数化(命令行>env>.env.release),凭证走
ACR_USERNAME/ACR_PASSWORD 或交互,绝不入库;--no-push 只本地构建。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 端到端验证 + README 说明

**Files:**
- Modify: `docker/README.md`(补 release 发布章节)

- [ ] **Step 1: 构建机端到端验证(有 docker + ACR 账号)**

Run:
```bash
cd /work/chayuan-desktop
export ACR_USERNAME=...; export ACR_PASSWORD=...
REGISTRY=registry.cn-hangzhou.aliyuncs.com NAMESPACE=your-ns \
  DOCKER="sudo docker" ./docker/build-release.sh
```
Expected: 构建 + login + push 全过,打印 `${REMOTE}:<ver> (= :latest)`。

- [ ] **Step 2: 对照体积**

Run:
```bash
sudo docker images | grep -E "chayuan(-base)?\b"
```
Expected:`chayuan-base` ~4GB、`chayuan:<ver>`(dev) ~4GB、`chayuan:<ver>-slim`(release) ~2-2.5GB,对照原 11GB。

- [ ] **Step 3: 在 docker/README.md 补 release 章节**

在 README 末尾追加:

```markdown
## 发布 release 瘦身镜像(推阿里云 ACR)

dev 日常用 `./build.sh`(本地,~4GB)。对外发布用 release 瘦身镜像(~2-2.5GB):

1. 复制配置:`cp .env.release.example .env.release`,填 `REGISTRY` / `NAMESPACE`。
2. 设凭证(不入库):`export ACR_USERNAME=...; export ACR_PASSWORD=...`。
3. 构建 + 推:`DOCKER="sudo docker" ./build-release.sh`
   - 只本地验体积不推:`./build-release.sh --no-push`
   - 首次(或改过 base torch)需:`./build-release.sh --rebuild-base`

release 镜像比 dev 小,因为 runtime FROM python:3.12-slim 不继承构建工具链,
且 site-packages 已 strip。torch 已是 CPU 版(见 Dockerfile.base)。
tag:本地 `chayuan:<ver>-slim`、远程 `${REGISTRY}/${NAMESPACE}/chayuan:<ver>` 与 `:latest`。
```

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop
sudo git add docker/README.md
sudo git commit -m "docs(docker): README 补 release 瘦身镜像发布流程

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: push**

```bash
cd /work/chayuan-desktop
sudo git push origin main
```

---

## 自检对照(spec 覆盖)

- spec §2A base 换 torch+cpu → Task 1 ✓
- spec §2B Dockerfile.release 三阶段 slim runtime → Task 2 ✓
- spec §3 build-release.sh 参数化 + 凭证 env + .env.release.example + .gitignore → Task 3 ✓
- spec §4 tag 命名(dev / -slim / ACR remote)→ Task 2 Step1 + Task 3 Step2 ✓
- spec §5 验证(healthz / cuda is None / imports / 体积)→ Task 2 Step4 + Task 4 ✓
- spec §6 风险(torch CPU 版本已确认存在 2.11.0+cpu;ldd 运行时库;strip 容错;重建 base)→ Task 1/2 已落 ✓

## 风险提醒

- **沙箱不能实建**:Task 1/2/3 的 Step「构建机」命令必须在有 docker + 已存在 base 镜像的机器上跑;沙箱内只做静态校验。
- **strip 坏某库**:Task 2 Step4 的 import 冒烟是闸门;若 `import X` 失败,给该库 .so 加白名单跳过 strip。
- **runtime apt 库可能不全**:Task 2 Step4 若报 `libGL.so.1` / 其它 .so 缺失,按 ldd 补进 runtime 的 apt 列表(常见补充:`libgl1` 已含,若 opencv 报 `libgthread` 加 `libglib2.0-0` 已含)。
- **commit/push 需 sudo**;固定分支 main。

# 察元 Docker 瘦身 release 镜像设计

- 日期:2026-06-25
- 范围:① `Dockerfile.base` 换 torch+cpu(源头修复,dev/release 都受益)② 新增
  `Dockerfile.release` slim runtime + `build-release.sh` 推阿里云 ACR(仅一体化镜像 `chayuan`)
- 状态:设计已确认(含实测根因),待写实现 plan

## 0. 根因(实测,2026-06-25)

线上镜像 `chayuan-base` **11.23GB** / `chayuan:2.0.290` **11.63GB**。深度排查结论:
**不是没瘦身,是容器从一开始就装错了 torch 变体。**

### 铁证:同一套代码,桌面装 CPU torch,容器装了 CUDA torch

- 桌面打包 `chayuan-server/packaging/pyinstaller/build.py`:
  - 第 8 行注释:`_internal/ ← Python + 全部依赖(含 torch **CPU**)`
  - 第 1122 行:`torch-2.5.1**+cpu**-...whl`;第 1114 行:`CPU wheel ~250MB`
  - 桌面 lite < 1GB = CPU torch + 排除大模型权重(LITE_CAPS ~990MB)+ PyInstaller strip。
- 容器走 `poetry install`,PyPI 默认源的 `torch 2.11.0` 在 linux x86_64 **默认是 CUDA 版**,
  强制拖进 **16 个 nvidia CUDA-13 运行时库**。`poetry.lock` 里的 `nvidia-cublas / cudnn /
  nccl / cufft / cusolver / cusparse / cusparselt / nvshmem / triton …` 全是 torch 的
  传递依赖,不是主动声明的。服务器/容器跑 CPU 推理,这些 CUDA 库**一字节都用不到**。

### 实测 wheel 体积(PyPI 压缩态;装进镜像解压放大 ~1.5-2.5x)

| 包 | 压缩 wheel | 解压装机后(估) |
|---|---|---|
| torch 2.11.0 (CUDA) | 530 MB | ~2 GB |
| nvidia-cudnn-cu13 | 366 MB | ~1.6 GB |
| nvidia-nccl-cu13 | 196 MB | ~0.4 GB |
| triton | 188 MB | ~0.4 GB |
| nvidia-cusparselt-cu13 | 170 MB | ~0.35 GB |
| nvidia-cublas/cusparse/cusolver/cufft/cupti/nvrtc/nvshmem… | ~0.8 GB+ | ~2-3 GB |
| **torch + CUDA 小计** | | **≈ 7-8 GB** |
| opencv/scipy/sklearn/pandas/onnxruntime/faiss | ~160 MB | ~0.7 GB |
| build-essential(编译工具链,仅构建期需要) | | ~0.3 GB |
| python:3.12-slim + ffmpeg + 系统库 | | ~0.5 GB |

合计 ≈ 11GB,与实测 11.23/11.63 吻合。base→app 多出 0.4GB = 前端 dist + sidecar 二进制
+ 后端源码 + nginx。

### 为什么"装的依赖没移除"

Python 不是 C —— import 的库就是运行时程序本身,不能"编译完删掉"。但确有**两类真该删却没删**:
- **CUDA 全家(~7GB)**:纯死重(无 GPU)。桌面早用 `torch+cpu` 避开,容器没有。
- **build-essential(~0.3GB)**:仅构建期编译 wheel 用,运行时无用。

未被移除的结构原因:应用镜像 `FROM chayuan-base`(`Dockerfile:80`),base 里
`apt install build-essential` + `poetry install`(CUDA torch)全留着,应用层只做 COPY、
啥都没减 → 11GB 原样继承到最终镜像。

## 1. 背景与目标

- **前端 npm 依赖 + 客户端源码已不在最终镜像**:multi-stage 只 COPY `apps/web/dist`,
  `node_modules` 留在 builder 阶段被丢弃。无需再处理。
- 真正的体积杠杆是 **torch CUDA→CPU(省 ~6-7GB)** + 拆分构建/运行阶段(丢 build-essential)
  + strip site-packages。不是"删源码"。
- **体积下限诚实预期**:CPU torch(~250MB)+ opencv + faiss + moviepy 等是运行真需要的,
  镜像到不了几百 MB(那是桌面 lite 排除大模型 + 砍能力的口径)。容器是 full 功能、带全依赖,
  预计 **11.6GB → ~2-2.5GB**(与桌面同口径 CPU torch)。

### 决策(已与用户确认)

1. 路线:依赖瘦身 + 运行阶段精简(**保留 Python 解释器**,不走 PyInstaller 冻结)。
2. torch:换 **CPU-only** 版,去掉 nvidia-* CUDA 库;**功能全保留**(图像向量化
   DINOv2/CLIP、数字人 Wav2Lip、CosyVoice TTS、in-process rerank 回退全在,只是跑 CPU)。
3. **源头修复也做**:`Dockerfile.base` 直接换 torch+cpu —— 服务器/容器/桌面**哪里都没 GPU**,
   CUDA 永远不该装。让 dev 镜像也从 11GB 掉到 ~4GB,release 再叠加 slim runtime 到 ~2.5GB。
4. registry:**阿里云 ACR**,registry/namespace 参数化,不写死账号。
5. 范围:**只一体化镜像 `chayuan`**;拆分镜像 `Dockerfile.server` 后续再同法处理。
6. 体积 ~2-2.5GB 可接受;**不删 `.dist-info`**(保 importlib.metadata 稳);
   strip `.so` + 删 tests/`__pycache__` 等安全裁剪照做。

## 2. 架构:两段式

既然无 GPU 处处成立,torch CUDA→CPU 放在**最源头的 base** 一次性解决,dev 和 release 共享收益;
release 再在其上叠加 slim runtime 做进一步裁剪。

### 2A. `Dockerfile.base` 换 torch+cpu(源头修复)

在现有 base 的 `poetry install --only main` 之后,新增一层把 CUDA torch 替换为 CPU:

```
# poetry install 装出的是 CUDA torch + nvidia-* 全家,这里替换为 CPU 版
ARG TORCH_CPU_INDEX=https://download.pytorch.org/whl/cpu   # 可 --build-arg 换国内镜像
RUN pip uninstall -y torch triton \
      nvidia-cublas-cu13 nvidia-cuda-cupti-cu13 nvidia-cuda-nvrtc-cu13 \
      nvidia-cuda-runtime-cu13 nvidia-cudnn-cu13 nvidia-cufft-cu13 nvidia-cufile-cu13 \
      nvidia-curand-cu13 nvidia-cusolver-cu13 nvidia-cusparse-cu13 nvidia-cusparselt-cu13 \
      nvidia-nccl-cu13 nvidia-nvjitlink-cu13 nvidia-nvshmem-cu13 nvidia-nvtx-cu13 2>/dev/null || true \
 && pip install --no-cache-dir "torch==<lock版本>+cpu" --index-url ${TORCH_CPU_INDEX}
```

注意:
- torch CPU 版本号要与 lock 的 2.11.0 对得上(plan 阶段确认 pytorch-cpu 源是否有 `2.11.0+cpu`;
  若无,选最接近的、且其它包约束兼容的 CPU 版,或退用桌面在用的 2.5.x+cpu 口径并验证依赖兼容)。
- **不改 `pyproject.toml` / `poetry.lock`**(否则波及桌面 PyInstaller 打包)——只在 base 的
  pip 层替换。base tag 哈希已含 `Dockerfile.base` 内容(build.sh:51),改这里会自动重建 base。
- 改完 dev 镜像(`Dockerfile` FROM base)自动受益,降到 ~4GB。

### 2B. 新增 `Dockerfile.release`(多阶段 slim runtime)

现有 `Dockerfile` / `build.sh` / `Dockerfile.webbase` 不动;`Dockerfile.base` 仅 2A 那一处。
新增 `Dockerfile.release`:

```
Dockerfile.release (multi-stage)
|
+- Stage web-builder    FROM ${WEB_BASE_IMAGE}
|     与现有 Dockerfile 的 web-builder 一致:pnpm install --offline + build apps/web -> dist
|
+- Stage deps-builder   FROM ${BASE_IMAGE}   (= 已是 CPU torch 的 chayuan-base)
|     对 site-packages 做 strip,产出干净树(保留 .dist-info):
|       - rm -rf 各包内 tests/ test/ __pycache__/ docs/ examples/ *.pyc *.pyo
|       - rm *.a 静态库、*.h 头文件
|       - find -name '*.so' -exec strip --strip-unneeded(|| true 容错)
|       - 整棵 site-packages 落到固定路径供下游 COPY
|     (CUDA 已在 2A 的 base 层去掉,这里不再处理 torch)
|
+- Stage runtime        FROM python:3.12-slim   (全新瘦底,不继承 base)
      - apt 只装【运行时】库(无 build-essential / git / poetry / pip 缓存):
          ffmpeg libsndfile1 libmagic1 libgomp1 libstdc++6 libgcc-s1
          libgl1 libglib2.0-0 nginx-light tini curl ca-certificates
        (最终集合以对 torch/opencv/faiss/onnxruntime/sherpa 跑 ldd 实测为准)
      - COPY --from=deps-builder <clean site-packages> -> 系统 site-packages
      - COPY 后端源码 chayuan / langchain_chayuan(.py 原样)
      - COPY vendor/services sidecar 二进制 + chmod +x + 伪软链自修复(照搬现有 Dockerfile)
      - COPY vendor/bundled_fonts / bundled_bgm / bundled_video_clips
      - COPY --from=web-builder dist -> /chayuan/web
      - COPY docker/nginx.conf + docker/entrypoint.sh;mkdir 占位目录
      - ENV / EXPOSE / HEALTHCHECK / ENTRYPOINT 与现有 Dockerfile 完全一致
```

设计要点:

- **runtime 不 FROM base**:体积关键 —— 全新 slim 起底,只 COPY 清洗后的 site-packages,
  天然甩掉 build-essential / poetry / apt 列表 / pip 缓存。
- **复用 base / web-base**:deps-builder / web-builder 仍 FROM 它们,不重新下载依赖。

## 3. `docker/build-release.sh`(registry 参数化,适配阿里云 ACR)

```
职责:
  1) 读 VERSION -> VER
  2) 读 REGISTRY / NAMESPACE:优先级 命令行参数 > 环境变量 > docker/.env.release
     默认占位(registry.cn-hangzhou.aliyuncs.com / <namespace>),不写死真实账号
  3) 确保 base(已是 CPU torch)/ web-base 存在(同 build.sh 哈希判定;缺则先构建)
  4) docker build -f docker/Dockerfile.release
       --build-arg BASE_IMAGE / WEB_BASE_IMAGE
       -t chayuan:${VER}-slim -t chayuan:latest-slim        # 本地 tag 带 -slim,不撞 dev
  5) 远程 tag:${REGISTRY}/${NAMESPACE}/chayuan:${VER} 与 :latest(发布物,无需 -slim)
  6) docker login ${REGISTRY}(凭证走 ACR_USERNAME / ACR_PASSWORD 环境变量或交互,
     绝不入库 / 不落 .env 明文密码)
  7) docker push 两个远程 tag
  8) 打印最终镜像体积(docker images)

参数:
  --no-push        只构建本地 -slim,不 login / 不 push(本地验体积用)
  --rebuild-base   透传(改了 2A 的 torch+cpu 后首次需要)
  --no-cache       透传
  -h/--help
```

新增 `docker/.env.release.example`(模板:REGISTRY / NAMESPACE,**不含密码**);
真 `docker/.env.release` 加进 `docker/.gitignore`。

## 4. tag 命名(最终)

| 用途 | tag |
|---|---|
| dev 本地(不变;现在自动变 ~4GB) | `chayuan:<version>` / `chayuan:latest` |
| release 本地(避免撞 dev) | `chayuan:<version>-slim` / `chayuan:latest-slim` |
| 推送 ACR(发布物) | `${REGISTRY}/${NAMESPACE}/chayuan:<version>` / `:latest` |

## 5. 验证

1. `docker images` 看 dev `chayuan:<ver>` 落到 ~4GB、release `chayuan:<ver>-slim` 落到 ~2-2.5GB。
2. `docker run` 起容器,等 HEALTHCHECK / 打 `http://127.0.0.1/healthz` 通过。
3. 容器内 `python -c "import torch;print(torch.__version__,torch.version.cuda)"`
   断言 `torch.version.cuda is None`(确认 CPU 版,CUDA 已清)。
4. 抽验关键 import:`python -c "import cv2,faiss,sentence_transformers,onnxruntime,moviepy"`。
5. 走一遍 KB 检索 / rerank,确认 sidecar + in-process 回退正常。
6. `docker history` / `dive` 抽查无 build-essential / poetry / pip 缓存 / nvidia-* 残留。

## 6. 风险与边界

- **torch CPU 版本可达性**:确认 pytorch-cpu 源有 `2.11.0+cpu`;国内拉
  download.pytorch.org 可能慢,优先国内 CPU 镜像源;源不可达时构建明确报错,不静默回退 CUDA。
- **runtime apt 运行时库集合**:必须覆盖 torch/opencv/faiss/onnxruntime/sherpa/ffmpeg 链路
  所有 dlopen 的 .so,漏一个就运行时 ImportError。实现阶段用 ldd 实测补全。
- **release 构建较慢**:runtime 不复用 base 层缓存,每次 release 全量 COPY + 清洗。可接受。
- **strip .so 风险**:`--strip-unneeded` 对个别带自检的库可能出问题,失败 `|| true` 容错,
  验证步骤抽测 import;若某库被 strip 坏,加白名单跳过。
- **改 Dockerfile.base 需重建 base**:首次跑 `build.sh --rebuild-base` 或
  `build-release.sh --rebuild-base`;CPU torch 下载量远小于 CUDA,重建更快。
- **不在本设计内**:拆分镜像 `Dockerfile.server` 瘦身、PyInstaller 冻结、砍 torch 的
  更激进 <1GB 路线 —— 留待后续单独立项。

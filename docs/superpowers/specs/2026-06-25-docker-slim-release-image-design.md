# 察元 Docker 瘦身 release 镜像设计

- 日期:2026-06-25
- 范围:仅一体化镜像 `chayuan`(`docker/Dockerfile` 对应的前后端+nginx 单镜像)
- 状态:设计已确认,待写实现 plan

## 1. 背景与目标

现有 `docker/build.sh` + `docker/Dockerfile` 是为 **dev 快速重建**优化的:base 镜像
(`Dockerfile.base`)预装系统依赖 + 全部 poetry 依赖,应用镜像 `FROM base` 只跑 COPY 层,
改业务代码 / version bump 重建零依赖拉取。代价:运行镜像继承了 base 的全部"构建期"重量
—— 尤其 `torch` 默认 GPU 版拖进的 `nvidia-*` CUDA 库(~3-4GB)和 `build-essential`
编译工具链(~150-250MB),而服务器跑 CPU 推理根本用不到 CUDA。

目标:新增一条**为体积优化**的发布(release)路径,产出尽量小的镜像并推送到阿里云 ACR。
release 构建慢一点可接受(发布是偶发动作)。

### 关键现状澄清(避免走错杠杆)

- **前端 npm 依赖 + 客户端源码已不在最终镜像**:multi-stage 只 COPY 编译好的
  `apps/web/dist` 静态产物,`node_modules` 留在 builder 阶段被丢弃。无需再处理。
- **后端是 Python 解释执行**:它 import 的库(torch / opencv / faiss / moviepy …)
  就是程序本身,不能像 C 程序"编译完删依赖"。真正的体积杠杆是**砍 CPU 用不上的
  CUDA + 拆分构建/运行阶段 + strip site-packages**,不是"删源码"。
- **体积下限诚实预期**:torch CPU 本体(~1GB)+ opencv + faiss + moviepy(~1GB)
  是运行真需要的,镜像到不了几百 MB。预计从现状 ~6-8GB 降到 **~2-2.5GB**。

### 决策(已与用户确认)

1. 路线:依赖瘦身 + 运行阶段精简(**保留 Python 解释器**,不走 PyInstaller 冻结)。
2. torch:换 **CPU-only** 版,去掉 nvidia-* CUDA 库;**功能全保留**(图像向量化
   DINOv2/CLIP、数字人 Wav2Lip、CosyVoice TTS、in-process rerank 回退全在,只是跑 CPU)。
3. registry:**阿里云 ACR**,registry/namespace 参数化,不写死账号。
4. 范围:**只一体化镜像 `chayuan`**(`Dockerfile`);拆分镜像 `Dockerfile.server`
   后续需要时再同法处理。
5. 体积 ~2-2.5GB 可接受;**不删 `.dist-info`**(保 importlib.metadata 稳);
   strip `.so` + 删 tests/`__pycache__` 等安全裁剪照做。

## 2. 架构:新增 `docker/Dockerfile.release`(多阶段,独立于 dev 流程)

现有 `Dockerfile` / `build.sh` / `Dockerfile.base` / `Dockerfile.webbase` **全部不动**,
零回归。新增 `Dockerfile.release`:

```
Dockerfile.release (multi-stage)
|
+- Stage web-builder    FROM ${WEB_BASE_IMAGE}   (= chayuan-web-base)
|     与现有 Dockerfile 的 web-builder 完全一致:pnpm install --offline +
|     pnpm -F web build:vite -> /chayuan-client/apps/web/dist
|
+- Stage deps-builder   FROM ${BASE_IMAGE}        (= chayuan-base,复用已下载依赖)
|     对 base 的 site-packages 做"减法",产出干净树:
|       1) torch 换 CPU:pip uninstall -y torch + nvidia-*(cublas/cudnn/cufft/
|          curand/cusolver/cusparse/cuda-* 等全家);pip install
|          torch==<lock 版本>+cpu --index-url <pytorch-cpu 源,阿里云镜像优先>
|       2) strip site-packages(保留 .dist-info):
|            - rm -rf 各包内 tests/ test/ __pycache__/ docs/ examples/ *.pyc *.pyo
|            - rm *.a 静态库、*.h 头文件、*.pyi(谨慎,保留运行需要的)
|            - find -name '*.so' -exec strip --strip-unneeded(忽略失败)
|       3) 整棵 site-packages 落到一个可被下游 COPY 的固定路径
|
+- Stage runtime        FROM python:3.12-slim      (全新瘦底,不继承 base)
      - apt 只装【运行时】库(无 build-essential / git / poetry / pip 缓存):
          ffmpeg libsndfile1 libmagic1 libgomp1 libstdc++6 libgcc-s1
          libgl1 libglib2.0-0 nginx-light tini curl ca-certificates
        (libgl1 / libglib2.0-0 是 opencv-python 运行时 dlopen 需要;最终集合以
         对 torch/opencv/faiss/onnxruntime/sherpa 跑 ldd 实测为准)
      - COPY --from=deps-builder <clean site-packages> -> 系统 site-packages
      - COPY 后端源码:chayuan / langchain_chayuan(.py 原样,不冻结)
      - COPY vendor/services sidecar 二进制 + chmod +x + 伪软链自修复
        (照搬现有 Dockerfile 第 99-116 行那套 find 修复逻辑)
      - COPY vendor/bundled_fonts / bundled_bgm / bundled_video_clips
      - COPY --from=web-builder dist -> /chayuan/web
      - COPY docker/nginx.conf + docker/entrypoint.sh
      - mkdir bundled_models / data / logs 占位
      - ENV / EXPOSE / HEALTHCHECK / ENTRYPOINT 与现有 Dockerfile 完全一致
```

设计要点:

- **复用 base / web-base**:deps-builder 和 web-builder 仍 `FROM` 现有 base 镜像,
  release 构建不重新下载依赖(只在 base 已存在时;否则 build-release.sh 先建 base)。
- **runtime 不 FROM base**:这是体积关键 —— 全新 `python:3.12-slim` 起底,只 COPY
  清洗后的 site-packages,天然甩掉 build-essential / poetry / apt 列表 / pip 缓存。
- **torch CPU 不动共享 pyproject**:只在 deps-builder 阶段 pip 层替换,
  `pyproject.toml` / `poetry.lock` 零改动,desktop PyInstaller 打包不受影响。

## 3. `docker/build-release.sh`(registry 参数化,适配阿里云 ACR)

```
职责:
  1) 读 VERSION -> VER
  2) 读 REGISTRY / NAMESPACE:优先级 命令行参数 > 环境变量 > docker/.env.release
     默认占位(registry.cn-hangzhou.aliyuncs.com / <namespace>),不写死真实账号
  3) 确保 base / web-base 存在(同 build.sh 的哈希判定;缺则先构建,--rebuild-base 透传)
  4) docker build -f docker/Dockerfile.release
       --build-arg BASE_IMAGE / WEB_BASE_IMAGE
       -t chayuan:${VER}-slim -t chayuan:latest-slim        # 本地 tag 带 -slim,
                                                            # 不撞 dev 的 chayuan:latest
  5) 远程 tag:
       ${REGISTRY}/${NAMESPACE}/chayuan:${VER}
       ${REGISTRY}/${NAMESPACE}/chayuan:latest              # 发布物本身,无需 -slim 后缀
  6) docker login ${REGISTRY}(凭证走环境变量 / 交互输入,绝不入库 / 不落 .env 明文密码)
  7) docker push 两个远程 tag
  8) 打印最终镜像体积(docker images)

参数:
  --no-push        只构建本地 -slim,不 login / 不 push(给本地验体积用)
  --rebuild-base   透传给 base 构建
  --no-cache       透传
  -h/--help

凭证来源:ACR 用户名/密码走 ACR_USERNAME / ACR_PASSWORD 环境变量(CI 友好),
未设则 docker login 交互输入。.env.release 只放 REGISTRY / NAMESPACE,不放密码。
```

新增 `docker/.env.release.example`(模板:REGISTRY / NAMESPACE,**不含密码**);
真 `docker/.env.release` 加进 `docker/.gitignore`。

## 4. tag 命名(最终)

| 用途 | tag |
|---|---|
| dev 本地(不变) | `chayuan:<version>` / `chayuan:latest` |
| release 本地(避免撞 dev) | `chayuan:<version>-slim` / `chayuan:latest-slim` |
| 推送 ACR(发布物) | `${REGISTRY}/${NAMESPACE}/chayuan:<version>` / `:latest` |

## 5. 验证

1. `docker images` 看 `chayuan:<ver>-slim` 体积是否落到 ~2-2.5GB 区间。
2. `docker run` 起容器,等 HEALTHCHECK / 打 `http://127.0.0.1/healthz` 通过。
3. 容器内 `python -c "import torch; print(torch.__version__, torch.version.cuda)"`
   断言 `torch.version.cuda is None`(确认 CPU 版,CUDA 库已清)。
4. 抽验关键 import 不缺库:`python -c "import cv2, faiss, sentence_transformers,
   onnxruntime, moviepy"`(strip 不应破坏导入)。
5. 走一遍 KB 检索 / rerank,确认 sidecar + in-process 回退正常。
6. `docker history` / `dive` 抽查无 build-essential / poetry / pip 缓存残留。

## 6. 风险与边界

- **runtime apt 运行时库集合**:必须覆盖 torch/opencv/faiss/onnxruntime/sherpa-onnx/
  ffmpeg 链路所有 dlopen 的 .so,漏一个就运行时 ImportError。实现阶段用 ldd 实测补全,
  不靠拍脑袋。
- **release 构建较慢**:runtime 不复用 base 层缓存,每次 release 全量 COPY + 清洗。
  可接受(发布偶发)。dev 日常仍走 build.sh,不受影响。
- **strip .so 风险**:`--strip-unneeded` 对个别带自检的库可能出问题,失败要 `|| true`
  容错并在验证步骤抽测 import;若发现某库被 strip 坏,加白名单跳过。
- **torch CPU 源可达性**:国内拉 download.pytorch.org/whl/cpu 可能慢,优先用阿里云
  PyTorch CPU 镜像源;源不可达时 build-release.sh 明确报错,不静默回退 CUDA 版。
- **不在本设计内**:拆分镜像 `Dockerfile.server` 的瘦身、PyInstaller 冻结路线、
  砍 torch 的更激进 <1GB 路线 —— 都留待后续单独立项。

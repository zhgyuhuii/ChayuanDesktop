# vendor/bundled_models — 项目内固定模型槽

把模型文件**固定**放在这个目录下,调试时直接被扫到、打包时随 exe 一同分发、
安装时种到用户数据目录。所有路径都在 server 仓库内部,**不要**把这里的内容
拷到 `chayuan-client` 或 `chayuan` 仓库。

---

## 目录

- [目录约定](#目录约定)
- [推荐模型清单与下载地址](#推荐模型清单与下载地址)
- [下载方法](#下载方法)
- [模型格式速查](#模型格式速查)
- [四种工作模式](#四种工作模式)
- [解析优先级](#解析优先级)
- [打包流程](#打包流程)
- [调试模型](#调试模型)
- [不该放什么](#不该放什么)
- [提交注意事项](#提交注意事项)

---

## 目录约定

按 capability 分子目录存放,目录名 = capability tag:

```
vendor/bundled_models/
├── chat/        <repo>/...gguf | tokenizer.json + ...
├── embedding/   <repo>/...gguf | model.onnx + ...
├── rerank/      <repo>/tokenizer.json + ...
├── asr/         whisper-*.bin | model.onnx
├── ocr/         det.onnx + rec.onnx + ...
├── image/       stable-diffusion-*.gguf | safetensors
└── custom/      其它自定义(capability 由文件名/标志推断)
```

**摆法**:

- 单文件模型:直接放 `*.gguf` / `*.onnx`,如 `chat/qwen3-4b-q4_k_m.gguf`。
- 多文件仓库:放一个**子目录**,里面带 `config.json` / `tokenizer.json` /
  `model_index.json` / `manifest.json` 任一标志文件即视为完整仓库。

扫描深度上限 5 层,扫描器遇到带标志文件的目录就停止下钻,避免把仓库内
子目录误识别。

---

## 推荐模型清单与下载地址

下表与 `packaging/python312/layout.yaml`(`§4 模型` 段)真源对齐。所有
HuggingFace 链接都给出国内镜像 `hf-mirror.com`(无需翻墙),海外网络下
可把 `hf-mirror.com` 替换成 `huggingface.co` 直链。

| 类别 | 模型 | 大小 | release | HF mirror 下载地址 |
|---|---|---|---|---|
| chat | `Qwen/Qwen3-4B-Instruct-GGUF` 的 `qwen3-4b-instruct-q4_k_m.gguf` | ~2.5 GB | lite/standard/pro | https://hf-mirror.com/Qwen/Qwen3-4B-Instruct-GGUF |
| chat | `Qwen/Qwen3-7B-Instruct-GGUF` 的 `qwen3-7b-instruct-q4_k_m.gguf` | ~4.5 GB | pro | https://hf-mirror.com/Qwen/Qwen3-7B-Instruct-GGUF |
| embedding | `BAAI/bge-m3`(HF transformers 完整仓库) | ~570 MB | 全部 | https://hf-mirror.com/BAAI/bge-m3 |
| embedding | `BAAI/bge-large-zh-v1.5`(可选高精度备选) | ~1.4 GB | standard/pro | https://hf-mirror.com/BAAI/bge-large-zh-v1.5 |
| rerank | `BAAI/bge-reranker-v2-m3` | ~560 MB | 全部 | https://hf-mirror.com/BAAI/bge-reranker-v2-m3 |
| asr | `ggerganov/whisper.cpp` 的 `ggml-tiny.bin` | ~75 MB | 全部 | https://hf-mirror.com/ggerganov/whisper.cpp |
| ocr | `SWHL/RapidOCR`(PP-OCR ONNX 三件套) | ~12 MB | standard/pro | https://hf-mirror.com/SWHL/RapidOCR |

**release 矩阵含义**:

- `lite`:单机轻量版,带 4B 对话 + bge-m3 嵌入 + reranker + whisper-tiny
- `standard`:服务器标准版,在 lite 基础上加 OCR + 大向量
- `pro`:全量,把对话模型换成 7B 并保留所有可选

**自己加模型**:不在表里的也可以,只要放进对应 `<cap>/` 目录且符合
[模型格式速查](#模型格式速查)的格式约定,扫描器都能认出。要让它进
官方打包,在 layout.yaml `§4` 加一条:

```yaml
- name: my-custom-chat
  repo: MyOrg/MyModel-GGUF
  file: my-model-q4.gguf
  dest: models/chat/MyOrg--MyModel
  source: hf-mirror://MyOrg/MyModel-GGUF
  release: [standard, pro]
  note: 自定义对话模型
```

---

## 下载方法

### 方式 1:`chayuan_packaging fetch`(推荐 — 批量、断点、缓存)

按 `release` 一次性把表里所有模型 + vendor runtimes 都拉到本地缓存,
再 `stage` 解压到 `vendor/bundled_models/` + `vendor/runtimes/`:

```bash
cd chayuan-server
# linux x86_64 standard release 的所有资源
python -m chayuan_packaging fetch --target linux --arch x86_64 --release standard
python -m chayuan_packaging stage  --target linux --arch x86_64 --release standard

# 国内网默认会走 hf-mirror.com;海外环境改成官方源
python -m chayuan_packaging fetch ... --hf-mirror huggingface.co

# 只看清单不下载(检查 layout.yaml 是否对)
python -m chayuan_packaging fetch ... --offline
```

`--target` 支持 `linux / macos / windows`,`--arch` 支持
`x86_64 / arm64`。fetch 把文件按 sha256 缓存到 `.cache/`,重跑只校验
不重传。

### 方式 2:手动 `huggingface-cli`(单个模型)

```bash
# 安装
pip install -U huggingface_hub
# 国内镜像
export HF_ENDPOINT=https://hf-mirror.com

# 单文件 GGUF
huggingface-cli download Qwen/Qwen3-4B-Instruct-GGUF \
  qwen3-4b-instruct-q4_k_m.gguf \
  --local-dir vendor/bundled_models/chat

# 整个仓库(embedding / rerank / 多文件)
huggingface-cli download BAAI/bge-m3 \
  --local-dir vendor/bundled_models/embedding/bge-m3
```

### 方式 3:`wget` / `curl` 直链(无 python 环境)

```bash
mkdir -p vendor/bundled_models/chat
wget -O vendor/bundled_models/chat/qwen3-4b-instruct-q4_k_m.gguf \
  https://hf-mirror.com/Qwen/Qwen3-4B-Instruct-GGUF/resolve/main/qwen3-4b-instruct-q4_k_m.gguf
```

### 方式 4:ModelScope(国内更稳)

```bash
pip install modelscope
modelscope download --model Qwen/Qwen3-4B-Instruct-GGUF \
  qwen3-4b-instruct-q4_k_m.gguf \
  --local_dir vendor/bundled_models/chat
```

ModelScope 上常见的镜像账号:`Qwen` / `BAAI` / `ZhipuAI` / `OpenBMB`。

### 方式 5:`git clone` + git-lfs(整仓克隆)

```bash
# 需要先 brew install git-lfs / apt install git-lfs
cd vendor/bundled_models/embedding
git lfs install
git clone https://hf-mirror.com/BAAI/bge-m3 BAAI--bge-m3
```

---

## 模型格式速查

不同 capability 的后端 runtime 期望不同格式,放错位置 / 错格式扫描器会
把 `capability` 误判成 `other`,启动时不会被默认模型 promote 选中。

| 格式 | 后缀 | 典型 capability | 后端 runtime | 标志文件 |
|---|---|---|---|---|
| GGUF | `.gguf` | chat / embedding | llama-cpp / llama-server | 单文件即可 |
| HF transformers | (目录) | embedding / rerank / 多模态 | infinity-emb / transformers | `config.json` + `tokenizer.json` + 权重 |
| safetensors | `.safetensors` | chat / image / 通用 | transformers / diffusers | 通常配 `config.json` |
| ONNX | `.onnx` | embedding / rerank / OCR | onnxruntime | 通常配 `tokenizer.json` 或 `manifest.json` |
| whisper.cpp ggml | `ggml-*.bin` | asr | whisper.cpp | 单文件,无标志文件 |
| PaddleOCR ONNX | `det.onnx`+`rec.onnx`+`cls.onnx` | ocr | rapidocr-onnxruntime | 三件套同目录 |

**经验**:

- 同一模型有 GGUF / safetensors 两版,**桌面端优先用 GGUF**(单文件、内存
  友好、llama-cpp 跨平台)。
- 量化等级 `q4_k_m` 是甜区(精度损失 < 1%,体积 ~原 16bit 的 30%)。
- embedding / rerank 选 `bge-*` 家族;同家族搭配检索效果最好。

---

## 四种工作模式

### 1. 开发态(dev mount)

server 启动时 `first_launch.run_first_launch_hooks()` 会扫
`<chayuan-server>/vendor/bundled_models/`,把内容 seed 到
`<CHAYUAN_ROOT>/models/bundled/`,再 `scan_once` 写入 local_index。
`pnpm run dev` 起 sidecar 一次,这些模型就能在对话框下拉里看到了。

```
$ chayuan model status
local_index:
  - models/bundled/chat/qwen3-4b-q4_k_m.gguf    (capability=chat, source=models)
  - models/bundled/embedding/bge-m3              (capability=text-embedding)
```

### 2. 打包态(auto-bundle)

`packaging/pyinstaller/chayuan-server.spec` 把整个 `vendor/bundled_models/`
作为 `datas` 一起打进 sidecar 资源。运行时通过 `sys._MEIPASS / "bundled_models"`
还原。Tauri 把 sidecar 嵌进 `apps/desktop` 的 `binaries/`,最终装机包
里这些模型成了应用的一部分。

打包脚本依 layout.yaml `releases.<name>.models` 字段决定**哪些**模型
纳入哪个 release,详见 [打包流程](#打包流程)。

### 3. 安装态(auto-seed)

首启时 `seed_bundled_models()` 把 `_MEIPASS/bundled_models/` 拷到
`<CHAYUAN_ROOT>/models/bundled/`,**idempotent**:目标已存在且大小一致
则跳过;用户改动过 mtime 的文件不覆盖。

### 4. 替换态(runtime swap)

用户在 `<CHAYUAN_ROOT>/models/bundled/<cap>/` 下替换或新增任何文件,
下次 server 启动(或运行 `chayuan model scan`)`scan_once` 自动识别
并写入 `local_models.json`,无需重启电脑。

---

## 解析优先级

`local_index.bundled_models_dir()` 按以下顺序找根目录:

1. 环境变量 `CHAYUAN_BUNDLED_MODELS_DIR`(测试 / 特殊部署专用)
2. PyInstaller 运行时:`sys._MEIPASS / "bundled_models"`
3. 仓库 dev 模式:`<chayuan-server>/vendor/bundled_models`
4. exe 同级:`<argv0 dir>/bundled_models`(便携安装)

返回第一个**存在**的路径;都不存在则返回 `None`,扫描和 seed 都跳过。

---

## 打包流程

完整的打包链:

```
fetch (拉模型/runtime → .cache/)
   ↓
stage (解压到 vendor/bundled_models + vendor/runtimes/)
   ↓
pyinstaller (生成 onefile sidecar,内嵌 vendor/bundled_models)
   ↓
build.py (拷 sidecar 到 chayuan-client/apps/desktop/binaries/)
   ↓
tauri build (生成 .dmg / .msi / .deb)
```

### 一键打包(推荐)

```bash
cd chayuan-server
# 把指定 release 的所有资源拉好 + 解压
python -m chayuan_packaging fetch --target linux --arch x86_64 --release standard
python -m chayuan_packaging stage  --target linux --arch x86_64 --release standard

# 生成 sidecar(产物在 dist/chayuan-server[.exe])
poetry run python packaging/pyinstaller/build.py
```

`build.py` 内部跑 `poetry run pyinstaller packaging/pyinstaller/chayuan-server.spec
--noconfirm`,再把 `dist/chayuan-server*` 拷到
`chayuan-client/apps/desktop/src-tauri/binaries/`(并按 Tauri sidecar
命名约定加 `-${triple}` 后缀)。

### 单独验证打包

打包前先确认 layout / spec 没漏配:

```bash
python -m chayuan_packaging audit --release standard
poetry run python -m py_compile packaging/pyinstaller/chayuan-server.spec
```

### 跨平台

PyInstaller 不能交叉编译,每个目标 OS / arch 在原生机器上跑一次:

| 平台 | 命令 |
|---|---|
| macOS arm64 | `python -m chayuan_packaging fetch --target macos --arch arm64 --release standard` |
| macOS x86_64 | `python -m chayuan_packaging fetch --target macos --arch x86_64 --release standard` |
| Linux x86_64 | `python -m chayuan_packaging fetch --target linux --arch x86_64 --release standard` |
| Windows x86_64 | `python -m chayuan_packaging fetch --target windows --arch x86_64 --release standard` |

### release 选择

| release | 包大小 | 模型 | 推荐场景 |
|---|---|---|---|
| `lite` | ~3.5 GB | 4B chat + bge-m3 + reranker + whisper-tiny | 个人单机,8GB 内存机器 |
| `standard` | ~5 GB | lite + RapidOCR + bge-large 备选 | 服务器多用户、有 OCR 需求 |
| `pro` | ~8 GB | standard + 7B chat | 16GB+ 内存,高质量对话 |

### 不带模型的打包(用户自配)

如果想做"空"安装包(完全靠 BootstrapBanner 引导用户后下载),把
`vendor/bundled_models/<cap>/` 下的权重文件都删掉(留 `.gitkeep` 占位),
再跑 pyinstaller — spec 看到目录里没有真权重就 `bundled_models_dir()`
返回也可能为 None / 空,seed 步骤跳过。安装后用户在「设置 → 默认模型」
顶部的 BootstrapBanner 选「下载 standard 包」由 server 后台拉。

---

## 调试模型

### 一站式自检 — `chayuan model status`

最常用,一条命令把"扫描 → 候选 → 当前默认 → 推理引擎启动参数"都打出来:

```bash
chayuan model status              # 人类可读
chayuan model status --json       # 给脚本消费(jq 解析方便)
chayuan model status --no-scan    # 不重扫,直接读 local_models.json
```

输出三段:

1. **local_index**:磁盘上扫到的模型列表(model_id / capability / 路径 / 大小)
2. **capability_defaults**:9 类 capability 当前默认指向哪个模型
3. **process_args**:llama-server / infinity / piper 进程实际收到的
   `--model` 参数;`missing` 表示 capability 没指好

### 强制重扫 — `chayuan model scan`

放新模型 / 删除旧模型后,让 local_index 立刻知道:

```bash
chayuan model scan
chayuan model scan --verbose  # 看每个扫描根 + 每条 entry 的 identify 过程
```

### 列出 / 导入 / 下载 — 其它 model 子命令

```bash
chayuan model list                  # 只列已识别的本地模型
chayuan model import /path/to/model # 软链外部路径到 <CHAYUAN_ROOT>/models/custom/
chayuan model download <id>         # 按 layout.yaml 配置远程下载单个模型
```

### 看模型是否真能被推理引擎调用

写入扫描表只是第一步,推理引擎(llama-server / infinity / ...)能不能
真起来,要看 supervisor 日志:

```bash
# server 启动后看 supervisor 进程状态
chayuan supervisor status

# 看每个进程的 stdout / stderr
chayuan supervisor logs llama-server --tail 200
chayuan supervisor logs infinity-emb --tail 200

# 手动用单进程跑一下(打包到 vendor/runtimes/llama-cpp/bin/llama-server)
./vendor/runtimes/llama-cpp/bin/llama-server \
  --model <CHAYUAN_ROOT>/models/bundled/chat/qwen3-4b-q4_k_m.gguf \
  --port 18080 --host 127.0.0.1
```

### 直接 curl 测试 chat completion

server 跑起来后,从 `/v1/models` 看模型有没有出现,再用 OpenAI 兼容
接口测一次对话:

```bash
# 1. 模型已注册?
curl -s http://127.0.0.1:8000/v1/models | jq '.data[] | select(.platform_name=="local")'

# 2. 一次对话
curl -s http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "bundled/chat/qwen3-4b-q4_k_m.gguf",
    "messages": [{"role":"user","content":"你好"}]
  }' | jq
```

### 常见诊断

| 现象 | 排查 |
|---|---|
| 对话框没有"本地模型"分组 | `chayuan model scan && chayuan model status` 看 local_index 是否扫到 |
| 扫到了但 capability=other | 标志文件缺失,或文件名识别不到家族关键字。摆到 `custom/` 下并加 `manifest.json` |
| capability 对但 default 没指到本地 | 设置页里手选;或 `chayuan model status` 看 `auto_assign` 是不是被云厂商抢先 |
| llama-server 起不来 | `supervisor logs llama-server` 看具体错;常见是模型路径不对 / 端口被占 / 内存不足 |
| 单元测试访问不到 bundled | 测试用 `monkeypatch.setenv('CHAYUAN_BUNDLED_MODELS_DIR', str(fake_dir))` |

---

## 不该放什么

- 大于 layout.yaml release 上限的模型(standard 单文件 ≤ 3GB;pro 不限)
- 任何 `.env`、`*.key`、`*.pem` 或私钥
- 非 AGPL / Apache / MIT 等开源协议的权重
- 训练 checkpoint 中间文件(只放可直接推理的最终 weights)

---

## 提交注意事项

git 默认会忽略 `*.gguf` / `*.safetensors` / `*.onnx`,以及本目录下的
`*.bin`(见仓库根 `.gitignore`),所以只有 `.gitkeep` / README 入库。

要在 CI 跑集成测试或本地复现打包,先用 `chayuan_packaging fetch
<release>` 把模型预拉到这里,再跑 pytest / pyinstaller。

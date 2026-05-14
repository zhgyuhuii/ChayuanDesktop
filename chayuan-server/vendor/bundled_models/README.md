# vendor/bundled_models — 项目内固定模型槽

把模型文件**固定**放在这个目录下，调试时直接被扫到、打包时随
exe 一同分发、安装时种到用户数据目录。所有路径都在 server 仓库
内部，**不要**把这里的内容拷到 `chayuan-client` 或 `chayuan` 仓库。

## 目录约定

按 capability 分子目录存放，目录名 = capability tag：

```
vendor/bundled_models/
├── chat/        <repo>/...gguf | tokenizer.json + ...
├── embedding/   <repo>/...gguf | model.onnx + ...
├── rerank/      <repo>/tokenizer.json + ...
├── asr/         whisper-*.bin | model.onnx
├── ocr/         det.onnx + rec.onnx + ...
├── image/       stable-diffusion-*.gguf | safetensors
└── custom/      其它自定义（capability 由文件名/标志推断）
```

每个 capability 目录里：

- 单文件模型：直接放 `*.gguf` / `*.onnx`，如 `chat/qwen3-4b-q4_k_m.gguf`。
- 多文件仓库：放一个**子目录**，里面带 `config.json` / `tokenizer.json` /
  `model_index.json` / `manifest.json` 任一标志文件即视为完整仓库。

扫描深度上限 5 层，扫描器遇到带标志文件的目录就停止下钻，避免把
仓库内子目录误识别。

## 三种工作模式

### 1. 开发态（dev mount）

`local_index._candidate_roots()` 会把 `<chayuan-server>/vendor/bundled_models/`
作为额外扫描根，`source_tag = "bundled/<capability>"`。
你 `pnpm run dev` 起 sidecar 就能直接发现：

```
$ chayuan model status
local_index:
  - bundled/chat/qwen3-4b-q4_k_m.gguf  (capability=text-generation)
  - bundled/embedding/bge-m3            (capability=text-embedding)
```

### 2. 打包态（auto-bundle）

`chayuan-installer` 的 PyInstaller `.spec` 把整个 `vendor/bundled_models/`
作为 `datas` 一起打进 sidecar 资源。运行时通过 `sys._MEIPASS / "bundled_models"`
还原。打包脚本会在 lite/standard/pro release 时按 layout.yaml 决定**哪些**
模型纳入打包（lite 留空、standard 带 4B + embedding + rerank、pro 全量）。

### 3. 安装态（auto-seed）

server 首启时 `first_launch.run_first_launch_hooks()` 会先跑
`seed_bundled_models()`：把 bundled 里有但 `<CHAYUAN_ROOT>/models/` 里
还没有的文件 **idempotent 复制**到用户数据目录。已有同名文件
（size 一致或 mtime 更新）保留用户版本，不覆盖。

### 4. 替换态（runtime swap）

用户在 `<CHAYUAN_ROOT>/models/` 下替换或新增任何文件，scan_once
会在下一次 `chayuan model rescan` / 启动钩子里自动识别并写入
`local_models.json`，无需重启。

## 解析优先级

`local_index.bundled_models_dir()` 按以下顺序找根目录：

1. 环境变量 `CHAYUAN_BUNDLED_MODELS_DIR`（测试/特殊部署专用）
2. PyInstaller 运行时：`sys._MEIPASS / "bundled_models"`
3. 仓库 dev 模式：`<chayuan-server>/vendor/bundled_models`
4. exe 同级：`<argv0 dir>/bundled_models`（便携安装）

返回第一个**存在**的路径；都不存在则返回 `None`，扫描和 seed 都跳过。

## 不该放什么

- 大于 layout.yaml release 上限的模型（standard 单文件 ≤ 3GB；pro 不限）
- 任何 `.env`、`*.key`、`*.pem` 或私钥
- 非 AGPL/Apache/MIT 等开源协议的权重
- 训练 checkpoint 中间文件（仅放可推理的最终 weights）

## 提交注意事项

git 默认会忽略 `*.gguf`、`*.bin`、`*.safetensors`、`*.onnx`（见
`/work/chayuan-desktop/.gitignore`），所以只有 `.gitkeep` / README
入库。要在 CI 跑集成测试，先用 `chayuan_packaging fetch <release>`
把模型预拉到这里。

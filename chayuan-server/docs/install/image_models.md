# 图像知识源 · 模型下载与部署指引

察元的图像知识源（`kind=image`）支持**文本查图**（跨模态）与**以图搜图**，
需要一个图像向量化（vision-language）模型。本文档覆盖：

1. 推荐模型对比
2. 装依赖
3. 有网 / 有镜像 / 完全离线 三种场景下载方式
4. 常见故障排查

---

## 1. 推荐模型对比（2026 行业最佳实践）

| 模型 | 维度 | 大小 | 中文 | 推荐场景 |
|---|---:|---:|---|---|
| **`google/siglip2-base-patch16-224`** | 768 | ~400MB | 中 | **默认推荐**，平衡速度与质量 |
| `google/siglip2-large-patch16-384` | 1024 | ~1.4GB | 中 | 更高精度，384×384 分辨率 |
| **`OFA-Sys/chinese-clip-vit-base-patch16`** | 512 | ~400MB | 🔥**强** | 中文内容优先场景 |
| `OFA-Sys/chinese-clip-vit-large-patch14-336px` | 768 | ~1.4GB | 🔥**强** | 中文高精场景 |
| `jinaai/jina-clip-v2` | 1024 | ~1GB | 强 | 89 语言 + 长文 |
| `openai/clip-vit-large-patch14` | 768 | ~1.7GB | 弱 | 英语经典基线 |

> **怎么选**：  
> - 中文为主 → Chinese-CLIP base （400MB）  
> - 多语言 / 英文为主 → SigLIP 2 base （400MB，默认）  
> - 预算充足 / 追求精度 → 同系列 large 版本  
> - 查询是长文本 → Jina CLIP v2

---

## 2. 安装运行时依赖

```bash
# pip 方式（含 torch，可能较大）
pip install "chayuan-server[image]"

# 或精确最小依赖
pip install Pillow>=10 transformers>=4.45 torch>=2.1 huggingface_hub>=0.24
```

> **GPU 加速**：如果有 CUDA 显卡，装 `torch` 时用官方指引选匹配的 `torch`+CUDA 版本；察元自动探测并启用 GPU，吞吐约 CPU 的 10×。

---

## 3. 下载模型（三种场景）

### 3.1 场景 A：有网（直连 huggingface.co）

最省事：  
**WebUI → 数据源管理 → 🧠 图像模型 Tab → 选中目标 → 点"开始下载"**

后端会把模型文件放到：
- `$CHAYUAN_ROOT/models/huggingface/hub/models--{org}--{name}/`  
- 或默认 `~/.cache/huggingface/hub/...`

建议勾选"异步下载"（需要启动 `chayuan worker` + 配置 `REDIS_URL`），避免 HTTP 超时。

### 3.2 场景 B：有 HuggingFace 镜像（国内常见）

启动察元前设置环境变量：

```bash
# Linux / macOS
export HF_ENDPOINT=https://hf-mirror.com
chayuan start -a

# Windows cmd
set HF_ENDPOINT=https://hf-mirror.com && chayuan start -a

# Windows PowerShell
$env:HF_ENDPOINT = "https://hf-mirror.com"; chayuan start -a
```

然后用上面 3.1 的 WebUI 下载即可。

### 3.3 场景 C：完全离线（推荐运维方式）

在**有网**的机器上执行：

```bash
# 1. 装 huggingface-cli
pip install huggingface_hub

# 2. 下载到本地目录（示例：SigLIP 2 base）
huggingface-cli download google/siglip2-base-patch16-224 \
  --local-dir ./siglip2-base

# 3. 打包成 tar.gz 或 zip
tar czf siglip2-base.tar.gz siglip2-base/
# 或 zip -r siglip2-base.zip siglip2-base/
```

然后把打包文件传到离线机器，  
**WebUI → 数据源管理 → 🧠 图像模型 Tab → "📤 上传模型 Bundle" → 选 zip/tar.gz → 点"导入"**  
后端会自动解压到 `$CHAYUAN_ROOT/models/huggingface/hub/models--google--siglip2-base-patch16-224/snapshots/manual-upload/`。

> **替代方案**：也可以直接把整个 HF cache 目录（`~/.cache/huggingface/hub/models--*/`）整体复制到离线机器的 `$CHAYUAN_ROOT/models/huggingface/hub/` 下，察元启动时会自动识别。

---

## 4. 验证模型可用

配置完后，WebUI「🧠 图像模型」Tab 里目标模型行应显示：

- `cached` = ✅
- `deps` = ✅

点进"向量知识库 → 新建图像知识源"，选刚下载的模型，建完源后点"测试连接"：  
返回 **`图像模型就绪：google/siglip2-base-patch16-224`** 即全通。

---

## 5. 常见问题

### Q1: 下载时卡在"downloading"某个文件很久
通常是网速慢或 HF 主站被封。  
→ 方案：设 `HF_ENDPOINT=https://hf-mirror.com` 重启，或走离线上传。

### Q2: 导入 Bundle 后 "模型加载失败"
多半是 bundle 内部层级不对。解压后应该能看到：
```
<bundle>/config.json
<bundle>/tokenizer.json（或 tokenizer_config.json）
<bundle>/*.safetensors（或 pytorch_model.bin）
<bundle>/preprocessor_config.json
```

如果是一级 `snapshots/<hash>/...` 层级，直接把 `snapshots/` 往 cache 根目录挪平即可。

### Q3: 向量维度不一致
图像知识源一旦用 A 模型 build 了索引，再换 B 模型必须**重建索引**（在该图像源下删除所有 item 后重新上传）。察元也会在插入时检测维度不一致抛错提醒。

### Q4: 磁盘空间不够
WebUI「🧠 图像模型」Tab 底部「💾 磁盘占用」显示全部缓存的模型文件；不再用的可以点"删除"回收。

### Q5: 是否支持量化 / ONNX / CoreML 加速？
- **量化**：HuggingFace 社区有一些 fp16 / int8 版本（名字带 `-fp16` 后缀），可直接在模型列表里指定；效果衰减通常 <1%。  
- **ONNX / CoreML**：暂未集成；如需可提 issue，后续会加 `optimum`-based backend。

---

## 6. 配置项参考

`chayuan_data/kb_settings.yaml`：

```yaml
# 默认图像向量化模型（与模型管理 Tab 里的 name 对应）
IMAGE_EMBEDDER: google/siglip2-base-patch16-224

# 单张图最大允许上传大小（MB）
IMAGE_MAX_UPLOAD_MB: 20
```

环境变量等价：
- `CHAYUAN_IMAGE_EMBEDDER=<model_name>` 覆盖默认模型
- `HF_ENDPOINT=https://hf-mirror.com` 下载镜像
- `HF_HOME=/path/to/cache` 自定义 HF 缓存目录
- `CHAYUAN_ROOT=/path/to/data` 察元数据根（模型会放在 `<root>/models/huggingface/`）

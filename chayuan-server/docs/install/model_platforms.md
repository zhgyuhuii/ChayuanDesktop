# 模型平台配置 (MODEL_PLATFORMS)

`model_settings.yaml` 的 `MODEL_PLATFORMS` 列表决定察元后端连接哪些模型厂商,
以及哪些模型暴露给 `/v1/models` 和 chat / embed / rerank 的链路。

## 字段速查

```yaml
MODEL_PLATFORMS:
  - platform_name: ollama          # 显示名(必填,前端按此分组)
    platform_type: ollama          # 协议:openai / ollama / xinference / oneapi / fastchat / custom openai
    api_base_url: http://127.0.0.1:11434/v1
    api_key: EMPTY                  # 没有就 EMPTY
    api_proxy: ''                   # HTTP 代理,留空走直连
    api_concurrencies: 5

    enabled: true                   # 厂商总开关。false → 整个平台所有模型不会出现
    auto_detect_model: true         # ollama / xinference 自动拉真实安装清单(60s 缓存)
    disabled_models: []             # 黑名单:即使 auto_detect 检测到,也不暴露

    # auto_detect_model=true 时下方 *_models 是手动并集(检测+手填合并去重)
    # auto_detect_model=false 时下方 *_models 是唯一白名单
    llm_models:
      - qwen3:8b
    embed_models:
      - bge-m3
    text2image_models: []
    image2text_models: []
    rerank_models: []
    speech2text_models: []
    text2speech_models: []
```

## 启用/禁用(三层粒度)

| 想做的事 | 怎么改 |
|---|---|
| 临时下线整个 vendor(配置不删) | `enabled: false` |
| 屏蔽某个模型但保留 vendor | `disabled_models: ["model-x"]` |
| 临时只开放白名单 | `auto_detect_model: false` + 显式列 `llm_models` |
| 自动跟随 ollama 安装/删除 | `auto_detect_model: true`(默认) |

`/v1/models` 是**单一真源** —— 出现在那里的就是前端能选的。

## Ollama auto_detect 工作流程

1. 启动时 `auto_detect_model: true` 触发 `detect_ollama_models(api_base_url)`
2. GET `<base>/api/tags` 拉真实安装的模型清单
3. 按名字粗分:
   - 含 `bge` / `embed` / `m3e` / `nomic-embed` / `mxbai-embed` → embed_models
   - 其它 → llm_models
4. 60s TTL 缓存,避免热路径反复调
5. 失败软回落:用配置里手填的 `llm_models / embed_models`

测试新装一个模型是否生效:
```bash
ollama pull qwen3:8b
# 60s 内
curl http://127.0.0.1:7861/v1/models | jq '.data[] | select(.platform_name=="ollama")'
```

## xinference auto_detect

- `platform_type: xinference` + `auto_detect_model: true`
- 调 xinference REST `/v1/models` 拉当前已 launch 的模型
- 类型识别按 xinference 自身的 `model_type` 字段(LLM / embedding / rerank / image / audio)
- 60s TTL 缓存

## 检索阈值 (SCORE_THRESHOLD)

`kb_settings.SCORE_THRESHOLD` 默认 `0.3`(归一化相关度)。两种语义自动识别:

- `threshold ∈ [0, 1]`:归一化相关度,值越大越相关
  - `0.3 ~ 0.5`:常用区间
  - `0.7+`:通常太严
  - `0`:不筛选
- `threshold > 1.0`:旧 L2 距离语义,值越小越相关
  - `2.0`:相当于不筛选(向后兼容,旧配置不用动)

任何配置生成的相关度都会归一化后写到 `doc.metadata['score']`,前端引用排序统一从这里取。

## 错误排查

| 错误日志 | 原因 | 处理 |
|---|---|---|
| `model 'X' not in MODEL_PLATFORMS.*.llm_models` | 模型没加到任何平台 | 加到 `llm_models`,或对支持的平台(ollama/xinference)开 `auto_detect_model: true` |
| `failed to create ChatOpenAI for model: X` (ValidationError) | 平台 api_base_url / api_key 错,或 SDK 版本不兼容 | 看 message 里的 `api_base / key_set`;曾出过 langchain-openai Pydantic v2 校验 callbacks 的问题,5ef0896 已修 |
| `auto_detect_model not supported for X yet` | 该 platform_type 还不支持自动检测 | 改 `auto_detect_model: false` 走手填模式 |
| `No relevant docs were retrieved (mode=relevance >= 0.3)` | 阈值高于实际命中度 | 调低 `SCORE_THRESHOLD`;或确认 embedding 模型是否匹配语料 |

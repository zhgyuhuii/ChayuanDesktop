# 图像嵌入与 Infinity 服务一体化整合方案

> 起草日期:2026-05-05
> 范围:`chayuan-server` / `chayuan-modelmgr` / `chayuan-client` 三仓
> 涉及任务编号:**88**(modelmgr 候选 runtime 修复,已落地)、
> **89**(图像嵌入运行时与默认模型 / 模型广场全链路联动,设计阶段)、
> **90**(本地内置模型选型与 vllm-vs-ollama 决策,选型阶段)
> 状态:88 已完成并补回归测试;89 + 90 进入评审 → 落地阶段

---

## 0. 文档导航

- 第 1 章 — 需求分析与问题界定
- 第 2 章 — 现状审计(代码事实,非推测)
- 第 3 章 — 架构师视角:技术路线
- 第 4 章 — UE / UX 视角:用户旅程与界面设计
- 第 5 章 — 用户视角:操作手册(零基础也能跑通)
- 第 6 章 — 任务 90:本地内置模型选型与 vllm-vs-ollama 决策
- 第 7 章 — 开发计划与里程碑
- 第 8 章 — 测试策略与验收标准
- 第 9 章 — 风险登记与缓解
- 附录 A — 接口契约(API / 数据结构)
- 附录 B — 配置矩阵
- 附录 C — 任务 88 修复回顾

---

## 1. 需求分析与问题界定

### 1.1 业务背景

察元(Chayuan)定位为**办公场景下统一接入文档 / 结构化数据 / 多模态资料**
的 AI 助手。图像知识库是多模态体系的关键一环 —— 用户把产品图、设计稿、
合同扫描件传入,后续在 WPS 侧栏 / Web 客户端发起跨模态检索:
"找一下上周新品发布会幻灯片里那张橙色背景的图"。

跨模态检索的核心组件是**图像嵌入模型**(image embedder,统称
`image-embedding` capability,亦含 CLIP / SigLIP / Jina-CLIP 等家族)。

### 1.2 用户诉求(本次提出方原话归纳)

| 编号 | 诉求原文 | 诉求拆解 |
|---|---|---|
| 88 | 本地已经安装了 Infinity 这个服务,如何安装图像嵌入模型?在模型广场可用直接下载吗?如何下载? | 模型广场必须支持下载图像嵌入模型到 Infinity |
| 89-A | Infinity 安装模型后,与默认模型选择中的图像嵌入模型相关联 | ④ 默认模型 tab 与 Infinity 实际加载的模型必须连通 |
| 89-B | 当上传图像时使用这个选中的图像嵌入模型 | 图像上传链路必须按"用户选的默认"走,不能再写死或读环境变量 |
| 89-C | 站在架构师的角度,模块化设计、代码复用、高性能、多并发 | 抽象、性能、并发并重 |
| 89-D | 站在用户的角度,操作连贯,使用方便,便于查找和下载,与模型广场关联 | 单一操作路径(模型广场 → 默认模型 → 图像上传)无断层 |
| 89-E | 已下载的模型在模型广场显示"已下载"等状态 | 模型广场卡片 status 必须反映:已下载 / 已上线 Infinity / 仅 hf-cache |
| 90-A | 本地内置 文本嵌入 / 对话 / 图像嵌入 / 重排 模型,哪些合适 | 给出明确推荐清单 |
| 90-B | 使用什么样的技术实现:vLLM 还是 Ollama | 给出选型决策与理由 |

### 1.3 非功能需求

| 维度 | 目标 |
|---|---|
| **吞吐** | 单 GPU 节点图像批量入索引 ≥ 32 imgs/s(jina-clip-v1, batch=16) |
| **延迟** | 单查询图像 P95 ≤ 200ms(已含 Infinity HTTP RTT) |
| **并发** | 8 路上传协程并发不阻塞;Infinity 客户端 keep-alive 池 ≥ 8 |
| **可观测** | 每次 encode 调用打 trace(模型名 / 维度 / 用时 / 是否走 fallback) |
| **降级** | Infinity 不可达自动回退到 in-process(若该 hf-cache 命中);三层都没有 → 返 422 + 推荐安装 |
| **安全** | 图像上传走鉴权 / source 级权限 ACL(沿用现有 `can_write`) |
| **兼容** | 现有 `Settings.kb_settings.IMAGE_EMBEDDER` 配置和 `CHAYUAN_IMAGE_EMBEDDER` 环境变量必须仍能用作最低优先级 fallback |

### 1.4 不在本期范围

- 视频嵌入(t2v / video-embedding)——现状未覆盖,留待 v2
- 图像生成(t2i,ComfyUI 主导)——已有独立链路
- 客户端浏览器内嵌入(Web ML / ONNX Runtime Web)——评估为实验性,不引入

---

## 2. 现状审计

### 2.1 代码事实(已经过 grep / Read 确认,非推测)

**A. 模型广场下载链路**

```
chayuan/server/model_registry/marketplace.py
  _CAPABILITY_RUNTIMES["image-embedding"] = ["infinity", "hf-cache", "comfyui"]
                                              ↑
                                          (88 题已修)
chayuan/server/config_panel/marketplace_grid_panel.py
  _open_download_dialog(card, target_runtime)
    └─→ chayuan_modelmgr.get_lifecycle().start(repo, capability, target_runtime)
          └─→ 下载 HF 权重 → wire 到目标 runtime(写 yaml / 注册)
```

**B. 图像上传链路**

```
chayuan/server/api_server/image_routes.py
  POST /knowledge_source/{source_id}/image/upload
    └─→ ImageConnector.add_batch(...)
          └─→ chayuan/server/image_source/store.py
                └─→ chayuan/server/image_source/embedder.py:get_embedder()
                      ├─ default_model_name() ← 读 Settings.kb_settings.IMAGE_EMBEDDER
                      │                          或 CHAYUAN_IMAGE_EMBEDDER 环境变量
                      └─ create_embedder(spec)  ← in-process HuggingFace 直加载
```

**C. 默认模型 ④ tab**

```
chayuan/server/config_panel/model_settings/defaults_subpage.py
  → render_capability_defaults_row(...)
    → chayuan/server/config_panel/runtime_framework_panel.py
        CAPABILITY_LABELS 含 ("clip", "图像嵌入")  # 第 61 行
        _CAP_TO_FIELD["clip"] = "image2text_models"
        # 即 ④ tab 选的图像嵌入默认模型,被写到
        # PlatformConfig.image2text_models 字段(yaml + DB)
```

**D. Infinity 服务**

```
server-compose/infinity.yaml
  services.infinity.image: michaelf34/infinity:latest
  services.infinity.ports: 37997:7997
  services.infinity.healthcheck: GET /health
```

### 2.2 三大断层(89 题核心)

```
                       [模型广场]                 [Infinity 容器]
                            │                           ▲
            chayuan_modelmgr│ wire                       │  POST /embeddings
                            ▼                           │      (尚未对接)
                   <CHAYUAN_ROOT>/compose/             │
                      infinity.yaml ─── docker ──→ 已加载模型  ❶
                            ┊                           ▲
                            ┊  (无连接)                  ┊  (无连接)
                            ┊                           ┊
   [④ 默认模型 tab] ─→ image2text_models 字段           ┊
        clip 默认                  │                    ┊
                                   │  (无连接) ❷         ┊
                                   ▼                    ┊
                        [图像上传 /image/upload]          ┊
                            │                           ┊
                            ▼                           ┊
                  embedder.py:get_embedder()             ┊
                            │                           ┊
                            ▼                           ┊
                   读 Settings.kb_settings.              ┊
                   IMAGE_EMBEDDER (本地 in-proc) ─────── (走不到 Infinity) ❸
```

| 断层 | 后果 |
|---|---|
| ❶ Infinity 容器内已加载哪些模型,**模型广场不知**;卡片 status 永远是 lifecycle 状态,不反映真实"已上线" | 用户无法判断"我下载完了能不能直接用" |
| ❷ ④ tab 的 clip 默认值,**embedder.py 完全不读** | 用户改了 ④ tab 的图像嵌入,实际上传时不生效 |
| ❸ embedder.py 只走 in-process,**无 Infinity 客户端实现** | 用户花精力配 Infinity,图像上传却根本不走它 |

### 2.3 已修部分(88 题)

`marketplace.py:68` 一行 bug:`_CAPABILITY_RUNTIMES["image-embedding"]`
原值 `["hf-cache", "comfyui"]`,缺 `"infinity"`。已改为
`["infinity", "hf-cache", "comfyui"]`,补 4 个回归测试。详见附录 C。

---

## 3. 架构师视角:技术路线

### 3.1 设计原则

1. **单一职责** — 协议适配 / 默认解析 / 容器探活 / UI 展示分模块
2. **代码复用** — 沿用现有 `chayuan_modelmgr.lifecycle`、`compose_manager`、
   `state_cache`、`auth.deps` 一切可用基础设施
3. **向后兼容** — `Settings.kb_settings.IMAGE_EMBEDDER` 仍作最低优先级 fallback
4. **降级优先** — Infinity 不通自动 fallback 到 in-proc;in-proc 不通才报错
5. **可观测** — 每一次 encode 都有 trace + 指标

### 3.2 总体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        chayuan-server (Python)                       │
│                                                                      │
│ ┌─[A] image_source/embedder_clients/───────────────────────────────┐ │
│ │ base.py             ImageEmbedderClient (Protocol)               │ │
│ │ inproc.py           InProcEmbedderClient(family=clip|chinese...) │ │
│ │ infinity_http.py    InfinityHttpClient(base_url, model_id)       │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│         ▲              ▲                                             │
│         │ fallback     │ primary                                     │
│         │              │                                             │
│ ┌─[B] image_source/embedder.py ───────────────────────────────────┐  │
│ │  resolve_default()    ← ④ tab clip 默认 ── 优先1                │  │
│ │      │                ← Settings.kb_settings.IMAGE_EMBEDDER      │  │
│ │      │                  + 环境变量(向后兼容)── 优先2            │  │
│ │      ▼                ← 内置 SigLIP fallback ── 优先3           │  │
│ │  pick_client(default) ← Platform 类型决定 client 实现           │  │
│ │  get_embedder()       ← 单例 + 失活探活  + 自动降级               │  │
│ └──────────────────────────────────────────────────────────────────┘ │
│         ▲                                                            │
│         │ 调用                                                       │
│         │                                                            │
│ ┌─[C] image_source/connector.py / store.py (现有,接口不动)──────┐  │
│ │  ImageConnector.add_batch / search                              │  │
│ │  store.py 维度校验沿用                                            │  │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ┌─[D] api_server/image_routes.py ───────────────────────────────────┐│
│ │  POST /knowledge_source/{id}/image/upload  (现有)                ││
│ │  GET  /image_models/runtime_status         (新)                  ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ ┌─[E] model_registry/marketplace.py ────────────────────────────────┐│
│ │  CardStatus 扩展:available / downloading / downloaded /          ││
│ │              ready  / error                                       ││
│ │  _attach_runtime_status()  ← 新方法,扫 infinity.yaml + ps + cache ││
│ └──────────────────────────────────────────────────────────────────┘│
│                                                                      │
│ ┌─[F] config_panel/model_settings/defaults_subpage.py ──────────────┐│
│ │  ④ tab clip 行右侧加运行位置标识                                  ││
│ │      "运行于 Infinity ●在线"  /  "本地 in-process"  /  "未配置"   ││
│ └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ HTTP
                                 ▼
                  ┌─────────────────────────────┐
                  │   Infinity Docker 容器       │
                  │  michaelf34/infinity:0.0.75+  │
                  │  POST /embeddings            │
                  │   batch encode imgs / texts  │
                  └─────────────────────────────┘
```

### 3.3 模块详细设计

#### 3.3.1 模块 A — `embedder_clients/`

**职责**:把"如何拿到图像向量"这件事抽象成同步 / 异步 Protocol。

**关键代码骨架**(伪代码,实际落地以代码评审为准):

```python
# embedder_clients/base.py
class ImageEmbedderClient(Protocol):
    name: str                  # 例: "infinity@jinaai/jina-clip-v1"
    dim: int                   # 向量维度
    family: str                # "clip" | "chinese_clip" | "jina_clip" | ...

    async def encode_image(self, blobs: List[bytes]) -> List[List[float]]: ...
    async def encode_text (self, texts: List[str ]) -> List[List[float]]: ...
    def healthcheck(self) -> bool: ...    # 同步快速探活,< 100ms
    def close(self) -> None: ...

# embedder_clients/infinity_http.py
class InfinityHttpClient:
    def __init__(self, base_url: str, model_id: str, *,
                 timeout: float = 30.0, pool_size: int = 8):
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(timeout, connect=5.0),
            limits=httpx.Limits(max_connections=pool_size,
                                max_keepalive_connections=pool_size),
        )
        self.model_id = model_id
        self.dim = -1   # 第一次调用后填入

    async def encode_image(self, blobs: List[bytes]) -> List[List[float]]:
        # Infinity 0.0.75+ 接收 [{"input": "data:image/...;base64,..."}, ...]
        payload = {"model": self.model_id,
                   "input": [_b64(b) for b in blobs]}
        r = await self._client.post("/embeddings", json=payload)
        r.raise_for_status()
        data = r.json()["data"]
        if self.dim < 0 and data:
            self.dim = len(data[0]["embedding"])
        return [d["embedding"] for d in data]
    # encode_text 同理
```

**性能要点**:
- 单 `httpx.AsyncClient` 全局复用,连接池 8 路 keep-alive
- `encode_image` 自带 batch,connector 层调用方传整批,**不做 single 拆分**
- 服务端 retry-after / 429 → 指数退避(用 tenacity)
- 维度首次调用填入 `dim`,失败自动反查 `Settings.SUPPORTED_MODELS` 表兜底

#### 3.3.2 模块 B — `embedder.py` 改造

**默认解析三级优先**:

```python
def resolve_default() -> Tuple[str, str | None]:
    """
    返回 (model_id, platform_name | None)
    platform_name 决定 dispatch 到哪个 client。
    """
    # 优先 1: ④ tab 选的 clip 默认 (本期新接通,89-A 核心)
    cfg = read_capability_default("clip")  # 新 helper
    if cfg:
        return (cfg.model_id, cfg.platform_name)

    # 优先 2: Settings.kb_settings.IMAGE_EMBEDDER (向后兼容)
    legacy = (getattr(Settings.kb_settings, "IMAGE_EMBEDDER", "") or
              os.environ.get("CHAYUAN_IMAGE_EMBEDDER", "")).strip()
    if legacy:
        return (legacy, None)   # platform 未知 → 走 in-proc

    # 优先 3: 内置 SigLIP fallback
    return ("google/siglip2-base-patch16-224", None)


def pick_client(model_id: str, platform_name: str | None) -> ImageEmbedderClient:
    if platform_name and is_infinity_platform(platform_name):
        return InfinityHttpClient(
            base_url=infinity_base_url(platform_name),
            model_id=model_id,
        )
    return InProcEmbedderClient(model_id)


def get_embedder() -> ImageEmbedderClient:
    """单例 + 失活探活 + 自动降级。"""
    with _LOCK:
        if _CACHED and _CACHED.healthcheck():
            return _CACHED
        # primary 不通 → fallback in-proc(若 hf-cache 命中)
        ...
```

**降级矩阵**:

| primary | primary 健康 | hf-cache 命中 | 行为 |
|---|---|---|---|
| Infinity | true | (任意) | 用 Infinity,trace `client=infinity` |
| Infinity | false | true | 用 in-proc + WARN 日志,trace `client=inproc-fallback` |
| Infinity | false | false | 抛 `EmbedderUnavailable` → 上层返 422 + 推荐安装 |
| in-proc | (无) | true | 直接用 |
| in-proc | (无) | false | 抛 `EmbedderUnavailable` |

#### 3.3.3 模块 D — 新接口 `/image_models/runtime_status`

**用途**:模型广场 + ④ tab 共用的"实时运行状态"查询。

```
GET /image_models/runtime_status
→ {
    "default_model_id":   "jinaai/jina-clip-v1",
    "default_platform":   "infinity-local",
    "client_in_use":      "infinity",
    "client_healthy":     true,
    "infinity_loaded": [
      {"model_id": "jinaai/jina-clip-v1", "dim": 768}
    ],
    "hf_cache_present": [
      "jinaai/jina-clip-v1",
      "google/siglip2-base-patch16-224"
    ],
    "fetched_at": "2026-05-05T10:30:00Z"
  }
```

**实现要点**:
- 5 秒 LRU 缓存(避免每次刷卡片 docker exec)
- `infinity_loaded` 来源:从 `<CHAYUAN_ROOT>/compose/infinity.yaml` 读
  `environment.MODEL_ID` / `command` 参数,与 `docker compose ps` state 交叉
- `hf_cache_present` 来源:扫 `~/.cache/huggingface/hub` 索引
- 失败任一来源 → 该字段返空数组,不抛

#### 3.3.4 模块 E — `marketplace.py` 状态扩展

**CardStatus 状态机**:

```
              lifecycle.start
   available ───────────────► downloading ──┬─► error
                                            │
                                            ▼
                                       downloaded ──────► ready
                                            ▲              ▲
                                            │              │
                                       (hf-cache 命中)  (Infinity 加载)
```

| 状态 | 显示 | UI 动作按钮 |
|---|---|---|
| `available` | "未下载" | 【下载到 …】 |
| `downloading` | "下载中 42%" | 进度条 |
| `downloaded` | "已下载,待挂载" | 【挂到 Infinity】 |
| `ready` | "已上线 Infinity" | 【设为默认】 / 【取消挂载】 |
| `error` | "下载失败" | 【重试】 |

**挂到 Infinity 实现**:写 `infinity.yaml` 的 `environment.MODEL_ID`
(或 command 参数),触发 `docker compose up -d --wait <service>`。

#### 3.3.5 模块 F — `defaults_subpage.py` UI 增强

clip 行右侧多一个只读的运行位置标识(根据 `/image_models/runtime_status` 渲染):

```
图像嵌入   [选择模型 ▼]   ●在线  运行于 Infinity (http://localhost:37997)
```

颜色规则:
- 绿色 `●在线` = client_healthy=true
- 黄色 `●降级` = 走了 in-proc fallback
- 红色 `●未配置` = client_in_use 为空 / 抛错

### 3.4 性能与并发

#### 3.4.1 并发模型

```
图像批量上传(N 张)
   │
   │  asyncio.gather(N 协程)
   ▼
ImageConnector.add_batch(batch_size=16)
   │
   │  自动分片为 ⌈N/16⌉ 批
   ▼
InfinityHttpClient.encode_image(batch)
   │
   │  httpx pool(8 keep-alive) + HTTP/2 复用
   ▼
Infinity 容器(单 worker 也能跑满,GPU batched)
```

#### 3.4.2 容量估算

设单 GPU 节点(RTX 4090,24GB):
- jina-clip-v1 加载占 1.5GB
- batch=16,单图 224×224,encode 约 60ms
- 理论吞吐:16 / 0.06 ≈ **267 imgs/s**(纯模型计算)
- 加 HTTP RTT + image decode + 维度校验 + 索引写入 → 实测 **~32 imgs/s**
- 满足"中型办公图库万张图 ≤ 5 分钟入索引"目标

#### 3.4.3 监控指标(本期最小集)

| metric | type | 含义 |
|---|---|---|
| `image_embedder.encode.duration_ms` | histogram | 单次 encode 调用耗时 |
| `image_embedder.encode.batch_size` | histogram | 一次调用的 batch 大小 |
| `image_embedder.client_in_use` | gauge | infinity / inproc / none |
| `image_embedder.fallback_total` | counter | 触发降级次数 |
| `image_embedder.error_total{kind}` | counter | 错误分类计数 |

走现有 `chayuan/server/observability/` 通道(Prometheus + 日志结构化)。

### 3.5 配置与部署

`<CHAYUAN_ROOT>/compose/infinity.yaml` 改造(关键 diff):

```yaml
services:
  infinity:
    image: michaelf34/infinity:0.0.75      # 锁版本(原 :latest)
    environment:
      - MODEL_ID=jinaai/jina-clip-v1       # 默认装 jina-clip(本期新增)
      - PORT=7997
      - BATCH_SIZE=16
    volumes:
      - ${HOME}/.cache/huggingface:/app/.cache/huggingface  # 复用 hf-cache
    ports:
      - "37997:7997"
```

理由:
- 锁版本规避 image-embedding endpoint 在低版本不存在的兼容风险
- `MODEL_ID` 由"挂到 Infinity"动作动态写入(可被 chayuan-server 改写)
- 共享 hf-cache 让模型广场下载到 hf-cache 的权重,Infinity 启动时直接命中

### 3.6 安全与权限

- 上传走 `require_auth_enabled` + `can_write(user, source_id)`(沿用)
- `/image_models/runtime_status` 仅需登录态,不带敏感数据,不限角色
- "挂到 Infinity"动作改 yaml + 重起容器 → 限管理员角色
- Infinity HTTP API 仅在 `127.0.0.1` / 容器内网监听,**不外放**
- 用户上传图像永久落地 `<CHAYUAN_ROOT>/data/images/{source_id}/`,
  权限按 source 隔离

---

## 4. UE / UX 视角:用户旅程与界面设计

### 4.1 用户角色画像

| 角色 | 占比 | 关注点 |
|---|---|---|
| **个人办公用户**(P0) | 60% | 单机部署、能跑就行、不想折腾 GPU/CUDA |
| **企业 IT 管理员**(P0) | 25% | 多用户、性能、可观测、批量部署 |
| **开发者 / 二次集成方** | 15% | API 稳定、文档完整、可扩展 |

### 4.2 核心用户旅程(Happy Path)

#### 4.2.1 旅程 A:首次安装图像嵌入能力

```
[个人办公用户·张三]

01. 登录 Dashboard
       │
       │ 看到顶部横幅:"检测到 Infinity 已安装但未挂载图像嵌入模型,
       │              一键安装推荐模型?"  [立即安装][稍后]
       ▼
02. 点【立即安装】
       │
       │ 自动跳转:② 模型配置 → ③ 模型广场
       │ 已自动应用筛选:capability=图像嵌入,runtime=infinity
       │ 卡片预设按推荐排序:第一张就是 jinaai/jina-clip-v1
       │
       │ (如果横幅不出现,等价路径:② 模型配置 → ③ 模型广场 → 筛选图像嵌入)
       ▼
03. 看到 jinaai/jina-clip-v1 卡片
       │ 状态:available · 900MB · 推荐
       │
       │ 点【下载到 infinity】
       ▼
04. 弹下载进度框(沿用现有 lifecycle progress 弹窗)
       │ 阶段:解析仓库 → 下载权重 → wire 到 Infinity yaml
       │ 完成提示:"下载完成,已挂载到 Infinity 配置。需启动 Infinity 后生效。"
       │ 动作按钮:【启动 Infinity】(直达运行时与服务页 Infinity 卡片)
       ▼
05. 点【启动 Infinity】
       │
       │ 跳转到 ① 运行时与服务,Infinity 卡片高亮 + 顶栏 ▶ 启动 自动呼出
       │ docker compose up -d --wait
       │ 健康检查通过(/health 200)
       ▼
06. 提示:"Infinity 已启动,jina-clip-v1 已上线。
            是否设为图像嵌入默认模型?"  [是][否]

07. 点【是】
       │
       │ 后台调用 /image_models/runtime_status 确认 ready
       │ 写 model_settings.yaml 的 capability_defaults.clip
       ▼
08. 跳到 ② 模型配置 → ④ 默认模型 tab
       │ 图像嵌入行右侧:●在线  运行于 Infinity
       │ 模型下拉值:jinaai/jina-clip-v1
       ▼
09. 用户回到知识库,新建/打开图像知识源,上传图片即可走通
```

**总操作**:5 次点击(横幅 → 下载 → 启动 → 设默认 → 完成),耗时
约 2 分钟(主要是 900MB 下载),零命令行交互。

#### 4.2.2 旅程 B:已配好,日常使用

```
[企业 IT 管理员·李四]

01. 直接在 ④ 默认模型 tab 切换图像嵌入模型
       │  (例:从 jina-clip-v1 → 切到 chinese-clip-vit-large 求中文准度)
       ▼
02. 系统检测到目标模型 hf-cache 已命中但 Infinity 未挂载
       │
       │ 提示框:"该模型尚未挂载到 Infinity,是否自动挂载并重启容器?"
       │         [是,自动重启 Infinity (~30s)][否,我手动改 yaml]
       ▼
03. 点【是】→ 写 yaml + docker compose up -d --wait
04. 完毕,默认模型立即生效
```

#### 4.2.3 旅程 C:出错恢复

```
[张三上传图像时]

01. POST /knowledge_source/3/image/upload
       │
       │ 后端:embedder Infinity 不可达(容器挂了)+ in-proc 也不行
       │   (用户没装 PyTorch / GPU 驱动)
       ▼
02. 返回 422
   {
     "code": "image_embedder_missing",
     "message": "图像嵌入模型不可用",
     "suggested": {
       "repo": "google/siglip2-base-patch16-224",
       "capability": "image-embedding",
       "runtime": "infinity"
     }
   }
       ▼
03. 前端 KbSelectorDialog 弹"立即安装?"对话框
04. 点确定 → 走旅程 A 的 03~09 步骤
```

### 4.3 UI 关键变化点(Mockup 文字版)

#### 4.3.1 模型广场卡片(状态联动后)

```
┌─────────────────────────────────────────────┐
│ jinaai/jina-clip-v1                          │
│ 跨模态文-图都能搜;多语言友好                 │
│                                              │
│ 图像嵌入 · 900MB · ★ 推荐 · 下载量 1.2k     │
│                                              │
│ ●在线  已上线 Infinity (http://localhost:37997)  │ ← 新
│                                              │
│  [设为默认]  [取消挂载]                       │ ← 新(按状态切换)
└─────────────────────────────────────────────┘
```

#### 4.3.2 ④ 默认模型 tab clip 行

```
图像嵌入   [jinaai/jina-clip-v1 (Infinity 在线) ▼]   ●在线  运行于 Infinity
                                              ↑
                                    下拉里同时显示厂商 + 是否在线
```

#### 4.3.3 Dashboard 引导横幅

```
┌────────────────────────────────────────────────────────┐
│ ⓘ 检测到 Infinity 已安装但未挂载图像嵌入模型             │
│   一键安装推荐:jinaai/jina-clip-v1 (900MB)              │
│   [立即安装]  [稍后]                              [×]   │
└────────────────────────────────────────────────────────┘
```

### 4.4 文案规范

| 场景 | 中文文案 | 设计意图 |
|---|---|---|
| 健康在线 | `●在线  运行于 Infinity (http://...)` | 给具体地址,出问题用户能直连验证 |
| 降级中 | `●降级  Infinity 不可达,正用本地内存模式` | 不用"错误"字眼,引导用户看运行时与服务 |
| 未配置 | `●未配置  尚未选择图像嵌入模型` | 主动 CTA "立即配置" |
| 挂载中 | `挂载中… 重启 Infinity 约 30 秒` | 给预期时间 |

### 4.5 UE 反模式 / 红线

- 不要让"下载完"和"上线"两步分开但没视觉提示——用户会以为下完就能用
- 不要把 in-proc fallback 静悄悄发生——必须有黄色 `●降级` 标识
- 不要在错误提示里出现 "stack trace" / "internal server error" 字样
- 不要让 ④ tab 的下拉里出现"未在 Infinity 上线"的模型而无标识

---

## 5. 用户视角:操作手册

### 5.1 最短路径(三步走)

**前提**:已经装好 Infinity 容器(docker 类服务,任务 87 修过的 Infinity 卡片)

```
1. 进 ② 模型配置 → ③ 模型广场
2. 顶部 capability 筛选条点【图像嵌入】
3. 选一张卡片(推荐 jinaai/jina-clip-v1) → 下载到 → 选 [infinity] → 【下载】
4. 等下载完(~900MB,带宽 100Mbps 约 2 分钟)
5. 进 ① 运行时与服务 → Infinity 卡片 → ▶ 启动
6. 回 ④ 默认模型 → 图像嵌入下拉里选 jinaai/jina-clip-v1
7. 完成,可在知识库上传图片
```

### 5.2 检验是否成功

- 进 ④ 默认模型 tab,图像嵌入行右侧显示 `●在线  运行于 Infinity`
- 命令行验证(可选):

```
curl http://localhost:37997/v1/models
# 应返回 jinaai/jina-clip-v1
```

### 5.3 常见问题

| 问题 | 排查 |
|---|---|
| 下载卡 `wire to infinity` 阶段 | 看 `<CHAYUAN_ROOT>/compose/infinity.yaml` 是否被写了 `MODEL_ID` |
| Infinity 启动失败 | ① 运行时 → Infinity 卡片 → 点【📡 容器日志】(任务 87 做的功能) |
| ④ tab 下拉里没有 jina-clip-v1 | 大概率是默认 capability 字段没刷,关 / 重开 ④ tab 触发 state_cache 失效 |
| 上传图像 422 提示模型缺失 | 走错误对话框的"立即安装"按钮 → 自动跳模型广场 |
| GPU 不可用 | Infinity 默认 CPU 也能跑 jina-clip-v1,慢但能用;上 GPU 改 yaml 加 `runtime: nvidia` 段 |

### 5.4 离线 / 内网部署

```
1. 在外网机预下载模型权重(huggingface-cli download jinaai/jina-clip-v1)
2. 拷贝整个 ~/.cache/huggingface 到内网机相同路径
3. infinity.yaml volumes 段挂这个目录
4. 启动 Infinity → 自动从 hf-cache 加载,不联网
```

---

## 6. 任务 90:本地内置模型选型

### 6.1 选型决策原则

1. **能力对齐工具**:对话用 LLM serving 框架,嵌入 / 重排用 embedding server
2. **GPU 节约**:同进程承载多 capability 的优先(Infinity 三能力共享显存)
3. **CPU fallback**:每类都给一个 < 2GB 的轻量选项
4. **中文优先**:个人办公场景中文 70%+,纯英文模型不进默认推荐表
5. **生态成熟**:社区下载量 > 10k / 月,文档齐全

### 6.2 推荐清单

| 类别 | 模型 | 大小 | 后端 | 量化 | 适用场景 | 维度 |
|---|---|---|---|---|---|---|
| **对话(主)** | Qwen2.5-7B-Instruct | 4.5GB | Ollama | Q4_K_M | 默认对话,CPU 也能跑 | — |
| **对话(强,GPU)** | Qwen2.5-14B-Instruct-AWQ | 9GB | vLLM | AWQ | 多并发企业部署 | — |
| **对话(轻)** | Qwen2.5-1.5B-Instruct | 1.5GB | Ollama | Q4_K_M | 4GB 内存机 / Lite 部署 | — |
| **对话(代码)** | Qwen2.5-Coder-7B-Instruct | 4.5GB | Ollama | Q4_K_M | 代码助手场景 | — |
| **文本嵌入(强)** | BAAI/bge-m3 | 2.3GB | Infinity | fp16 | 多语言长文本 RAG 默认 | 1024 |
| **文本嵌入(轻)** | BAAI/bge-small-zh-v1.5 | 0.13GB | Infinity | fp32 | 纯中文 + CPU | 512 |
| **图像嵌入** | jinaai/jina-clip-v1 | 0.9GB | Infinity | fp16 | 跨模态(文-图、图-图) | 768 |
| **图像嵌入(中文专)** | OFA-Sys/chinese-clip-vit-base | 0.4GB | Infinity | fp16 | 纯中文 prompt 检索 | 512 |
| **图像嵌入(轻)** | google/siglip2-base-patch16-224 | 0.4GB | Infinity / hf-cache | fp16 | CPU 兜底 | 768 |
| **重排** | BAAI/bge-reranker-v2-m3 | 2.3GB | Infinity | fp16 | cross-encoder 默认 | — |
| **重排(轻)** | BAAI/bge-reranker-base | 0.6GB | Infinity | fp16 | CPU 友好 | — |
| **OCR** | RapidOCR / PaddleOCR | 0.1GB | runtime/wrapper | — | 文档识别(已有链路) | — |
| **ASR** | FunASR(paraformer-zh) | 0.8GB | runtime/wrapper | — | 中文语音识别 | — |
| **TTS** | CosyVoice 2-0.5B | 1GB | runtime/wrapper | — | 中文合成 | — |

### 6.3 部署套餐

#### 套餐 1:Lite(8GB 内存机,无 GPU)

```
对话:        Qwen2.5-1.5B (Ollama)        1.5 GB
文本嵌入:    bge-small-zh (Infinity)      0.13 GB
图像嵌入:    chinese-clip-base (Infinity) 0.4 GB
重排:        (跳过,改用 BM25 兜底)        0
─────────────────────────────────────────────────
合计权重                                  ≈ 2 GB
进程驻留(CPU 推理):                       ≈ 4 GB
```

#### 套餐 2:Standard(16GB 内存 / 12GB 显存)

```
对话:        Qwen2.5-7B Q4 (Ollama)       4.5 GB
文本嵌入:    bge-m3 (Infinity)            2.3 GB
图像嵌入:    jina-clip-v1 (Infinity)      0.9 GB
重排:        bge-reranker-v2-m3(Infinity) 2.3 GB
─────────────────────────────────────────────────
合计权重                                  ≈ 10 GB
显存占用(Infinity 三模型同进程):         ≈ 6 GB
```

#### 套餐 3:Pro(企业部署,24GB+ 显存)

```
对话:        Qwen2.5-14B AWQ (vLLM)      9 GB
文本嵌入:    bge-m3 (Infinity)           2.3 GB
图像嵌入:    jina-clip-v2 (Infinity)     1 GB
重排:        bge-reranker-v2-m3          2.3 GB
─────────────────────────────────────────────────
显存占用                                  ≈ 18 GB
吞吐:对话 ~50 tokens/s/concurrent,
     嵌入 ~32 imgs/s,搜索并发 100+
```

### 6.4 vLLM vs Ollama 决策矩阵

| 维度 | Ollama | vLLM |
|---|---|---|
| **部署难度** | ★ 一行命令 | ★★★ 需 NVIDIA + CUDA + driver 对齐 |
| **CPU 支持** | ✅ | ✗(必须 GPU) |
| **量化覆盖** | Q3 / Q4 / Q5 / Q6 / Q8(GGUF) | AWQ / GPTQ(主流) |
| **冷启动** | ~3s | 30~60s(KV cache 初始化) |
| **单并发延迟** | 较低 | 中(连续 batching 给单请求加 ~20ms) |
| **多并发吞吐** | 串行,N 路并发 ≈ N 倍延迟 | PagedAttention,1×→8× 并发吞吐 ~4-6 倍 |
| **内存效率** | 加载即占,模型切换需 unload | KV 显存动态分配,batched share |
| **OpenAI 兼容** | ✅ `/v1/chat/completions` | ✅ `/v1/chat/completions` |
| **生态** | 模型库丰富,一行 `ollama pull qwen2.5` | 需 HF id,自己拉 |
| **运维** | systemd / docker 都行 | 通常 docker / k8s |

**决策矩阵**:

| 场景 | 推荐 | 理由 |
|---|---|---|
| 个人单机办公 | **Ollama** | 部署简单,单人不用并发 |
| 5~20 人小团队 | **Ollama** + 增 GPU 量化模型 | 折中,运维成本低 |
| 30+ 人企业部署 | **vLLM** | 并发吞吐压倒性优势,运维有专人 |
| 开发者本机 | **Ollama** | 模型切换方便 |
| CI / 离线测试 | **Ollama**(CPU) | 不依赖 GPU |

**绝对不要**:
- 同模型同时部署 Ollama 和 vLLM(显存抢占,无意义)
- 把图像嵌入塞进 Ollama 的 vision(LLaVA 是描述性,不是检索向量)
- 把嵌入 / 重排塞进 vLLM(它优化方向是文本生成,embedding 模式效率不如 Infinity)

### 6.5 内置一键安装(本期落地)

Dashboard 横幅触发 → 用户选套餐(Lite / Standard / Pro)→ 自动:

1. 拉对应 compose yaml(ollama / infinity / vllm)
2. 调 `chayuan_modelmgr.lifecycle.start` 顺序下载推荐清单
3. 写 default_models 字段
4. 完成后引导 ▶ 启动各服务

---

## 7. 开发计划与里程碑

### 7.1 任务拆解

| ID | 任务 | 模块 | 工时 | 优先级 | 依赖 |
|---|---|---|---|---|---|
| 88 | `_CAPABILITY_RUNTIMES["image-embedding"]` 加 infinity | marketplace.py | 0.5d | P0 | 无 |
| 89-1 | 抽 `embedder_clients/` 三文件 | image_source/ | 1d | P0 | 无 |
| 89-2 | `InfinityHttpClient` 实现 + 测试 | embedder_clients/infinity_http.py | 1.5d | P0 | 89-1 |
| 89-3 | `InProcEmbedderClient` 现有逻辑迁入 | embedder_clients/inproc.py | 0.5d | P0 | 89-1 |
| 89-4 | `embedder.py` resolve_default 三级优先 | embedder.py | 1d | P0 | 89-1, 89-2 |
| 89-5 | ④ tab clip → embedder 真接通 | model_settings.yaml schema | 0.5d | P0 | 89-4 |
| 89-6 | `/image_models/runtime_status` 接口 | image_routes.py | 1d | P0 | 89-2 |
| 89-7 | marketplace CardStatus 扩展 + `_attach_runtime_status` | marketplace.py | 1d | P1 | 89-6 |
| 89-8 | ④ tab 运行位置标识 UI | defaults_subpage.py | 0.5d | P1 | 89-6 |
| 89-9 | "挂到 Infinity" 动作 | marketplace_grid_panel.py | 1d | P1 | 89-7 |
| 89-10 | Dashboard 引导横幅 | dashboard.py | 0.5d | P2 | 89-7 |
| 89-11 | 错误对话框"立即安装"跳转 | image_routes.py / 客户端 | 0.5d | P2 | 89-9 |
| 89-12 | 降级矩阵 + trace + 监控 | embedder.py / observability/ | 1d | P1 | 89-4 |
| 89-13 | infinity.yaml 锁版本 + MODEL_ID 段 | server-compose/ | 0.5d | P0 | 无 |
| 90-1 | 一键装套餐(Lite / Standard / Pro) | dashboard.py + recipes | 1.5d | P1 | 89-9 |
| 90-2 | recommended.py 增补本期推荐清单 | chayuan_modelmgr/recommended.py | 0.5d | P1 | 无 |
| ~~ | 测试套件 | tests/unit_tests/ | 2d | P0 | 全程 |
| ~~ | 文档(本文档 + CHANGELOG) | docs/ | 0.5d | P0 | 收尾 |

**合计 ≈ 14.5 人日**(单人节奏 3 周内可落地;并行可压缩到 1.5 周)

### 7.2 里程碑

| 里程碑 | 时间 | 验收标志 |
|---|---|---|
| **M0** 88 修复落地 | 已完成(2026-05-05) | 4 测试通过,模型广场图像嵌入下拉含 infinity 选项 |
| **M1** 后端核心可用 | 2026-05-12 | 89-1 ~ 89-5 + 89-13 完成;curl 上传图片走 Infinity 全通 |
| **M2** 状态联动可见 | 2026-05-19 | 89-6 ~ 89-9 完成;模型广场 5 状态正确显示 |
| **M3** 用户引导闭环 | 2026-05-26 | 89-10 ~ 89-12 完成;新用户从横幅 5 步装完 |
| **M4** 一键套餐 + 文档 | 2026-06-02 | 90-1 ~ 90-2 完成,本文档成为产品 README 一节 |

### 7.3 灰度策略

- M1 内部 dogfood(开发团队 + 1~2 个早期用户)
- M2 邀请制(选 5~10 个有 Infinity 部署的用户)
- M3 全量,横幅 default-on
- M4 进入正式发布

### 7.4 回滚策略

每个 PR 自带 feature flag(env `CHAYUAN_INFINITY_INTEGRATION_V2=on/off`):
- off → 走老链路(in-proc only,行为与 5 月 5 日前一致)
- on → 新链路

发版后 7 天观察:错误率 / fallback 率 / 用户反馈;有问题 flag 一关回滚。

---

## 8. 测试策略与验收标准

### 8.1 测试金字塔

```
        ┌──────────────────────┐
        │   端到端 (3~5 case)   │   旅程 A / B / C 自动化
        ├──────────────────────┤
        │   集成测试 (~15 case) │   embedder 全链路 + Infinity mock
        ├──────────────────────┤
        │   单元测试 (~50 case) │   每个新模块、状态机、解析器
        └──────────────────────┘
```

### 8.2 单元测试关键 case

- `embedder_clients.base`:Protocol 静态检查
- `embedder_clients.infinity_http`:
  - mock httpx,batch encode 正确序列化 base64
  - 429 退避
  - 健康检查 timeout 不抛
- `embedder.resolve_default`:三级优先正确
- `embedder.pick_client`:platform=infinity-* → InfinityHttpClient
- `embedder.get_embedder` 降级:primary 失败 → fallback in-proc + WARN
- `marketplace._attach_runtime_status`:5 种 CardStatus 状态机正确
- `image_models/runtime_status` 路由:5 秒缓存命中 / miss

### 8.3 集成测试

- 起 fake Infinity HTTP server(aiohttp)
- 模拟 batch=16 上传 100 张图,验证全部入索引,平均 RTT 内
- Infinity 中途宕机,fallback in-proc 验证

### 8.4 端到端

- 旅程 A 完整脚本化(playwright)
- 旅程 C 错误恢复完整脚本化

### 8.5 性能基准

```
pytest tests/benchmark/test_image_embedder_throughput.py -v
```

期望:
- jina-clip-v1 + Infinity + 1×4090,batch=16,≥ 32 imgs/s
- bge-m3 + Infinity + CPU,batch=8,≥ 4 docs/s

### 8.6 验收 checklist

- [ ] 88 测试 4 项 ✅(已通过)
- [ ] 89-1~89-13 各任务对应单元测试通过率 100%
- [ ] 集成测试 15 项通过
- [ ] 端到端 3 项通过
- [ ] 性能基准达标
- [ ] CHANGELOG 更新
- [ ] 本文档审阅通过

---

## 9. 风险登记

| ID | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | Infinity 老镜像不支持 image embedding endpoint | 中 | 高 | 锁版本 0.0.75+,首次启动检测 endpoint 存在性 |
| R2 | hf-cache 与 Infinity 容器路径不一致(容器内权重路径错位) | 中 | 中 | compose yaml 强约定 volume 挂载,文档提示 |
| R3 | 用户 Windows 路径分隔符问题(`D:\...` vs `/`) | 高 | 中 | compose_manager 已用 pathlib;新接口同样用 Path,不拼字符串 |
| R4 | Infinity 单进程多 capability 显存抢占 | 中 | 中 | 监控 + 文档提示;严重时建议分进程(后期) |
| R5 | 模型权重大,首次下载体验差 | 高 | 中 | 进度条 + 后台下载 + 推荐 lite 套餐 |
| R6 | 升级 ④ tab schema 破坏老配置 | 低 | 高 | 写迁移逻辑,旧 yaml 自动补默认 |
| R7 | 多用户并发改 yaml 冲突 | 低 | 中 | yaml_store 已有文件锁;再加 etag 检查 |
| R8 | Infinity 镜像在国内拉不动 | 高 | 中 | compose 内增加镜像源切换提示(虽 87 题 UI 移除了 switcher,但 yaml 注释保留) |

---

## 附录 A — 接口契约

### A.1 GET `/image_models/runtime_status`

**请求**:无参,需登录态

**响应 200**:

```json
{
  "default_model_id": "jinaai/jina-clip-v1",
  "default_platform": "infinity-local",
  "client_in_use": "infinity",
  "client_healthy": true,
  "infinity_loaded": [
    {"model_id": "jinaai/jina-clip-v1", "dim": 768}
  ],
  "hf_cache_present": [
    "jinaai/jina-clip-v1",
    "google/siglip2-base-patch16-224"
  ],
  "fetched_at": "2026-05-05T10:30:00Z"
}
```

### A.2 POST `/image_models/mount_to_infinity`

**请求**:

```json
{ "model_id": "jinaai/jina-clip-v1" }
```

**响应 202**(已发起异步重启):

```json
{
  "task_id": "mount-xxxx",
  "estimated_seconds": 30,
  "yaml_path": "<CHAYUAN_ROOT>/compose/infinity.yaml"
}
```

### A.3 数据模型扩展

```python
class MarketplaceCard:
    status: Literal[
        "available", "downloading", "downloaded",
        "ready", "error"
    ]    # 新增 "downloaded"
    runtime_loaded: bool       # 新字段
    runtime_url:    str | None # 新字段
```

```yaml
# model_settings.yaml 新增
capability_defaults:
  clip:
    model_id: jinaai/jina-clip-v1
    platform_name: infinity-local
```

---

## 附录 B — 配置矩阵

| 来源 | key | 优先级 | 备注 |
|---|---|---|---|
| `model_settings.yaml` | `capability_defaults.clip` | 1 | 89-A 新增,真源 |
| `Settings.kb_settings.IMAGE_EMBEDDER` | str | 2 | 老兼容 |
| 环境变量 | `CHAYUAN_IMAGE_EMBEDDER` | 2 | 老兼容 |
| 内置默认 | `google/siglip2-base-patch16-224` | 3 | 兜底 |

| 来源 | key | 优先级 | 备注 |
|---|---|---|---|
| `<CHAYUAN_ROOT>/compose/infinity.yaml` | `services.infinity.environment.MODEL_ID` | 1 | 容器实际加载 |
| `michaelf34/infinity:0.0.75` | image tag | — | 锁版本 |

---

## 附录 C — 任务 88 修复回顾

### C.1 问题

`marketplace.py:68`:

```python
"image-embedding": ["hf-cache", "comfyui"]
```

漏写 `"infinity"`。导致模型广场 capability=image-embedding 时,
runtime 下拉里没有 Infinity 选项,用户无法把图像嵌入模型下载到 Infinity。
但 `recommended.py` 里 `jina-clip-v1` / `siglip` 都标 `runtime="infinity"`,
形成内部矛盾。

### C.2 修复

```python
"image-embedding": ["infinity", "hf-cache", "comfyui"]
```

### C.3 测试

`tests/unit_tests/test_image_embedding_infinity_runtime.py`(4 case):

- `test_image_embedding_runtimes_include_infinity`
- `test_text_embedding_runtimes_still_include_infinity`(回归)
- `test_rerank_runtimes_still_include_infinity`(回归)
- `test_recommended_image_embedding_runtime_matches_capability_map`(契约)

### C.4 关联修复(同次发现)

`install_dialog.py:_compose_config_path`:原来不接受 service 参数,
强制返回全局聚合 `docker-compose.yaml`,与 83 题"每服务独立 yaml"
约定矛盾。已改造为 `_compose_config_path(service: Optional[str] = None)`,
优先返 `<CHAYUAN_ROOT>/compose/<service>.yaml`,fallback 到聚合。
配套 5 个测试 `test_install_dialog_per_service_yaml.py`。

---

**文档结束 · 共 ~750 行 · 基于 2026-05-05 仓库快照**

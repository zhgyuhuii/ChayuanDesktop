# 开放平台与自定义工具

本文档面向「把察元集成到自家系统」的开发者：

- **Outbound（察元 → 外部）**：自定义工具 —— 把你的 HTTP 接口包装成 Agent 工具，LLM 自动调用并把 JSON 结果喂回对话。
- **Inbound（外部 → 察元）**：App 注册 —— 外部系统拿 `app_id/secret` 调用 `/openapi/v1/*`；察元按事件签名回调你的 `callback_url`。

---

## 1. 自定义工具（Outbound）

把任意 HTTP 接口即刻变成一个 LangChain StructuredTool，LLM 根据 `description` 的提示词自动选用。

### 在面板里定义

⑧ 自定义工具 → 新建：

| 字段 | 含义 |
| :-- | :-- |
| `name` | 工具 ID，必须合法 Python 标识符，唯一 |
| `title` | 中文展示名，显示在对话界面工具下拉 |
| `description` | LLM 看到的工具说明（**提示词**）；写清楚「这工具做什么、什么时候该调用它」 |
| `method` | GET / POST / PUT / PATCH / DELETE |
| `url` | 接口 URL；支持 `{param_name}` 占位（会按参数值填充） |
| `params` | 参数列表：`name / type / description / required / default / enum` |
| `headers` | 每行 `Key: Value`（如 `Authorization: Bearer xxx`） |
| `body_template` | POST/PUT/PATCH 专用；支持 `{param}` 占位；不填则自动用所有未进入 URL 的参数作为 JSON body |
| `timeout` | 单次超时（秒） |
| `enabled` | 开关，关则运行时不注册到 `_TOOLS_REGISTRY` |

### 后端做了什么

1. 保存到 `CHAYUAN_ROOT/custom_tools.yaml`
2. `custom_tools_runtime.load_and_register()` 读取每条 enabled 的 spec，用 Pydantic `create_model` 动态生成 args 模型，再用 `StructuredTool.from_function` 合成工具，注入 `_TOOLS_REGISTRY`
3. 与手写 `@regist_tool` 工具完全对等：`/tools?enabled=true` 列得到，对话界面下拉选得到，`/tools/call` 也能调

### 测试接口

编辑弹窗有「测试接口」按钮：
- 自动拼样本参数（必填给占位；`default / enum[0]` 都能用上）
- 按 `http_test.run_request` 真实发一次请求
- 打印 HTTP 状态、延迟、`content-type`、响应体（JSON 会自动缩进展示，超长截断）

这套 HTTP 发包被复用在三处：自定义工具测试 / 内置 `http_request` 工具 / App 的回调投递。

### LangChain 1.x 自定义工具映射

察元的自定义工具最终产物等价于：

```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

class Args(BaseModel):
    city: str = Field(..., description="城市名称")

def _invoke(**kw):
    # 按 yaml 里 method/url/headers 真实发请求
    ...

tool = StructuredTool.from_function(
    func=_invoke,
    name="my_weather",
    description="查询指定城市的实时天气",
    args_schema=Args,
)
```

所以「察元自定义工具」= LangChain 官方「StructuredTool」 + 一层 yaml 驱动 UI。

---

## 2. App 开放平台（Inbound）

给外部系统签发签名凭据，让它们调用 `/openapi/v1/*`；同时支持事件回调把察元侧事件（如对话完成、KB 文档更新）推过去。

### 2.1 权限模型（scope = `resource:action`）

App 授权采用**二元组 scope**，可**任意组合**。以下是全集：

| 资源 | 可选动作 | 含义 |
| :-- | :-- | :-- |
| `chat` | `read / write / stream` | 读历史 / 发起对话 / 流式对话 |
| `kb` | `read / write / admin` | 搜索 / 上传文档 / 新建删除知识库 |
| `tools` | `read / call` | 列工具 / 调用工具 |
| `events` | `subscribe` | 打开 WebSocket 订阅事件（必需） |
| `admin` | `read / write` | 运维数据 / App 配置 |

**通配**：

- `kb:*` = `kb:read + kb:write + kb:admin`（一组内全开）
- `*` 或 `*:*` = 超管，覆盖全部 scope
- 单资源名 `chat`（无冒号，历史 yaml 兼容）自动等价 `chat:*`

**一个 App 授权给多个 scope**：直接写成列表，如

```yaml
scopes:
  - chat:*
  - kb:read
  - tools:call
  - events:subscribe
```

**事件订阅 → scope 映射**（用于 `/openapi/v1/ws` 与事件回调过滤）：

| 事件 | 所需 scope |
| :-- | :-- |
| `chat.started / chat.completed` | `chat:read` |
| `chat.streamed` | `chat:stream` |
| `kb.doc.created / kb.doc.updated / kb.doc.deleted` | `kb:read` |
| `tool.called` | `tools:read` |
| `app.created / app.updated / app.deleted` | `admin:read` |
| 未登记事件 | `admin:read`（deny-by-default） |

运行时也可用 `GET /openapi/v1/events` 查询这张表。

### 2.2 面板操作

⑪ App 管理 → 「创建应用」：

- 填 `name / callback_url / scopes / 订阅事件`
- 提交后自动生成 `app_id (32 hex)` + `app_secret (url-safe base64, ~64 字符)`
- **secret 只在此弹窗明文展示一次**；面板再进就是脱敏，必须立即复制存好
- 「轮换 secret」按钮同样明文一次；旧 secret 立即失效
- 「回调测试」按钮：向 `callback_url` 发一个带签名的 `app.created` 测试事件，展示投递结果
- **scope 勾选 UI**：按 `chat / kb / tools / events / admin` 五组展示，每组内都列出细粒度动作，旁边带一个 `<group>:*` 通配勾位方便「整组一键开」；底部额外有超管 `*:*`

### 2.3 签名算法（对齐微信 / 飞书）

请求头三件套：

```
X-App-Id:    <app_id>
X-Timestamp: <unix_ts_seconds>
X-Sign:      hex( HMAC-SHA256(app_secret, timestamp + "\n" + raw_body) )
```

校验：
- `app_id` 存在且 `enabled=true`
- `|now - timestamp| ≤ 300s`（默认 ±5 分钟）
- 签名 byte-level 相等

### 2.4 对接方最小示例（Python）

```python
import hmac, hashlib, json, time, httpx

APP_ID = "..."
APP_SECRET = "..."
BASE = "https://chayuan.example.com"

def signed_request(method: str, path: str, body: dict | None = None):
    raw = json.dumps(body, ensure_ascii=False).encode() if body is not None else b""
    ts = str(int(time.time()))
    sign = hmac.new(APP_SECRET.encode(),
                    ts.encode() + b"\n" + raw,
                    hashlib.sha256).hexdigest()
    headers = {
        "X-App-Id": APP_ID, "X-Timestamp": ts, "X-Sign": sign,
        "Content-Type": "application/json; charset=utf-8",
    }
    return httpx.request(method, BASE + path, content=raw, headers=headers)

print(signed_request("GET", "/openapi/v1/ping").json())
# => {"ok": true, "app_id": "...", "name": "...", ...}
```

### 2.5 内置端点清单（Swagger 已自动暴露）

所有端点都挂在 `/openapi/v1/` 下，统一走 HMAC 签名鉴权，并在 `/docs` 显示三头 `X-App-Id / X-Timestamp / X-Sign` 的「Security Scheme」。

| Method | Path | 所需 scope | 作用 |
| :-- | :-- | :-- | :-- |
| GET | `/ping` | — | 健康探测，返回 app_id / name / scopes / server_time |
| POST | `/echo` | — | body 回声，调试签名 |
| GET | `/server-time` | — | 服务器 Unix 秒 + ISO8601，用来校准时钟漂移 |
| GET | `/scopes` | — | 当前 App 拥有的 scope + 全平台可申请 scope + 分组 |
| GET | `/events` | — | 事件 → 订阅 scope 映射（供自查） |
| GET | `/whoami` | `admin:read` | 当前 App 的完整元信息（不含 secret） |
| GET | `/chat/history` | `chat:read` | 读对话历史 |
| POST | `/chat/complete` | `chat:write` | 同步发起对话（示例） |
| GET | `/kb/search` | `kb:read` | 知识库检索 |
| POST | `/kb/ingest` | `kb:write` | 文档入库 |
| GET | `/tools` | `tools:read` | 列当前可调用的工具 |
| POST | `/tools/call` | `tools:call` | 调用工具 |
| GET | `/admin/apps` | `admin:read` | 列出全部 App（不含 secret） |
| GET | `/ws/stats` | — | WS 连接数 / 分布 / 限额（运维用） |
| WS | `/ws` | `events:subscribe` + 事件 scope | 长连接事件推送（详见 §3） |

> **查看 / 尝试**：浏览器打开 `http://<host>:62581/docs` 就是 Swagger 全量交互式文档；每个接口都能填三头签名 + body，一键「Try it out」。

### 2.6 给开放平台加新端点的最佳姿势

```python
# libs/chayuan-server/chayuan/server/api_server/openapi_routes.py
from fastapi import Depends
from pydantic import BaseModel
from chayuan.server.api_server.openapi_deps import require_scopes
from chayuan.server.config_panel.apps_store import AppSpec


class FooResp(BaseModel):
    ok: bool
    value: str


@openapi_router.get(
    "/foo",
    response_model=FooResp,
    summary="Foo endpoint",
    description="写清楚能做什么、为什么、返回什么。",
)
async def foo(
    q: str,
    app: AppSpec = Depends(require_scopes("kb:read", "tools:call")),
) -> FooResp:
    return FooResp(ok=True, value=f"you asked: {q}")
```

三条铁律：

1. **所有端点声明 `response_model`**——Swagger 才会展示返回 schema 而不是「anything」。
2. **用 `Depends(require_scopes(...))`**——签名校验 + scope 校验 + 注入 AppSpec 一步到位；未满足返回 401/403 带 `{missing: [...]}` 便于排错。
3. **给 `summary` + `description`**——Swagger 的侧栏和详情都靠它们。

### 2.7 事件回调（可选）

在面板里给 App 勾上「订阅的回调事件」+ 填 `callback_url`。注意订阅的事件也要**能被当前 App 的 scope 覆盖**，否则会被分发器静默跳过（与 WS 订阅同一套 `EVENT_SCOPE_MAP`）。察元业务代码任何地方想发事件：

```python
from chayuan.server.shared.callback_dispatcher import dispatch_event_async

dispatch_event_async("chat.completed", {
    "conversation_id": "...", "answer": "...",
    "user_id": "...",
})
```

分发器会查找所有订阅该事件的 App，并**用其自己的 `app_secret` 重新签名**，POST 到各自 `callback_url`。失败重试 2 次（0.5s/1.0s 间隔），只打日志不阻塞主业务。

对接方的回调 handler 示例（FastAPI）：

```python
@app.post("/chayuan/callback")
async def chayuan_cb(request: Request):
    raw = await request.body()
    sig = request.headers["X-Sign"]
    ts = request.headers["X-Timestamp"]
    expected = hmac.new(APP_SECRET.encode(),
                        ts.encode() + b"\n" + raw,
                        hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(401)
    body = json.loads(raw)
    # body = {"event": "chat.completed", "ts": ..., "data": {...}}
    # 业务处理…… 尽快返回 2xx，避免阻塞察元侧回调
    return {"ok": True}
```

当前内置的事件枚举：
`chat.completed / kb.doc.updated / kb.doc.deleted / tool.called / app.created`。可在 `apps_store.ALLOWED_EVENTS` 里扩展。

---

## 3. 服务端 WebSocket（Inbound 长连接推送）

给外部 App 一条 `wss://` 长连接订阅 Chayuan 的事件，低延迟替代 HTTP 回调。适合：
消息频率高、需要实时性（如 chat streaming、KB 写入触发的侧边栏刷新）、或者对方没法
对外暴露 HTTP 回调（企业内网 / 手机端）。

### 连接 & 鉴权

URL：`wss://<host>/openapi/v1/ws?app_id=X&timestamp=T&sign=S`

签名算法与 HTTP 完全一致（`HMAC-SHA256(secret, T + "\n" + body)`），WS 场景下
body 为空字符串：

```python
import hmac, hashlib, time, websockets, asyncio, json

APP_ID, APP_SECRET = "...", "..."
BASE = "wss://chayuan.example.com"

ts = str(int(time.time()))
sig = hmac.new(APP_SECRET.encode(), ts.encode() + b"\n", hashlib.sha256).hexdigest()

async def main():
    url = f"{BASE}/openapi/v1/ws?app_id={APP_ID}&timestamp={ts}&sign={sig}"
    async with websockets.connect(url) as ws:
        hello = json.loads(await ws.recv())
        print("hello:", hello)
        await ws.send(json.dumps({
            "op": "subscribe",
            "events": ["chat.completed", "kb.doc.*"]
        }))
        while True:
            msg = json.loads(await ws.recv())
            print(msg)

asyncio.run(main())
```

### 控制协议（客户端 → 服务端）

| op | 含义 |
| :-- | :-- |
| `subscribe` | `{op:"subscribe", events:[...]}`；支持通配，如 `kb.doc.*` 匹配 `kb.doc.updated` |
| `unsubscribe` | `{op:"unsubscribe", events:[...]}` |
| `ping` | 保活；服务端回 `{op:"pong", ts}` |
| `pong` | 客户端对服务端 ping 的应答（不回应也行，只要任意消息到达就刷新 idle 计时） |

### 事件格式（服务端 → 客户端）

```json
{"event": "chat.completed", "ts": 1713700000, "data": {...}}
```

与 HTTP 回调 body 完全一致，同一份 `callback_dispatcher.dispatch_event()` 双路分发。

### 高并发设计（`shared/ws_hub.py`）

- **每连接 `asyncio.Queue(maxsize=256)`**：生产者只 `put_nowait`，永远不 await → 单条
  慢连接不会拖累整个广播路径。
- **writer task**：每连接独立 coroutine 从 queue 拿消息 `ws.send_json`；send 超时（默认 5s）
  直接踢掉该连接。
- **背压熔断**：队列满时 drop 计数 +1；累计 drop ≥ 32 就以 CloseCode 4003 踢掉慢连接。
- **心跳**：服务端每 30s 发 `{"op":"ping"}`；客户端 45s 内无任何消息即被 4004 踢。
- **限额**：
  - 全局 `GLOBAL_MAX_CONNECTIONS=10000`
  - 每 App `PER_APP_MAX_CONNECTIONS=10`
  - 接收单帧上限 1MB
  - 超限时握手后立即 CloseCode 4005。

### 关闭码约定

| Code | 语义 |
| :-- | :-- |
| 4401 | 握手鉴权失败（缺参 / 签名错 / App 禁用） |
| 4003 | 背压丢帧过多或 send 超时 |
| 4004 | 心跳超时（客户端长时间静默） |
| 4005 | 触发 per-app / 全局连接数上限 |
| 4009 | 服务端主动关停（uvicorn 收到 SIGTERM） |

### 运维端点

`GET /openapi/v1/ws/stats`（同样走 HMAC 签名）→ 返回：

```json
{
  "stats": {"total": 42, "apps": {"xxx": 3, ...}, "limits": {...}},
  "connections": [
    {"app_id":"...","peer":"1.2.3.4:55000","conn_id":"...",
     "subs":["chat.completed"],"queue_len":0,"sent":120,"drops":0,"idle_s":2.1}
  ]
}
```

### 多 Worker / 多副本扩展

`ws_hub` 是进程内的。要跨 uvicorn worker / 多副本同步事件：

```python
# 在启动阶段注入一个 Redis Pub/Sub 的 publisher
from chayuan.server.shared.ws_hub import get_hub

async def redis_publish(event, payload):
    await redis.publish("chayuan.events", json.dumps(payload))

get_hub().set_remote_publisher(redis_publish)

# 同时起一个 subscriber task：
async def redis_subscribe():
    pubsub = redis.pubsub()
    await pubsub.subscribe("chayuan.events")
    async for msg in pubsub.listen():
        if msg["type"] == "message":
            payload = json.loads(msg["data"])
            await get_hub().broadcast(payload["event"], payload["data"])
```

把这段接入 `server_app.startup` 就能把 broadcast 扩到整个副本群。本轮代码已经留好 hook，**不内置 Redis 依赖**。

---

## 5. WebSocket 端点（Outbound，另一条 Outbound 路径）

与 HTTP 自定义工具对称，但针对 `ws://` / `wss://` 协议。适合：行情推送、流式 LLM 输出、订阅式 IoT 消息。

### 面板操作

⑨ WebSocket 端点 → 新建：

| 字段 | 含义 |
| :-- | :-- |
| `name / title / description` | 同 HTTP 自定义工具；`description` 是 LLM 提示词 |
| `url` | `ws://` 或 `wss://` |
| `auth` | `none / header / query / bearer` 四种注入方式：query 追加到 URL，header 注入握手头，bearer 等价于 `Authorization: Bearer xxx` |
| `on_connect` | 连接成功后要自动发的初始帧列表（订阅 / auth 帧）；支持 `{name}` 占位 |
| `request_template` | 主请求帧的模板；支持 `{name}` 占位；留空表示只订阅 on_connect |
| `response_path` | 可选 dotted path，从每条返回 JSON 抽字段（如 `data.price`） |
| `max_messages` / `receive_timeout` / `close_after_first` | 接收几条 / 超时多久 / 首条即关 |
| `message_format` | `json` / `text`；收到消息按这个优先 parse |
| `params` | 同 HTTP 版，`name / type / description / required / default` |

### 固定响应格式（LLM 看到 & 测试弹窗展示的 envelope）

```json
{
  "ok": true,
  "url": "wss://...",
  "connect_ms": 120,
  "duration_ms": 520,
  "messages": [
    {"ts": 0.005, "direction": "sent", "kind": "json", "body": {"op": "subscribe", ...}},
    {"ts": 0.12,  "direction": "sent", "kind": "json", "body": {"action": "get", "symbol": "AAPL"}},
    {"ts": 0.18,  "direction": "received", "kind": "json", "body": {...}, "parsed": 225.3}
  ],
  "error": ""
}
```

每条 `messages[*]` 结构固定：`ts`（相对连接起点的秒数）、`direction`（sent / received）、`kind`（json / text / bytes / empty）、`body`（解析后对象）、`parsed`（按 `response_path` 抽取的字段，可选）。

### 连接测试

编辑弹窗和卡片右下角都有「测试连接」按钮：
- 按当前 spec + 样本参数真实开 WS
- 把握手耗时、发送帧、接收帧按时序渲染
- 失败时打一行 `error: {类型}: {说明}`

### 最佳实践建议

- **订阅式接口**：把订阅帧放 `on_connect`、`request_template` 留空、`max_messages=N`、`receive_timeout=30`，让 LLM 只等数据。
- **RPC 式接口**：`on_connect` 空、把请求放 `request_template`、`close_after_first=true`，收到首条即关，语义干净。
- **LLM 流式输出（OpenAI WS 风格）**：`max_messages=999` + `receive_timeout=60` + `close_after_first=false`，等服务端主动关。
- **鉴权 token 泄漏风险**：面板里 `auth.value` 用密码控件存储；yaml 落地是明文，请确保 `CHAYUAN_ROOT` 目录权限收紧（与 App 的 `app_secret` 同安全级别）。

### 一条 spec 的 yaml 样例

```yaml
# chayuan_data/websocket_endpoints.yaml
websocket_endpoints:
  - name: market_ticker
    title: 市场行情订阅
    description: 订阅指定股票的实时行情，返回最新价格、成交量、时间戳。
    url: wss://ws.example.com/marketdata
    auth:
      type: query
      key: token
      value: "****"
    on_connect:
      - '{"op":"subscribe","symbol":"{symbol}"}'
    request_template: ''     # 纯订阅，不需要主请求
    message_format: json
    response_path: data.price
    max_messages: 5
    receive_timeout: 8
    close_after_first: true  # 拿到一条就关
    params:
      - name: symbol
        type: string
        description: 股票代码，如 AAPL
        required: true
    enabled: true
```

---

## 6. 复用的基础设施

| 模块 | 用途 |
| :-- | :-- |
| `chayuan/server/shared/http_test.py` | 通用 HTTP 发包 + 响应结构化。被「自定义工具测试按钮」、内置 `http_request` 工具、对接方快速验证共用。 |
| `chayuan/server/shared/websocket_client.py` | 通用 WebSocket 探测（Outbound 用）；`probe_websocket()` 带 auth 注入 / on_connect / 固定 envelope 返回。 |
| `chayuan/server/shared/ws_hub.py` | 服务端连接中枢（Inbound 用）：`ConnectionHub / Connection / writer_task / heartbeat_task`，高并发 + 背压熔断。 |
| `chayuan/server/shared/app_signing.py` | `sign() / verify() / make_signed_headers()`；也导出 `new_app_id / new_app_secret` 工厂方法。 |
| `chayuan/server/shared/scopes.py` | `normalize() / covers() / missing() / event_scope() / filter_subscribable() / sanitize_scope_list()`；scope 语义的唯一真实来源。 |
| `chayuan/server/shared/callback_dispatcher.py` | 事件分发 + 重试；同步 `dispatch_event()` 自动双路（HTTP 回调 + WS Hub 广播）。 |
| `chayuan/server/api_server/openapi_deps.py` | `require_scopes(...)` 依赖 + `APIKeyHeader` 三件套 → Swagger 自动出文档 + scope 校验注入 AppSpec。 |
| `chayuan/server/api_server/openapi_routes.py::AppAuthMiddleware` | 原生 ASGI 中间件，只在 `/openapi/v1/` 前缀生效；其它路径完全绕开，零开销。 |
| `chayuan/server/api_server/openapi_ws.py::openapi_ws` | `/openapi/v1/ws` 端点，查询串签名鉴权 + 订阅按 scope 过滤。 |

---

## 4. 这算「工具注册」吗？

是的——「自定义工具」部分属于 **Tool Registration**：

- yaml → dynamic `StructuredTool` → `_TOOLS_REGISTRY[name] = tool`
- `/tools?enabled=true` 过滤后暴露给 LLM

而「App 注册」虽然名字也是 "register"，但**不是** LangChain 的 tool 概念——它注册的是 OpenAPI 调用主体，类似微信开放平台的「创建应用」。两者解决不同方向的问题，共用签名/HTTP 两件基础设施。

---

## 5. 测试保障

- `tests/unit_tests/test_scopes.py`：scope 规范化 / 覆盖判定 / 老格式兼容 / 事件映射 / 订阅过滤 / 白名单清洗。
- `tests/unit_tests/test_openapi_app_auth.py`：签名 roundtrip / 篡改检测 / 时间漂移 / CRUD / `AppAuthMiddleware` / scope 拦截（403 + `missing` 列表） / 自定义工具动态注册。
- `tests/unit_tests/test_openapi_ws.py`：WS 握手鉴权 / `events:subscribe` 缺失拒连 / 订阅按 scope 过滤（accepted + rejected） / 取消订阅 / per-app 连接数限额。
- `tests/unit_tests/test_websocket_endpoints.py`：Outbound WS 工具 spec 校验 / auth 注入 / frame 解析 / 动态注册生命周期。
- `tests/unit_tests/test_tools_catalog.py`：目录/注册表一致性（已认可 custom tools + ws endpoints 为合法 orphan）。

CI 里一起跑：

```bash
poetry -C libs/chayuan-server run pytest \
  tests/unit_tests/test_scopes.py \
  tests/unit_tests/test_openapi_app_auth.py \
  tests/unit_tests/test_openapi_ws.py \
  tests/unit_tests/test_websocket_endpoints.py \
  tests/unit_tests/test_tools_catalog.py -q
# => 34 passed
```

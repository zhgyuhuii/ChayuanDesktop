# 在线数字人(Published Online Digital Humans)设计

日期:2026-06-03 · 模块:chayuan-desktop / digital-human · 路线:A(sidecar 服务端渲染自包含 HTML 公开页)

## 目标
把工作台里配置好的数字人「发布」成一个公网可分享的在线数字人:
- 新增「在线数字人」tab(工作台 / 我的数字人 / **在线数字人**),卡片或列表展示,可切换。
- 每条有专属公开链接,可复制、可在外部浏览器打开独立页面、可删除。
- 公开页视频按数字人设置的比例自适应;访客可对话(带限流 + owner 开关);统计当前并发观看人数。
- 工作台原「实时对话」按钮改为「发布在线数字人」,点击即发布。

## 决策(用户已定)
- 链接可达范围:**公网任何人可达**。
- 投递方式:**app 只生成公开 URL**(基于 `public_host`);外网可达性由部署/网络层负责,**不内置隧道/中继**。
- 公开页交互:**可对话**(限流 + owner 可关 → 纯观看)。
- 交付:**一次性到底**(不再逐节确认)。

## 架构现实
- 本仓是 Tauri 桌面端 + 本地 sidecar(FastAPI,默认绑 127.0.0.1)。
- 公开页由**外部浏览器**打开 → 必须由 **sidecar 自己吐 HTML**(照搬 `cli_routes._LOGIN_PAGE` 的 `HTMLResponse` 模板模式)。同源,无 CORS 问题。
- 公开 URL 用 `chayuan.server.utils.api_address(is_public=True)` 拼,基于 `API_SERVER.public_host/public_port`。

## 数据模型(快照,不是引用)
新存储 `data/digital_human/published.json`,一条 `PublishedAvatar`:
- `token`(secrets.token_urlsafe,公开 URL 段)、`preset_id`、`owner_id`、`created`。
- 快照:`name`/`avatar_ref`/`avatar_kind`/`video_width`×`video_height`/`model`/`ku_ids`/`persona`/`voice_provider`/`voice_name`。
- 控制:`enabled`(上线)、`chat_enabled`(允许公开对话)、`rate_per_min`(默认 10)、`daily_cap`(默认 500)。
- 用快照原因:源 preset 之后被改/删不影响已发布公开页;重新发布(同 preset_id)覆盖快照。

## 后端
### 持久化 `published_store.py`
`publish(preset, owner_id) / list_published(owner_id?) / get_by_token(token) / delete(token) / set_flags(token, enabled?, chat_enabled?)`。`publish` 同 preset_id 已存在则覆盖(幂等)。

### 在线人数 `online_presence.py`(专用轻量,不用 ws_hub)
> 偏离 spec 初版:ws_hub 绑死开放平台 app_id/订阅/背压协议,观看计数是单一职责小事,自建进程内 `{token: set[WebSocket]}` 更安全可控。
`join(token, ws)->int / leave(token, ws)->int / count(token)->int`;join/leave 后向房内所有 ws 广播 `{op:"viewers", n}`。

### owner 路由(`digital_human_routes.py` 追加,require_auth)
- `POST /api/v1/digital-human/published` body `{preset_id}` → 发布,返回条目(含 `url`)。
- `GET /api/v1/digital-human/published` → 列表(每条带 `url` + 实时 `viewers`)。
- `DELETE /api/v1/digital-human/published/{token}`。
- `PATCH /api/v1/digital-human/published/{token}` body `{enabled?, chat_enabled?}`。

### 公开路由(新文件 `digital_human_public_routes.py`,**无 auth**)
- `GET /dh/{token}` → 自包含 HTML 公开页。
- `GET /api/v1/digital-human/public/{token}/config` → `{name, ratio:{w,h}, avatar_kind, chat_enabled, avatar_url}`;未发布/下线 404。
- `GET /api/v1/digital-human/public/{token}/avatar` → FileResponse(token 网关,不暴露鉴权形象路由)。
- `WS /api/v1/digital-human/public/{token}/presence` → 注册 presence,实时广播在线人数。
- `POST /api/v1/digital-human/public/{token}/chat` → SSE;门控 enabled+chat_enabled+限流(按 IP 令牌桶 rate_per_min + 按 token daily_cap);进程内构造 `chat.graph.ChatRequest`(注入快照 model/ku_ids/metadata.system persona/user_id=owner_id)→ `run_chat_stream`。访客只传消息文本,不能覆盖模型/KB/人设。
- `POST /api/v1/digital-human/public/{token}/tts` → 同门控;`get_modality_service().tts(text, voice=_voice_string(snapshot.voice_provider, voice_name))` 返回音频 bytes。

### 限流(进程内)
`{(token, ip): 令牌桶}` + `{token: (day, count)}`;sidecar 单 worker。超限返回 429。

### 注册
`server_app.py` 在 `include_router(digital_human_router)` 旁加 `include_router(digital_human_public_router)`。

## 前端
- `digitalHuman.ts`:`PublishedAvatar` 类型 + `listPublished / publish(presetId) / deletePublished(token) / setPublishedFlags(token, {enabled?, chat_enabled?})`。
- `OnlineAvatarList.tsx`:卡片/列表切换(复用 `DhTaskList` toggle 模式);每条:缩略图、名称、比例徽标、实时在线人数、复制链接、打开链接(外部浏览器)、上线开关、对话开关、删除。轮询 `listPublished`(含 viewers)刷新。
- `DigitalHumanPage.tsx`:tab 行加第三个 `online`「在线数字人」。
- `GeneratePanel.tsx`:顶部一行那个「实时对话」按钮改名「发布在线数字人」,点击 `publish(curPreset.id)` → toast 显示链接(复制)+ 经回调切到 online tab(乐观刷新列表)。`DhStudio` 透传 `onPublished` 回调到 `DigitalHumanPage`。

## 不做(YAGNI)
隧道/中继;公开页实时口型(沿用 idle 静态形象);多 worker 并发计数(单进程,hub 已留 Redis 钩子,本功能用自建 presence);累计历史访问统计(只做并发在线)。

## 测试
后端:published_store CRUD + 快照、限流令牌桶、config 下线 404、presence join/leave 计数。前端:typecheck(沙箱盲,用户机器跑)。

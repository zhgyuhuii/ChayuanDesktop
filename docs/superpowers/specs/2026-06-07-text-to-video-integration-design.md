# 文生视频 / 图生视频模型接入 — Design Doc

- 日期：2026-06-07
- 范围：`chayuan-server`（模型网关 + 连接器 + 配置面）+ `chayuan-client`（模型厂商配置 UI + 使用入口）
- 状态：已与用户对齐架构与分期，待写 P1 实施 plan

## 背景与问题

用户两个诉求命中两个不同缺口：
1. **「百炼 Wanx/万象 T2V 没在模型清单里」** → 配置面缺口：系统没有 `text2video` 这一类能力字段。
2. **「即使申请了 key 怎么用」** → 使用面缺口：现有「视频生成(VG)」是纯本地合成（脚本→TTS→字幕→在线素材→FFmpeg 时间轴），全程不调任何外部文生视频模型，没有触发入口。

### 现状关键事实（已核对源码）

- 后端已有「模态网关」基础设施：`chayuan-server/libs/chayuan-server/chayuan/server/modality/router/`
  - `protocol.py`：`Capability` 枚举含 `T2V`（line 13-25）；模型名前缀→capability、→vendor 推断表（line 46-159）。
  - 连接器注册表 `@register(Capability.T2V, "dashscope")`；`DashScopeT2VConnector`（`connectors/video_gen/dashscope.py`）已实现「提交→轮询(5s)→下载」+ `resume`。
  - `TaskManager`（`tasks/manager.py`）：asyncio 后台任务、`event_bus` 进度、SSE 订阅(replay+live)、5%/3s 进度落库、断点续传。
  - 入口 `POST /v1/modality/completions`（`api_server/openai_routes.py` line 405-533）→ `classify_capability`+`classify_vendor`→`pick_connector`→`dispatch_via_manager`→`EventSourceResponse`。
  - 连接器选择 `pick_connector(cap, model, platform_type)`（`connectors/base.py` line 120-144）：先模型名前缀推 vendor，再 platform_type，再通配 `(cap,"*")`。
- **配置面缺 `text2video`**：
  - `chayuan/settings.py` `PlatformConfig`（line 877-933）有 `llm_models/embed_models/text2image_models/image2text_models/rerank_models/speech2text_models/text2speech_models`，**无 `text2video_models`**。
  - `api_server/provider_routes.py` `_MODEL_FIELDS`（line 348-356）硬编码 7 类，无 `text2video_models`。
  - `config_panel/model_config.py` `_PROVIDER_DEFAULT_MODELS` 的 `bailian`（line 409-420）有 `text2image_models:["wanx-v1",...]`，**无 `text2video_models`**。
- 前端缺 `text2video`：
  - `chayuan-client/packages/app/src/features/marketplace/lib/modelTypes.ts`（line 26-35）`ModelType` 联合类型 8 种：`llm/embed/rerank/text2image/image2text/image2image/tts/asr`，**无 `text2video`**。
  - `packages/api/src/modelPlatform.ts` `PlatformConfig`/`ProviderCatalogEntry` 同样无 `text2video_models`。
  - marketplace 组件（`MarketplacePage`/`ProviderCard`/`ModelTypeAccordion`/`ModelLineEditor`）全部依据 `MODEL_TYPES` 常量动态渲染，加一类即自动出现。
- 现有 VG（`features/video-generation/`）纯本地合成，`VgVideoParams` 无 `video_model` 字段，无视频模型选择器；按次门控 `useUsageGate('video')` 已存在。

### 外部接口调研结论（2026-06，带来源核对）

四家共性：**异步「提交→轮询 task_id→下载视频 URL」**，契合现有 `TaskManager`。差异集中在鉴权/endpoint/字段。

| 厂商 | 提交 endpoint | 鉴权 | 主力模型 | 国内直连 | 难度 |
|---|---|---|---|---|---|
| 百炼 Wanx（已实现，需跟新名） | `POST .../aigc/video-generation/video-synthesis` + 头 `X-DashScope-Async: enable` | Bearer | `wan2.7-t2v` / `wan2.6-i2v` / `wan2.2-i2v-flash` | ✅ | 🟢 |
| Kling 可灵 | `POST https://api.klingai.com/v1/videos/text2video`(+`/image2video`) | **JWT(ak/sk, HS256, iss=ak+exp)** | `kling-v2-5-turbo` / `kling-v1-6` | ✅ | 🟡 JWT |
| MiniMax 海螺 | `https://api.minimaxi.com`（国内） | Bearer | `MiniMax-Hailuo-2.3` | ✅ | 🟢 |
| 生数 Vidu | 百炼代理 / `platform.vidu.com` | Bearer | vidu 系列 | ✅ | 🟢 |
| 智谱 CogVideoX | `https://open.bigmodel.cn` | Bearer | `cogvideox-3` | ✅ | 🟢 |
| 字节即梦 Seedance | `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks` | Bearer | `dreamina-seedance-*` | ✅ | 🟢 队列 |
| Runway | `POST https://api.dev.runwayml.com/v1/text_to_video`(+`image_to_video`) | Bearer + 头 `X-Runway-Version: 2024-11-06` | `gen4_turbo` | ❌ 需海外网 | 🟡 版本头 |
| ~~OpenAI Sora~~ | — | — | — | ❌ | **跳过：官方 2026-09-24 关停** |

⚠️ 所有 endpoint/模型名/价格按 2026-06 认知，**每家实现前必须对当前官方文档实测核对**（项目硬规矩「模型链接写前必实测」）。生成 URL 多为 **24h 有效，必须及时转存落盘**。

开源本地（P4 参考，消费级 12–24GB 可行性排序）：LTX-Video 0.9.x(12GB, Apache2.0, T2V+I2V) > Wan2.2-TI2V-5B(12GB, Apache2.0) > Allegro(12GB, Apache2.0) > Wan2.1-T2V-1.3B(8GB, GGUF) > Pyramid-Flow(12GB, MIT)。⚠️ CogVideoX 权重为**非商用许可**，本地化需法务确认。

## 架构（解决方案与实现方式）

三件一起：统一异步连接器框架 + 打通配置面 + 加使用入口。

### A. 统一异步连接器框架（DRY）

抽象基类 `AsyncPollVideoConnector`（沿用 `DashScopeT2VConnector` 现有循环），封装公共流程：提交任务→轮询(可配间隔/超时)→完成下载→落盘→进度事件→`resume`。每家子类只覆写四个钩子：

- `build_submit_request(req) -> (url, headers, json_body)`
- `parse_submit_response(resp) -> upstream_task_id`
- `build_poll_request(task_id) -> (url, headers)`
- `parse_poll_response(resp) -> PollResult{status, progress?, video_urls?, error?}`

子类：`DashScopeVideoConnector`（重构现有）、（P2）`KlingVideoConnector`（额外 `build_jwt(ak, sk)`）、`MiniMaxVideoConnector`、`ViduVideoConnector`、`ZhipuVideoConnector`、`SeedanceVideoConnector`、`RunwayVideoConnector`（加版本头）。

**T2V 与 I2V 同一连接器**：`GenerateReq` 带可选首帧图(`image_url`/`image_b64`)，子类按有无图选择 endpoint/字段。Capability 上 I2V 复用 `T2V` 路由类别（配置层不区分，连接器内部分流）。

**预留本地 vendor 接口（P4 钩子）**：定义 `LocalVideoConnector` 抽象契约（submit=入本地 GPU 任务队列，poll=查本地任务，result=本地文件路径），并注册占位 `@register(Capability.T2V, "local")` 桩，调用时抛「本地视频运行时未安装(P4)」明确错误。P1 只定契约+桩，不实现。

### B. 打通配置面

全链路新增 `text2video_models` 字段（一类，标签「视频生成」，覆盖 T2V/I2V）：

- 后端：`settings.PlatformConfig` 加字段(默认 `[]`)；`provider_routes._MODEL_FIELDS` 加 `"text2video_models"`；`model_config._PROVIDER_DEFAULT_MODELS["bailian"]` 加 `text2video_models:["wan2.7-t2v","wan2.6-i2v"]`（其余厂商 P2 补）。
- 前端：`modelTypes.ts` `MODEL_TYPES` 加 `{ key:'text2video', field:'text2video_models', label:'视频生成', ... }`；`modelPlatform.ts` 的 `PlatformConfig`/`ProviderCatalogEntry` 加 `text2video_models?: string[]`。marketplace 组件自动渲染新栏。

**能力按配置路由（关键）**：模型一旦被配进某 provider 的 `text2video_models`，网关按 T2V 路由，**不再仅靠模型名前缀猜**（自定义模型名前缀分类会失败）。`pick_connector` 入口先查「该 model 属于哪个已配 provider 的哪一类」得到 `(capability, vendor=platform_type/name)`，前缀推断退为兜底。

### C. 使用入口

P1 独立「AI 视频生成」页（新路由 `/ai-video` + 侧边栏入口）：
- 提示词 textarea + 可选首帧图上传(I2V) + 视频模型选择器(聚合所有已配 `text2video_models`，显示 `provider::model`) + 参数(时长/分辨率/比例)。
- 提交 → `packages/api` 新增 `aiVideoSubmit()` 调 `/v1/modality/completions`(model=所选) → SSE 进度（复用 `RenderProgressCard` 同款进度卡）→ 结果视频内嵌 + 下载。
- 接 `useUsageGate('video')` 按次计费（已存在 video 计费）。

P3 再把该能力作为时间轴 clip 源接进 VG 向导（独立 spec）。

## 分期

| 期 | 内容 | 独立产出 |
|---|---|---|
| **P1（本 spec 详述）** | 配置面打通 + 连接器基类重构 + Wanx(`wan*`) T2V/I2V 跟新 + 独立「AI 视频生成」页 + 预留 local 桩 | 百炼 Wanx 进清单且能用 |
| **P2** | Kling(JWT) + 海螺/Vidu/智谱/Seedance + Runway(标注需海外网)；各厂商默认模型补全 | 多家云端可选 |
| **P3** | 文生/图生视频作为时间轴 clip 源融入 VG 向导 | 与本地合成融合 |
| **P4（独立重型）** | 填实 `LocalVideoConnector`：本地开源模型 GPU sidecar(LTX-Video / Wan2.2-5B，ComfyUI/diffusers) | 本地出片 |

## P1 详细设计

### 后端改动

1. `chayuan/settings.py` `PlatformConfig`：加
   ```python
   text2video_models: t.Union[t.Literal["auto"], t.List[str]] = []
   ```
2. `api_server/provider_routes.py` `_MODEL_FIELDS`：元组追加 `"text2video_models"`。
3. `config_panel/model_config.py` `_PROVIDER_DEFAULT_MODELS["bailian"]`：加 `"text2video_models": ["wan2.7-t2v", "wan2.6-i2v"]`。
4. `modality/router/connectors/video_gen/base_async.py`（新）：`AsyncPollVideoConnector` 基类（从 `dashscope.py` 抽公共循环 + 四钩子 + `resume`）。
5. `modality/router/connectors/video_gen/dashscope.py`：改为继承基类，只实现四钩子；I2V(`input.img_url`) 路径补全；模型前缀 `protocol.py` 加 `wan2`/`wan-2`/`wan2.7`/`wan2.6` → T2V、→ `dashscope`。
6. `modality/router/connectors/video_gen/local_stub.py`（新）：`LocalVideoConnector` 抽象契约 + `@register(Capability.T2V,"local")` 桩（抛 NotImplemented 明确错误）。
7. 能力按配置路由：`pick_connector`/入口在 classify 前先查 provider 配置的 `text2video_models` 命中 → 定 capability=T2V、vendor=platform 名；前缀推断退兜底。落盘转存 24h URL 复用现有结果落盘逻辑。

### 前端改动

8. `marketplace/lib/modelTypes.ts`：`MODEL_TYPES` 加 `text2video` 条目（label「视频生成」，field `text2video_models`，icon 选 film/clapperboard）。
9. `packages/api/src/modelPlatform.ts`：`PlatformConfig` + `ProviderCatalogEntry` 加 `text2video_models?: string[]`。
10. `packages/api/src/aiVideo.ts`（新）：`aiVideoListModels()`（聚合已配 text2video 模型）、`aiVideoSubmit(params)`（POST `/v1/modality/completions`）、`aiVideoSubscribe(taskId, handlers)`（SSE，复用 `videoGeneration.ts` 的 fetch+SSE 解析器写法，走 `getPlatform().net.fetch`）。
11. `features/ai-video/AiVideoPage.tsx`（新）+ 路由 `/ai-video` + 侧边栏入口：提示词 + 首帧图上传 + 模型选择器 + 参数 + 提交 + 进度卡 + 结果卡。复用现成 `RenderProgressCard` 风格。
12. `useUsageGate('video')` 接入。

### 验收

- 模型厂商页出现「视频生成」栏，可给百炼填 `wan2.7-t2v`/`wan2.6-i2v` 并展示。
- 「AI 视频生成」页：输入提示词(或传首帧图)→选 Wanx→提交→进度推进→出片可下载。
- 配置了 `local` 之外的 vendor 不受影响；调用 `local` 模型报「未安装(P4)」明确错误。

### 验证命令

- 后端：`PYTHONPATH=".../libs/chayuan-server" python -m py_compile <改动文件>`；有 modality 测试则补 `text2video_models` schema/路由测试 + Wanx I2V 分流测试 + 能力按配置路由测试。
- 前端：`cd chayuan-client && npm run typecheck`。
- 重建 desktop + 重启 sidecar 后用户实测（用户常测旧版，改完提醒）。

## 已知风险

- 外部 endpoint/模型名/鉴权随官方变动，**每家实现前实测核对**；Sora 已跳过。
- 能力按配置路由要兼容旧的前缀推断逻辑，避免回归现有 T2I/TTS 等路由。
- I2V 首帧图传输（URL vs base64）各家不同，基类钩子需容纳两种。
- 生成 URL 24h 失效，必须落盘转存（复用现有结果落盘）。
- 计费口径：T2V/I2V 都计 `video` 按次，与现有 VG 一致。

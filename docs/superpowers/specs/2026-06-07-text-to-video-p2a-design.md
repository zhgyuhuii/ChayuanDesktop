# 文生视频接入 P2a — 连接器基类 + 配置路由 + Kling — Design Doc

- 日期：2026-06-07
- 范围：`chayuan-server`（模态网关连接器层 + 路由）；前端基本不动（Kling 凭 P1 的 text2video 类自动进清单）
- 状态：架构沿用已批准的总 spec（`2026-06-07-text-to-video-integration-design.md`），本 doc 细化 P2a，待写 plan
- 前置：P1 已上线（commit 6caeb76a）——`text2video_models` 配置面打通、`/ai-video` 页、`DashScopeT2VConnector` 含 I2V、`local` 桩

## 目标（P2a = 地基 + Kling 一家验证整套）

1. **抽连接器基类 `AsyncPollVideoConnector`**：把「提交→轮询→下载+进度+续传」的公共循环从 `DashScopeT2VConnector` 抽出，子类只实现 4 个钩子。DashScope 重构进基类（行为不变）。
2. **能力按配置路由**：模型被配进某 platform 的 `*_models` 列表后，网关据此判 capability，不再只靠模型名前缀（解决自定义模型名分类为 CHAT 的问题）。
3. **Kling 可灵连接器**（第二家，验证基类 + JWT 特殊鉴权 + I2V）。

P2b（后续）：海螺/Vidu/智谱/Seedance/Runway 各加一个子类（届时≈每家 30-50 行）。

## 现状关键事实（已核对源码）

- `connectors/video_gen/`：仅 `dashscope.py`(P1 后含 `_build_submit_payload` I2V 分流 + `_poll_and_download`) + `local_stub.py`。`__init__.py` 显式 import 各连接器触发注册。
- `DashScopeT2VConnector`：`generate()` 提交(`X-DashScope-Async: enable`)→`_poll_and_download(client, req, upstream_task_id, tasks_url_prefix, headers_poll, size, duration, prompt)`(5s 轮询/10min 超时，yield `data-task-progress`，SUCCEEDED 下载 `output.video_url`→artifacts→`file_part("video/mp4",url)`)；`resume()` 复用 poll 循环。helper：`_build_endpoints`/`_normalize_size`/`_estimate_percent`。
- `sse_v5` 事件构造（确认签名）：`text_start(id)`、`text_end(id)`、`file_part(media_type,url,metadata=None)`→`{type:"file",mediaType,url,metadata?}`、`data_part(name,data,id=None)`→`{type:"data-<name>",data}`（进度用 `data_part("task-progress",{percent,...})`）、`error_event(text,code=None)`→`{type:"error",errorText,code?}`、`finish_step_event()`→`{type:"finish-step"}`、`finish_event()`。
- `connectors/base.py`：`Connector`(抽象 `generate`，可选 `resume`/`cancel`)、`register(cap,platform_type)`、`get_connector(cap,platform_type)`(精确→`*`通配→None)、`pick_connector(cap,model,platform_type)`(先 `classify_vendor(model)`→`(cap,vendor)`，再 `platform_type`，再通配)、`_CONNECTORS` 表。
- `protocol.py`：`classify_capability(model)` 纯前缀匹配，**匹配不到一律 CHAT**；`classify_vendor(model)` 前缀匹配，不中返 None。`("kling",T2V)`、`("kling","kling")` 前缀已在表里。
- `api_server/openai_routes.py` `create_modality_completion`：`cap = classify_capability(actual_model)` → `info = get_model_info(model_name=actual_model, platform_name=explicit_platform)`（返回含 `api_base_url`/`api_key`/`platform_name`/`platform_type`，**未直接给模型类别**）→ 构造 `GenerateReq` → `dispatch_via_manager`。
- `pyproject.toml`：`pyjwt = "~2.8.0"` **已是依赖**；服务端目前无 `import jwt`。
- `model_config.py`：无 kling 厂商条目（`PROVIDER_CATALOG`/`_PROVIDER_DEFAULT_MODELS`/`_PROVIDER_LINKS` 均无）。

## 设计

### A. 基类 `AsyncPollVideoConnector`

新建 `connectors/video_gen/base_async.py`：

```text
PollStatus = Enum(PENDING, RUNNING, SUCCEEDED, FAILED, CANCELED, UNKNOWN)

@dataclass
class PollResult:
    status: PollStatus
    percent: int | None = None        # 上游若给进度
    video_urls: list[str] = []        # SUCCEEDED 时的产物 URL
    error_message: str | None = None  # FAILED 时

class AsyncPollVideoConnector(Connector):
    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0

    # 公共流程(从 DashScope 抽)
    async def generate(req):
        prompt 校验空 → error_event
        yield text_start; yield data_part("task-progress",{percent:2,message:"提交任务"})
        url, headers, body = self.build_submit(req)          # 钩子
        resp = await httpx POST(url, headers, json=body)
        upstream_task_id = self.parse_submit(resp.json())    # 钩子
        async for ev in self._poll_loop(req, upstream_task_id): yield ev

    async def resume(req, upstream_task_id):
        async for ev in self._poll_loop(req, upstream_task_id): yield ev

    async def _poll_loop(req, upstream_task_id):
        起始计时; while True:
            req.cancelled 已取消 → return
            超 poll_timeout_s → yield error_event("超时"); return
            url, headers = self.build_poll(req, upstream_task_id)   # 钩子
            r = await httpx GET; pr = self.parse_poll(r.json())     # 钩子 → PollResult
            yield data_part("task-progress", {percent: pr.percent or 估算, ...})
            if pr.status == SUCCEEDED:
                下载 pr.video_urls[0] → artifacts.save_bytes(bytes,"video/mp4")
                yield file_part("video/mp4", saved_url, {upstream_task_id,...})
                yield text_end; yield finish_step_event(); return
            if pr.status == FAILED: yield error_event(pr.error_message); return
            await asyncio.sleep(poll_interval_s)

    # ── 子类必须实现的 4 个钩子 ──
    def build_submit(req) -> (url:str, headers:dict, body:dict): ...
    def parse_submit(resp_json:dict) -> str: ...                  # 返 upstream task id
    def build_poll(req, task_id:str) -> (url:str, headers:dict): ...
    def parse_poll(resp_json:dict) -> PollResult: ...
```

httpx client、`_estimate_percent`、下载落盘逻辑从现有 DashScope 搬到基类共用。基类不绑定具体厂商字段。

### B. DashScope 重构进基类

`dashscope.py` 的 `DashScopeT2VConnector` 改为 `AsyncPollVideoConnector` 子类，实现 4 钩子（内容来自现有 `_build_submit_payload`/提交头/`_poll_and_download` 解析逻辑）：
- `build_submit`：`_build_endpoints(api_base)` 得提交 URL；头含 `Authorization: Bearer`+`X-DashScope-Async: enable`；body = 现有 `_build_submit_payload(req)`（含 I2V `img_url`）。
- `parse_submit`：`resp["output"]["task_id"]`。
- `build_poll`：`{tasks_prefix}/{task_id}`；Bearer 头。
- `parse_poll`：读 `output.task_status`（PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED→PollStatus），SUCCEEDED 取 `output.video_url`，FAILED 取 `output.message`。
- 保留 `@register(Capability.T2V,"dashscope")`。**行为与 P1 完全一致**（测试锁定）。

### C. 能力按配置路由

新增 helper（放 `modality/router` 合适处，如 protocol.py 或新 `routing.py`）：
```text
capability_from_config(model: str, platform_info: dict | repo) -> Capability | None
```
解析该 model 落在所属 platform 的哪个 `*_models` 列表，按字段映射：
`text2video_models→T2V, text2image_models→T2I, image2text_models→VL, rerank_models→RERANK, embed_models→EMBEDDING, speech2text_models→ASR, text2speech_models→TTS, llm_models→CHAT`。

`create_modality_completion` 改为：先 `get_model_info` 拿到 platform → `cap = capability_from_config(actual_model, platform) or classify_capability(actual_model)`。即**配置优先、前缀兜底**，不破坏老行为（配置没命中时与现在完全一致）。
> 实现时确认从 `get_model_info` 的返回 / model_platform 仓库怎么拿到「该 platform 的各 `*_models` 列表」（必要时多查一次平台配置）。

vendor 路由不动：`pick_connector` 已能用 `platform_type` 兜底（Kling 平台 `platform_type="kling"` → `(T2V,"kling")`）。

### D. Kling 连接器

新建 `connectors/video_gen/kling.py`，`@register(Capability.T2V,"kling")`，继承 `AsyncPollVideoConnector`：
- **JWT 鉴权**（特殊）：`api_key` 字段约定填 `"<AccessKey>:<SecretKey>"`，连接器按第一个 `:` 切分；helper `_kling_jwt(ak, sk) -> str`：PyJWT HS256，payload `{iss: ak, exp: now+1800, nbf: now-5}`（`import jwt`，`import time`）。每次请求现签。
- `build_submit`：有图片附件 → `POST {base}/v1/videos/image2video`（body 含 `image`），否则 `text2video`；body `{model_name: req.model, prompt, [image], duration, aspect_ratio, mode, negative_prompt}`（从 `req.params` 取 duration/aspect_ratio/mode）；头 `Authorization: Bearer <jwt>`。base 默认 `https://api.klingai.com`（用 `req.api_base` 若配了）。
- `parse_submit`：`resp["data"]["task_id"]`。
- `build_poll`：`{base}/v1/videos/{text2video|image2video}/{task_id}`；JWT 头。
- `parse_poll`：`data.task_status`（submitted/processing→RUNNING，succeed→SUCCEEDED，failed→FAILED）；SUCCEEDED 取 `data.task_result.videos[0].url`；FAILED 取 `data.task_status_msg`。
- ⚠️ endpoint/字段/状态串以 KlingAI 当前官方文档实测核对（加 `# TODO(P2-verify)`）。Kling 国内站直连。

`connectors/video_gen/__init__.py` 追加 `from ... import kling  # noqa`。

### E. Kling 厂商进目录（让用户能配）

`model_config.py`：
- `PROVIDER_CATALOG` 加 `ProviderMeta("kling", ...)`（platform_type `"kling"`，标签如 `("国内","视频")`）。
- `_PROVIDER_DEFAULT_MODELS["kling"] = {"text2video_models": ["kling-v2-5-turbo", "kling-v1-6"]}`。
- `_PROVIDER_LINKS["kling"]`：申请 key URL（KlingAI 开放平台）。
- **api_key 双密钥提示**：在该厂商 description / install_guide 注明「API Key 处填 `AccessKey:SecretKey`（用英文冒号连接）」。前端 api_key 输入框是通用的，靠文案提示即可（P2a 不改前端控件）。

### 前端

P2a **基本不改前端**：Kling 厂商条目从后端 catalog 返回，凭 P1 的 `text2video` 类自动在模型厂商页出现「视频生成」栏；`/ai-video` 页的 `aiVideoListModels()` 自动包含 Kling 已配模型。仅需确认后端 catalog 把 kling 的 `apply_key_url`/`description`(含 ak:sk 提示) 透传到前端展示（已有机制）。

## 验证

- 后端 pytest（**本沙箱无 py312，留用户机器跑**）：
  - 基类循环：写一个 fake 子类（submit 立即返 task_id、parse_poll 第 1 次 RUNNING 第 2 次 SUCCEEDED 给假 URL，下载用 monkeypatch），断言 yield 出 progress + file_part + finish。
  - DashScope 重构后行为不变：复用 P1 的 `test_dashscope_i2v.py`（`_build_submit_payload` 仍在或等价）+ parse_poll 对 SUCCEEDED/FAILED 样例 JSON。
  - Kling：`_kling_jwt` 产出可被 `jwt.decode(verify=False)` 解出 `iss==ak`；`build_submit` T2V 无 image / I2V 带 image + endpoint 选择；`parse_poll` 对 succeed/processing/failed 样例。
  - 配置路由：`capability_from_config` 对「配在 text2video_models 里的自定义名」返 T2V，未命中返 None。
- 语法自检：对所有改动/新增 .py 跑 `ast.parse`。
- 重建 desktop + 重启 sidecar 后实测：模型厂商页可配 Kling（填 ak:sk）；`/ai-video` 选 Kling 模型出片（需真 ak/sk + 国内网）。

## 已知风险

- 本沙箱跑不了 pytest，6 家连接器无法集成测；P2a 只上 Kling 一家，靠用户真 key 端到端验证后再 P2b 批量。
- Kling endpoint/状态串/字段需对官方文档实测（`# TODO(P2-verify)`）。
- DashScope 重构是行为敏感改动：必须保证 wanx 既有路径完全不变（测试 + 实测双保险）。
- api_key 复用单字段塞 `ak:sk` 是务实折中；若日后多厂商需多字段鉴权，再考虑扩展 PlatformConfig（P2a 不做）。
- `capability_from_config` 要拿到平台的 `*_models` 列表，确认仓库访问路径不引入循环依赖。

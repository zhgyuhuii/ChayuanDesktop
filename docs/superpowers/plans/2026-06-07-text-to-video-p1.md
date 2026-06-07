# 文生视频接入 P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让百炼 Wanx(`wan*`) 文生/图生视频模型能在「模型厂商」清单里配置展示，并通过新的独立「AI 视频生成」页真正调用出片。

**Architecture:** 全链路新增 `text2video_models` 配置类（后端 PlatformConfig/provider_routes/默认模型 + 前端 ModelType/PlatformConfig）；给 DashScope 连接器补 I2V 分流并加 `wan2` 前缀路由；注册一个 `local` vendor 桩建立 P4 扩展点；前端加 `/ai-video` 页走现有 `/v1/modality/completions` + SSE。

**Tech Stack:** Python(FastAPI/Pydantic/pytest)、TS(React/TanStack Query/Tailwind)、现有 modality 网关(Capability/Connector/TaskManager/SSE v5)。

**P1 范围收敛说明（YAGNI）：**
- **连接器基类抽取 → 推迟到 P2**：P1 只有 DashScope 一个连接器，单实现抽基类是过早抽象。P2 加第二家(Kling)时再抽 `AsyncPollVideoConnector`。
- **「能力按配置路由」→ 推迟到 P2**：P1 默认 Wanx 模型靠加 `wan2` 前缀即可正确分类路由，足够达成验收；任意自定义模型名的配置路由放 P2。
- P1 仍交付：配置面打通 + Wanx T2V/I2V 可用 + 独立使用页 + `local` 桩扩展点。

**验证约定：** 后端有 pytest（`PYTHONPATH` 见各任务）；前端 `npm run typecheck`。**不自动 commit/push**（仓库 root 所有，提交需 sudo 且仅用户明确要求时）。每任务以 pytest/typecheck 为门，最后人工实测（重建 desktop + 重启 sidecar）。

仓库根 `/work/chayuan-desktop`。服务端包根 `chayuan-server/libs/chayuan-server`。

---

## File Structure

后端（`chayuan-server/libs/chayuan-server/chayuan/server/`）：
- `settings.py` — 修改：`PlatformConfig` 加 `text2video_models`。
- `api_server/provider_routes.py` — 修改：`_MODEL_FIELDS` 加字段。
- `config_panel/model_config.py` — 修改：`bailian` 默认模型加 `text2video_models`。
- `modality/router/protocol.py` — 修改：前缀表加 `wan2` → T2V/dashscope。
- `modality/router/connectors/video_gen/dashscope.py` — 修改：I2V(`img_url`) 分流。
- `modality/router/connectors/video_gen/local_stub.py` — 新建：`local` vendor 桩。

前端（`chayuan-client/packages/`）：
- `app/src/features/marketplace/lib/modelTypes.ts` — 修改：加 `text2video` 类型。
- `api/src/modelPlatform.ts` — 修改：`PlatformConfig`/`ProviderCatalogEntry` 加 `text2video_models`。
- `api/src/aiVideo.ts` — 新建：提交 + SSE 订阅。
- `app/src/features/ai-video/AiVideoPage.tsx` — 新建：使用页。
- 路由注册 + 侧边栏入口 — 修改。

---

## Task B1: 后端配置面加 `text2video_models`

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/settings.py`（`PlatformConfig`，约 line 877-933）
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/provider_routes.py`（`_MODEL_FIELDS`，line 348-356）
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/config_panel/model_config.py`（`bailian`，line 409-421）
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_text2video_config.py`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/unit_tests/test_text2video_config.py`：
```python
from chayuan.server.settings import PlatformConfig
from chayuan.server.api_server.provider_routes import _MODEL_FIELDS


def test_platform_config_has_text2video_field():
    cfg = PlatformConfig(platform_name="p", platform_type="openai", text2video_models=["wan2.7-t2v"])
    assert cfg.text2video_models == ["wan2.7-t2v"]


def test_platform_config_text2video_defaults_empty():
    cfg = PlatformConfig(platform_name="p", platform_type="openai")
    assert cfg.text2video_models == []


def test_model_fields_includes_text2video():
    assert "text2video_models" in _MODEL_FIELDS


def test_bailian_default_has_text2video():
    from chayuan.server.config_panel.model_config import _PROVIDER_DEFAULT_MODELS
    assert _PROVIDER_DEFAULT_MODELS["bailian"].get("text2video_models")
```

- [ ] **Step 2: 跑测试确认失败**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_text2video_config.py
```
Expected: FAIL（`text2video_models` 未定义 / 不在 `_MODEL_FIELDS`）。

- [ ] **Step 3: `PlatformConfig` 加字段**

在 `settings.py` 的 `PlatformConfig` 里，`text2speech_models` 字段之后加（与同类字段同样用 `t.Union[t.Literal["auto"], t.List[str]]`，默认 `[]`）：
```python
    text2video_models: t.Union[t.Literal["auto"], t.List[str]] = []
```

- [ ] **Step 4: `_MODEL_FIELDS` 加字段**

`provider_routes.py` 的 `_MODEL_FIELDS` 元组在 `"text2image_models",` 之后加一行：
```python
    "text2video_models",
```

- [ ] **Step 5: bailian 默认模型加字段**

`model_config.py` 的 `_PROVIDER_DEFAULT_MODELS["bailian"]` 里，`"text2image_models": [...]` 之后加（⚠️ 模型名以当前官方文档为准，实现时核对 `help.aliyun.com` 文生视频/图生视频 API 参考）：
```python
        "text2video_models": ["wan2.7-t2v", "wanx2.1-t2v-turbo", "wan2.6-i2v"],
```

- [ ] **Step 6: 跑测试确认通过 + 编译**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_text2video_config.py
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/settings.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/provider_routes.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/model_config.py
```
Expected: PASS；py_compile 无输出。

---

## Task B2: protocol.py 加 `wan2` 前缀路由

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/modality/router/protocol.py`（`_PREFIX_TO_CAP` line 46-90、`_PREFIX_TO_VENDOR` line 125-159）
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_wan2_routing.py`（新建）

背景：现表有 `("wan-2", T2V)` 和 `("wan-2","dashscope")`，但新模型名是 `wan2.7-t2v`/`wan2.6-i2v`（无连字符），匹配不到。需加 `wan2` 前缀。注意顺序敏感：`wan2` 要放在 `wanx`/`wanxiang` 之后不影响，但必须能命中 `wan2.7-t2v`。

- [ ] **Step 1: 写失败测试**

新建 `tests/unit_tests/test_wan2_routing.py`：
```python
from chayuan.server.modality.router.protocol import classify_capability, classify_vendor, Capability


def test_wan2_t2v_classifies_t2v():
    assert classify_capability("wan2.7-t2v") == Capability.T2V
    assert classify_capability("wan2.6-i2v") == Capability.T2V


def test_wan2_vendor_is_dashscope():
    assert classify_vendor("wan2.7-t2v") == "dashscope"
    assert classify_vendor("wan2.6-i2v") == "dashscope"
```

- [ ] **Step 2: 跑测试确认失败**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_wan2_routing.py
```
Expected: FAIL（`wan2.7-t2v` 未命中 T2V/dashscope）。

- [ ] **Step 3: 加前缀**

`protocol.py` `_PREFIX_TO_CAP` 里，在 `("wan-2", Capability.T2V),` 这一行附近加：
```python
    ("wan2.",                  Capability.T2V),
    ("wan2-",                  Capability.T2V),
```
`_PREFIX_TO_VENDOR` 里，在 `("wan-2", "dashscope"),` 附近加：
```python
    ("wan2.",            "dashscope"),
    ("wan2-",            "dashscope"),
```
（用 `wan2.` / `wan2-` 两个前缀覆盖 `wan2.7-t2v` 和 `wan2-xxx` 两种命名；不要用裸 `wan2` 以免误伤将来别的命名。）

- [ ] **Step 4: 跑测试确认通过**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_wan2_routing.py
```
Expected: PASS。

---

## Task B3: DashScope 连接器补图生视频(I2V)分流

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/dashscope.py`（`DashScopeT2VConnector.generate`，约 line 164-248）
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_dashscope_i2v.py`（新建）

背景：`GenerateReq.attachments: List[Attachment]`（每个有 `mime`/`url`/`name`）。I2V 时前端把首帧图作为 modality_attachment 传入 → `req.attachments[0]` 为图片。连接器在构造提交 body 时，若有图片附件则走图生视频：把图片放进 DashScope `input.img_url`（DashScope 接受公网/可达 URL；本地 artifact URL 需可被上游拉取，若不可达则改传 base64 data URL —— 实现时按 DashScope 图生视频 API 参考确认 `img_url` 接受形式）。

**实现前先读**：`dashscope.py` 全文（提交 body 怎么构造、`_poll_and_download` 怎么用），`protocol.py` 的 `Attachment` dataclass，`artifacts.py` 怎么由 url 反查本地文件。

- [ ] **Step 1: 写失败测试**

新建 `tests/unit_tests/test_dashscope_i2v.py`（测「构造提交 body」这层纯函数；若现实现把 body 内联在 generate 里，本任务需把「构造 submit body」抽成可测的小函数 `_build_submit_payload(req)`，再写测试）：
```python
from chayuan.server.modality.router.protocol import GenerateReq, Capability, Attachment
from chayuan.server.modality.router.connectors.video_gen.dashscope import DashScopeT2VConnector


def _req(attachments):
    return GenerateReq(
        capability=Capability.T2V, model="wan2.6-i2v", platform_name="bailian",
        platform_type="openai", api_base="https://dashscope.aliyuncs.com", api_key="k",
        prompt="一只猫在跳舞", attachments=attachments,
    )


def test_t2v_payload_has_no_img_url():
    payload = DashScopeT2VConnector()._build_submit_payload(_req([]))
    assert "img_url" not in payload.get("input", {})
    assert payload["input"]["prompt"] == "一只猫在跳舞"


def test_i2v_payload_includes_img_url():
    att = Attachment(mime="image/png", url="https://example.com/a.png", name="a.png")
    payload = DashScopeT2VConnector()._build_submit_payload(_req([att]))
    assert payload["input"].get("img_url")
```

- [ ] **Step 2: 跑测试确认失败**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_dashscope_i2v.py
```
Expected: FAIL（`_build_submit_payload` 不存在）。

- [ ] **Step 3: 抽 `_build_submit_payload` 并分流**

在 `DashScopeT2VConnector` 里加方法（把 `generate` 里现有「构造提交 body」逻辑搬进来，并加 I2V 分支），`generate` 改为调用它：
```python
    def _build_submit_payload(self, req: "GenerateReq") -> dict:
        params = req.params or {}
        inp: dict = {"prompt": req.prompt}
        # 图生视频:取第一张图片附件 → input.img_url
        for a in req.attachments or []:
            if (a.mime or "").startswith("image/"):
                inp["img_url"] = a.url
                break
        payload: dict = {"model": req.model, "input": inp, "parameters": {}}
        for k in ("size", "resolution", "duration", "ratio", "seed", "prompt_extend"):
            if k in params and params[k] is not None:
                payload["parameters"][k] = params[k]
        return payload
```
然后把 `generate` 里原先内联构造 body 的地方替换为 `payload = self._build_submit_payload(req)`，提交时用 `payload`。**保持其余提交/轮询/下载/resume 行为不变。**

⚠️ 实现时核对：DashScope 图生视频 `img_url` 是否接受 base64 data URL；若只接受公网 URL 而本地 artifact 不可达，需在此把本地图读出转成 data URL 或上传换公网 URL（按当前官方文档定）。本地 artifact 反查见 `artifacts.py`。

- [ ] **Step 4: 跑测试确认通过 + 编译**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_dashscope_i2v.py
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/dashscope.py
```
Expected: PASS；py_compile 无输出。

---

## Task B4: 注册 `local` vendor 桩（P4 扩展点）

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/local_stub.py`
- Modify: 连接器自动加载入口（确认 `connectors/video_gen/` 下新文件会被 import；若有 `__init__.py` 显式列举，需把 `local_stub` 加进去 —— 实现时先 grep `video_gen` 的 import 方式）
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_local_video_stub.py`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/unit_tests/test_local_video_stub.py`：
```python
import pytest
from chayuan.server.modality.router.protocol import GenerateReq, Capability
from chayuan.server.modality.router.connectors.base import get_connector


@pytest.mark.asyncio
async def test_local_t2v_connector_registered():
    cls = get_connector(Capability.T2V, "local")
    assert cls is not None


@pytest.mark.asyncio
async def test_local_t2v_yields_not_implemented_error():
    cls = get_connector(Capability.T2V, "local")
    req = GenerateReq(capability=Capability.T2V, model="local-ltx-video", platform_name="local",
                      platform_type="local", api_base="", api_key="", prompt="x")
    events = [ev async for ev in cls().generate(req)]
    assert any(ev.get("type") == "error" or ev.get("errorText") for ev in events)
```
（`get_connector` 签名以 `base.py` 实际为准；若不存在该 helper，用 `_CONNECTORS[(Capability.T2V,"local")]` 直接取。实现时核对。）

- [ ] **Step 2: 跑测试确认失败**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_local_video_stub.py
```
Expected: FAIL（未注册）。

- [ ] **Step 3: 写桩连接器**

新建 `local_stub.py`：
```python
"""本地开源视频模型 vendor 的占位桩(P4 填实现)。

P1 只建立扩展点契约:注册 (T2V, "local"),调用时返回明确的"未安装"错误,
而不是 404 或静默失败。P4 将用 GPU sidecar(LTX-Video / Wan2.2-5B,
ComfyUI/diffusers)实现真正的本地出片,届时替换本文件的 generate/resume。
"""
from __future__ import annotations

from typing import AsyncIterator, Dict

from chayuan.server.modality.router.connectors.base import Connector, register
from chayuan.server.modality.router.protocol import Capability, GenerateReq
from chayuan.server.modality.router.sse_v5 import error_event


@register(Capability.T2V, "local")
class LocalVideoConnector(Connector):
    """本地视频模型连接器占位。P4 实现 submit=入本地队列 / poll=查本地任务 / result=本地文件。"""

    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        yield error_event(
            "本地视频模型运行时尚未安装(计划于 P4 提供)。请先使用云端视频模型(如百炼 Wanx)。",
            code="local_video_runtime_not_installed",
        )
```
若 `connectors/video_gen/__init__.py` 显式列举子模块，把 `from . import local_stub  # noqa` 加进去保证注册生效。

- [ ] **Step 4: 跑测试确认通过**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_local_video_stub.py
```
Expected: PASS。

---

## Task F1: 前端 ModelType 加 `text2video`

**Files:**
- Modify: `chayuan-client/packages/app/src/features/marketplace/lib/modelTypes.ts`（line 27-128）

- [ ] **Step 1: 加联合类型成员**

`ModelType` 联合加 `| 'text2video'`；`ModelField` 联合加 `| 'text2video_models'`。

- [ ] **Step 2: 加 MODEL_TYPES 条目 + 图标 import**

文件顶部 lucide import 加 `Video`（若未引入）。`MODEL_TYPES` 数组里，`text2image` 条目之后加：
```typescript
  {
    key: 'text2video',
    field: 'text2video_models',
    i18nKey: 'modelMarket.capability.text2video',
    icon: Video,
    hue: 300,
    prominent: true,
  },
```

- [ ] **Step 3: 加 i18n 文案**

找到 `modelMarket.capability.text2image` 的 i18n 定义文件（`grep -rn "modelMarket.capability.text2image" chayuan-client/packages/app/src`），照它给 `modelMarket.capability.text2video` 补 `label`/`long`/`hint`（中/英/日/法等已有语言都补；至少中英）：中文 label「视频生成」、long「文生 / 图生视频」、hint「文本或首帧图生成视频(如百炼 Wanx)」。

- [ ] **Step 4: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
```
Expected: 0 error（注意 apps/web 的 installer-core 测试有既有无关报错，区分）。

---

## Task F2: 前端 PlatformConfig/ProviderCatalogEntry 加 `text2video_models`

**Files:**
- Modify: `chayuan-client/packages/api/src/modelPlatform.ts`（`PlatformConfig` line 28-58、`ProviderCatalogEntry` line 83-132）

- [ ] **Step 1: 加字段**

`PlatformConfig` 在 `text2image_models: string[];` 之后加：
```typescript
  text2video_models: string[];
```
`ProviderCatalogEntry` 主字段同样在 `text2image_models: string[];` 之后加 `text2video_models: string[];`；其 `default_models?: Partial<{...}>` 里也加 `text2video_models: string[];`。

- [ ] **Step 2: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
```
Expected: 0 error。若有「缺 text2video_models」类型报错，是因为别处构造这些对象的字面量缺字段 —— 按报错给那些字面量补 `text2video_models: []`（grep `text2image_models:` 找同款字面量位置）。

---

## Task F3: 前端 aiVideo API（提交 + SSE）

**Files:**
- Create: `chayuan-client/packages/api/src/aiVideo.ts`
- Modify: `chayuan-client/packages/api/src/index.ts`（导出 aiVideo，确认现有 barrel 写法后追加）
- Test: 无组件测试框架，靠 typecheck

**实现前先读**：`packages/api/src/videoGeneration.ts` 的 `vgSubscribeTaskEvents`（SSE 模板，line 510-582）、`getClientConfig`/`getAccessToken`/`getPlatform().net.fetch` 用法；以及 modality SSE 的 v5 事件形状 `chayuan-server/.../modality/router/sse_v5.py`（事件 dict 形如 `{type:'file', mediaType, url}` / 进度 / `{type:'error',errorText}` / finish）。

- [ ] **Step 1: 写 aiVideo.ts**

```typescript
import { getClientConfig, getAccessToken } from './config';
import { getPlatform } from '@chayuan/platform-shared';

export interface AiVideoParams {
  /** `platform::model` 形式或裸 model 名 */
  model: string;
  prompt: string;
  /** 图生视频:首帧图(base64,不含 data: 前缀) */
  imageB64?: string | null;
  imageMime?: string | null;
  /** 透传到上游的生成参数(duration/resolution/ratio/seed 等) */
  modalityParams?: Record<string, unknown>;
}

export interface AiVideoEventHandlers {
  onProgress?(percent: number): void;
  onVideo(url: string): void;
  onError?(err: Error): void;
  onDone?(): void;
}

/** 提交并订阅 modality SSE(v5 事件)。提交即流式,不分两步。 */
export async function aiVideoGenerate(
  params: AiVideoParams,
  handlers: AiVideoEventHandlers,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const cfg = getClientConfig();
  const url = `${(cfg.baseURL || '').replace(/\/+$/, '')}/v1/modality/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if ((cfg.authMode ?? 'bearer') === 'bearer') {
    const tok = await getAccessToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }
  const extraBody: Record<string, unknown> = { modality_params: params.modalityParams ?? {} };
  if (params.imageB64) {
    extraBody.modality_attachments = [
      { mime: params.imageMime ?? 'image/png', data_b64: params.imageB64 },
    ];
  }
  const body = JSON.stringify({
    model: params.model,
    messages: [{ role: 'user', content: params.prompt }],
    extra_body: extraBody,
  });
  const res = await getPlatform().net.fetch(url, {
    method: 'POST', headers, body, signal: opts.signal,
    credentials: cfg.authMode === 'cookie' ? 'include' : 'same-origin',
  } as RequestInit);
  if (!res.ok || !res.body) throw new Error(`ai-video HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (opts.signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLines: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        if (!dataLines.length) continue;
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(dataLines.join('\n')); } catch { continue; }
        const type = ev.type as string | undefined;
        if (type === 'file' || type === 'file-part') {
          const media = (ev.mediaType ?? ev.mime ?? '') as string;
          const fileUrl = (ev.url ?? ev.data) as string | undefined;
          if (media.startsWith('video/') && fileUrl) handlers.onVideo(fileUrl);
        } else if (type === 'error') {
          handlers.onError?.(new Error((ev.errorText as string) ?? 'generation error'));
        } else if (typeof ev.progress === 'number') {
          handlers.onProgress?.(ev.progress as number);
        }
      }
    }
    handlers.onDone?.();
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

/** 列出所有已配置的文生视频模型(跨 provider),返回 `platform::model` 列表。 */
export async function aiVideoListModels(): Promise<Array<{ platform: string; model: string }>> {
  const { listProviders } = await import('./providers');
  const providers = await listProviders();
  const out: Array<{ platform: string; model: string }> = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.text2video_models ?? []) {
      out.push({ platform: p.platform_name ?? p.pid, model: m });
    }
  }
  return out;
}
```
⚠️ v5 事件字段名(`type`/`mediaType`/`url`/`progress`/`errorText`)以 `sse_v5.py` 实际为准，实现时核对后修正解析分支。`listProviders` 的真实函数名/返回类型以 `providers.ts` 为准（实现时核对，必要时改用 `getProviderCatalog` 之类）。

- [ ] **Step 2: barrel 导出 + typecheck**

`packages/api/src/index.ts` 追加 `export * from './aiVideo';`（确认现有导出风格）。
```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
```
Expected: 0 error。

---

## Task F4: 「AI 视频生成」页 + 路由 + 入口

**Files:**
- Create: `chayuan-client/packages/app/src/features/ai-video/AiVideoPage.tsx`
- Modify: 路由注册（先 `grep -rn "video-generation" chayuan-client/packages/app/src/router` 找路由表写法，照样加 `/ai-video`）
- Modify: `chayuan-client/packages/app/src/features/shell/Sidebar.tsx`（`NAV_ITEMS` line 74-82 加入口）
- Modify: i18n（加 `nav.aiVideo` 文案）

**实现前先读**：`RenderProgressCard.tsx`（进度卡风格）、一个现有 page 组件（布局/容器约定）、路由表文件、`useUsageGate` 用法（`VgChatPage.tsx` line 40）。

- [ ] **Step 1: 写 AiVideoPage.tsx**

页面状态机：选模型(下拉，来自 `aiVideoListModels`) + 提示词 textarea + 可选首帧图上传(转 base64) + 参数(时长/分辨率/比例的简单下拉) + 「生成」按钮（先 `useUsageGate('video')` 校验）→ 调 `aiVideoGenerate`，用 `onProgress` 驱动进度条、`onVideo` 拿到 url 后 `<video controls src>` + 下载按钮、`onError` 显示错误。组件骨架：
```tsx
import * as React from 'react';
import { aiVideoGenerate, aiVideoListModels } from '@chayuan/api';
import { useUsageGate } from '../license/useUsageGate'; // 路径以实际为准
// ... UI 组件 import (Button/Input/Select 等 from '@chayuan/ui')

export const AiVideoPage: React.FC = () => {
  const [models, setModels] = React.useState<Array<{ platform: string; model: string }>>([]);
  const [model, setModel] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [imageB64, setImageB64] = React.useState<string | null>(null);
  const [imageMime, setImageMime] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState(5);
  const [resolution, setResolution] = React.useState('720P');
  const [ratio, setRatio] = React.useState('16:9');
  const [progress, setProgress] = React.useState<number | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const gate = useUsageGate('video');

  React.useEffect(() => {
    aiVideoListModels().then((ms) => {
      setModels(ms);
      if (ms.length && !model) setModel(`${ms[0].platform}::${ms[0].model}`);
    }).catch(() => setModels([]));
  }, []); // eslint-disable-line

  const onPickImage = async (file: File) => {
    const buf = await file.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    setImageB64(btoa(bin));
    setImageMime(file.type || 'image/png');
  };

  const onGenerate = async () => {
    if (!model || !prompt.trim()) return;
    if (!(await gate.ensure())) return; // 按次门控,具体 API 以 useUsageGate 实际为准
    setBusy(true); setErr(null); setVideoUrl(null); setProgress(0);
    try {
      await aiVideoGenerate(
        { model, prompt: prompt.trim(), imageB64, imageMime,
          modalityParams: { duration, resolution, ratio } },
        { onProgress: setProgress,
          onVideo: (u) => setVideoUrl(u),
          onError: (e) => setErr(e.message),
          onDone: () => setBusy(false) },
      );
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (/* 布局:左表单(模型/提示词/传图/参数/生成按钮) 右结果(进度条 → video + 下载) */ null);
};
```
（JSX 布局按项目现有 page 风格补全：用 `var(--cy-*)` 主题变量、`@chayuan/ui` 控件、参考 `RenderProgressCard` 的进度态。`useUsageGate` 的具体方法名以源码为准。）

- [ ] **Step 2: 注册路由 `/ai-video`**

照路由表现有条目（如 `/video-generation`）加 `/ai-video` → `AiVideoPage`。

- [ ] **Step 3: 侧边栏入口**

`Sidebar.tsx` `NAV_ITEMS` 加（图标从已 import 的 lucide 选 `Clapperboard`/`Video`，没有则补 import）：
```typescript
  { to: '/ai-video', labelKey: 'nav.aiVideo', icon: Clapperboard },
```
i18n 加 `nav.aiVideo`（中「AI 视频生成」/英「AI Video」）。

- [ ] **Step 4: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
```
Expected: 0 error。

---

## Task V1: 整体验收

- [ ] **Step 1: 后端全量相关测试 + 编译**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_text2video_config.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_wan2_routing.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_dashscope_i2v.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_local_video_stub.py
```
Expected: 全 PASS。

- [ ] **Step 2: 前端 typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
```
Expected: 0 error。

- [ ] **Step 3: 重建 desktop + 重启 sidecar 后人工实测**

- 模型厂商页 → 百炼 → 出现「视频生成」栏，可填 `wan2.7-t2v`/`wan2.6-i2v` 并展示（需先配百炼 API key）。
- 侧边栏「AI 视频生成」→ 选 Wanx 模型 + 输入提示词 → 生成 → 进度推进 → 出片可播放/下载。
- 图生视频：上传首帧图 + 选 `wan2.6-i2v` → 出片。
- 配 `local-*` 模型(若有)调用 → 报「本地视频模型运行时尚未安装(P4)」明确错误。

---

## Self-Review（已核对 spec）

- **Spec 覆盖**：配置面打通→B1+F1+F2；Wanx `wan2` 路由→B2；I2V→B3；local 桩→B4；使用入口→F3+F4；按次计费→F4(useUsageGate)。基类抽取/配置路由按 YAGNI 明确推迟 P2(已在头部说明)。
- **占位扫描**：代码步均给完整代码；少数「实现前先读 + 以实际为准」是既有大代码库不可避免的核对点(v5 事件字段、useUsageGate/listProviders 真实签名)，已具体指明读哪个文件、测试锁行为，非 TODO 占位。
- **类型一致**：`text2video_models` 字段名后端/前端统一；`aiVideoGenerate`/`aiVideoListModels` 在 F3 定义、F4 使用一致；`_build_submit_payload` 在 B3 定义并测试。
- **风险**：外部模型名/endpoint 实现时核对官方文档；DashScope `img_url` 接受形式需确认；v5 事件字段需对 `sse_v5.py` 核对。

# 文生视频接入 P2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽出异步视频连接器基类 `AsyncPollVideoConnector`（DashScope 重构进它）、加「能力按配置路由」、新增 Kling(JWT) 连接器作第二家验证整套。

**Architecture:** 把 `DashScopeT2VConnector` 的「提交→轮询→下载+进度+续传」循环抽成基类，子类只实现 4 个钩子（build_submit/parse_submit/build_poll/parse_poll）；路由层在前缀分类前先按 platform 的 `*_models` 配置判 capability；Kling 子类加 ak/sk→JWT 鉴权。

**Tech Stack:** Python(FastAPI/httpx/PyJWT 2.8/pytest)、现有 modality 网关(Connector/register/sse_v5/TaskManager)。

**P2a 范围：** 仅地基 + Kling 一家。海螺/Vidu/智谱/Seedance/Runway 放 P2b。

**验证约定：** ⚠️ **本沙箱无 py312、跑不了 pytest**（系统 python 3.6.8）。每个后端任务：写代码 + 写测试，只做 `ast.parse` 语法自检，**pytest 留用户 py312 机器跑**，如实报告未运行。**不自动 commit/push**。仓库 root 所有、目标目录已 chown 给 admin 可直接编辑。

仓库根 `/work/chayuan-desktop`，服务端包根 `chayuan-server/libs/chayuan-server`，连接器目录 `chayuan/server/modality/router/connectors/video_gen/`。

---

## File Structure

- `connectors/video_gen/base_async.py` — 新建：`PollStatus`/`PollResult`/`AsyncPollVideoConnector` 基类。
- `connectors/video_gen/dashscope.py` — 修改：`DashScopeT2VConnector` 改继承基类、实现 4 钩子。
- `connectors/video_gen/kling.py` — 新建：`KlingVideoConnector` + JWT。
- `connectors/video_gen/__init__.py` — 修改：import kling。
- `modality/router/routing.py` — 新建：`capability_from_config` helper。
- `api_server/openai_routes.py` — 修改：`create_modality_completion` 用配置优先判 capability。
- `config_panel/model_config.py` — 修改：加 kling 厂商目录。
- `tests/unit_tests/test_async_video_base.py` / `test_dashscope_video_refactor.py` / `test_capability_from_config.py` / `test_kling_connector.py` / `test_kling_provider_catalog.py` — 新建测试。

---

## Task T1: 抽 `AsyncPollVideoConnector` 基类

**Files:**
- Create: `chayuan/server/modality/router/connectors/video_gen/base_async.py`
- Test: `tests/unit_tests/test_async_video_base.py`

**实现前先读：** `connectors/video_gen/dashscope.py` 全文（`generate`/`resume`/`_poll_and_download` 的完整循环、`error_event`/`text_start`/`text_delta`/`text_end`/`data_part`/`file_part`/`finish_step_event` 的 import、artifacts 落盘怎么写、`req.cancelled.is_set()`、超时/状态机/进度估算）。基类要把这套循环原样泛化。

- [ ] **Step 1: 写失败测试**

新建 `tests/unit_tests/test_async_video_base.py`：
```python
import pytest
from chayuan.server.modality.router.protocol import GenerateReq, Capability
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector, PollResult, PollStatus,
)


class _FakeConn(AsyncPollVideoConnector):
    poll_interval_s = 0.0
    poll_timeout_s = 5.0

    def build_submit(self, req):
        return ("http://x/submit", {}, {"prompt": req.prompt})

    def parse_submit(self, resp_json):
        return "task-123"

    def build_poll(self, req, task_id):
        return (f"http://x/{task_id}", {})

    def parse_poll(self, resp_json):
        # 第一次 RUNNING、第二次 SUCCEEDED（由 _seq 控制）
        self._n = getattr(self, "_n", 0) + 1
        if self._n < 2:
            return PollResult(status=PollStatus.RUNNING, percent=50)
        return PollResult(status=PollStatus.SUCCEEDED, video_urls=["http://x/v.mp4"])


def _req():
    return GenerateReq(capability=Capability.T2V, model="fake", platform_name="p",
                       platform_type="p", api_base="http://x", api_key="k", prompt="hi")


@pytest.mark.asyncio
async def test_poll_loop_emits_file_and_finish(monkeypatch):
    # 打桩 HTTP 提交/轮询 + 视频下载,只验证循环产出事件序列
    import chayuan.server.modality.router.connectors.video_gen.base_async as m

    async def _fake_post(self, url, **kw):  # submit
        class R: status_code = 200
        def _json(): return {}
        R.json = staticmethod(_json); return R()

    async def _fake_get(self, url, **kw):  # poll
        class R: status_code = 200
        def _json(): return {}
        R.json = staticmethod(_json); return R()

    monkeypatch.setattr("httpx.AsyncClient.post", _fake_post)
    monkeypatch.setattr("httpx.AsyncClient.get", _fake_get)
    # 视频下载打桩成固定 bytes
    monkeypatch.setattr(m, "_download_bytes", lambda url: b"FAKEMP4", raising=False)
    # artifacts 落盘打桩
    monkeypatch.setattr(m, "save_bytes", lambda b, mime: {"url": "/v1/artifacts/x.mp4", "sha256": "h"}, raising=False)

    evs = [ev async for ev in _FakeConn().generate(_req())]
    types = [e.get("type") for e in evs]
    assert "file" in types
    assert any(e.get("type") == "file" and e.get("mediaType", "").startswith("video/") for e in evs)
    assert "finish-step" in types
```
（`save_bytes`/`_download_bytes` 的真实名字/位置以你在 base_async.py 里采用的为准；测试 monkeypatch 目标对齐你的实现。pytest-asyncio 项目 `asyncio_mode="auto"`，无需装饰器——照同目录 async 测试。）

- [ ] **Step 2: 跑测试确认失败（语法/导入层）**

```bash
cd /work/chayuan-desktop
python -c "import ast; ast.parse(open('chayuan-server/libs/chayuan-server/tests/unit_tests/test_async_video_base.py').read()); print('test ast OK')"
```
（pytest 跑不了；fail 体现在 base_async 模块还不存在。）

- [ ] **Step 3: 写基类**

新建 `base_async.py`（把 dashscope 的循环泛化；下面是骨架，**下载/落盘/进度估算/取消/超时的具体实现照 dashscope.py 现有逻辑搬，保持等价**）：
```python
"""异步轮询型视频连接器基类。

把「提交→轮询→下载产物+进度+续传」的公共循环抽出,子类只实现 4 个钩子:
  build_submit(req) -> (url, headers, body)
  parse_submit(resp_json) -> upstream_task_id
  build_poll(req, task_id) -> (url, headers)
  parse_poll(resp_json) -> PollResult
DashScope / Kling / (P2b)海螺/Vidu/智谱/Seedance/Runway 都继承它。
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator, Dict, List, Optional, Tuple

import httpx

from chayuan.server.modality.router.artifacts import save_bytes
from chayuan.server.modality.router.connectors.base import Connector
from chayuan.server.modality.router.protocol import GenerateReq
from chayuan.server.modality.router.sse_v5 import (
    data_part, error_event, file_part, finish_step_event, text_delta, text_end, text_start,
)


class PollStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"
    UNKNOWN = "unknown"


@dataclass
class PollResult:
    status: PollStatus
    percent: Optional[int] = None
    video_urls: List[str] = field(default_factory=list)
    error_message: Optional[str] = None


class AsyncPollVideoConnector(Connector):
    poll_interval_s: float = 5.0
    poll_timeout_s: float = 600.0
    media_type: str = "video/mp4"

    # ── 子类必须实现的 4 个钩子 ──
    def build_submit(self, req: GenerateReq) -> Tuple[str, Dict[str, str], Dict]:
        raise NotImplementedError

    def parse_submit(self, resp_json: Dict) -> str:
        raise NotImplementedError

    def build_poll(self, req: GenerateReq, task_id: str) -> Tuple[str, Dict[str, str]]:
        raise NotImplementedError

    def parse_poll(self, resp_json: Dict) -> PollResult:
        raise NotImplementedError

    # ── 公共流程 ──
    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        prompt = (req.prompt or "").strip()
        if not prompt:
            yield error_event("视频生成需要输入提示词描述", code="empty_prompt")
            return
        tid = "t0"
        yield text_start(tid)
        yield text_delta(tid, "视频生成中,约需 30-120 秒,可关闭窗口稍后回来…")
        yield text_end(tid)
        yield data_part("task-progress", {"percent": 2, "message": "提交任务"})

        url, headers, body = self.build_submit(req)
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                resp = await client.post(url, json=body, headers=headers)
            except httpx.RequestError as e:
                yield error_event(f"无法连接视频接口: {e}", code="upstream_unreachable")
                return
            if resp.status_code not in (200, 201):
                yield error_event(f"上游 {resp.status_code}: {resp.text[:300]}", code=f"upstream_{resp.status_code}")
                return
            try:
                task_id = self.parse_submit(resp.json())
            except Exception as e:  # noqa: BLE001
                yield error_event(f"解析提交响应失败: {e}", code="bad_submit_resp")
                return
            if not task_id:
                yield error_event("上游未返回 task_id", code="no_task_id")
                return
            yield data_part("task-progress", {"percent": 5, "message": "任务已排队", "task_id": task_id})
            async for ev in self._poll_loop(client, req, task_id):
                yield ev

    async def resume(self, req: GenerateReq, upstream_task_id: str) -> AsyncIterator[Dict]:
        tid = "t0"
        yield text_start(tid)
        yield text_delta(tid, f"接回中断的视频任务({upstream_task_id})…")
        yield text_end(tid)
        yield data_part("task-progress", {"percent": 5, "message": "继续轮询", "task_id": upstream_task_id})
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async for ev in self._poll_loop(client, req, upstream_task_id):
                yield ev

    async def _poll_loop(self, client: httpx.AsyncClient, req: GenerateReq, task_id: str) -> AsyncIterator[Dict]:
        started = time.monotonic()
        while True:
            if req.cancelled is not None and req.cancelled.is_set():
                yield error_event("用户已取消(上游任务可能继续跑完)", code="cancelled")
                return
            if time.monotonic() - started > self.poll_timeout_s:
                yield error_event("视频生成超时", code="poll_timeout")
                return
            url, headers = self.build_poll(req, task_id)
            try:
                r = await client.get(url, headers=headers)
                pr = self.parse_poll(r.json())
            except Exception as e:  # noqa: BLE001
                yield error_event(f"轮询失败: {e}", code="poll_error")
                return
            pct = pr.percent if pr.percent is not None else _estimate_percent(time.monotonic() - started, pr.status.value)
            yield data_part("task-progress", {"percent": pct, "message": pr.status.value, "task_id": task_id})
            if pr.status == PollStatus.SUCCEEDED:
                if not pr.video_urls:
                    yield error_event("上游成功但未返回视频地址", code="no_video_url")
                    return
                try:
                    raw = await _download_bytes(client, pr.video_urls[0])
                    saved = save_bytes(raw, self.media_type)
                except Exception as e:  # noqa: BLE001
                    yield error_event(f"下载视频失败: {e}", code="download_failed")
                    return
                yield file_part(self.media_type, saved["url"], {"upstream_task_id": task_id})
                yield text_start("t1"); yield text_end("t1")
                yield finish_step_event()
                return
            if pr.status in (PollStatus.FAILED, PollStatus.CANCELED):
                yield error_event(pr.error_message or "视频生成失败", code="upstream_failed")
                return
            await asyncio.sleep(self.poll_interval_s)


def _estimate_percent(elapsed_s: float, status: str) -> int:
    # 与 dashscope 现有 _estimate_percent 等价(读 dashscope.py 后对齐),这里给个保底线性估算
    base = min(90, 10 + int(elapsed_s / 3))
    return base


async def _download_bytes(client: httpx.AsyncClient, url: str) -> bytes:
    r = await client.get(url)
    r.raise_for_status()
    return r.content
```
⚠️ `save_bytes` 的真实模块路径、`_estimate_percent` 的真实算法、下载落盘的真实写法**以 dashscope.py 现有实现为准**，对齐后再定稿（别让 DashScope 行为变样）。

- [ ] **Step 4: 语法自检**

```bash
cd /work/chayuan-desktop
python -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/base_async.py','chayuan-server/libs/chayuan-server/tests/unit_tests/test_async_video_base.py']]; print('ast.parse OK')"
```
Expected: `ast.parse OK`。

完成报告：状态、`save_bytes`/`_estimate_percent`/下载在 dashscope 里真实长啥样、你怎么对齐、ast 结果、**pytest 未运行**。

---

## Task T2: DashScope 重构进基类

**Files:**
- Modify: `connectors/video_gen/dashscope.py`
- Test: `tests/unit_tests/test_dashscope_video_refactor.py`

**实现前先读：** dashscope.py 全文 + T1 写好的 `base_async.py`。

- [ ] **Step 1: 写测试**

新建 `tests/unit_tests/test_dashscope_video_refactor.py`：
```python
from chayuan.server.modality.router.protocol import GenerateReq, Capability, Attachment
from chayuan.server.modality.router.connectors.video_gen.dashscope import DashScopeT2VConnector
from chayuan.server.modality.router.connectors.video_gen.base_async import PollStatus


def _req(att=None):
    return GenerateReq(capability=Capability.T2V, model="wan2.7-t2v", platform_name="bailian",
                       platform_type="openai", api_base="https://dashscope.aliyuncs.com",
                       api_key="k", prompt="跳舞的猫", attachments=att or [])


def test_build_submit_t2v_and_i2v():
    c = DashScopeT2VConnector()
    url, headers, body = c.build_submit(_req())
    assert "video-synthesis" in url
    assert headers.get("X-DashScope-Async") == "enable"
    assert "img_url" not in body["input"]
    _u, _h, body2 = c.build_submit(_req([Attachment(mime="image/png", url="http://x/a.png", name="a")]))
    assert body2["input"]["img_url"] == "http://x/a.png"


def test_parse_submit_and_poll():
    c = DashScopeT2VConnector()
    assert c.parse_submit({"output": {"task_id": "t-1"}}) == "t-1"
    ok = c.parse_poll({"output": {"task_status": "SUCCEEDED", "video_url": "http://x/v.mp4"}})
    assert ok.status == PollStatus.SUCCEEDED and ok.video_urls == ["http://x/v.mp4"]
    bad = c.parse_poll({"output": {"task_status": "FAILED", "message": "boom"}})
    assert bad.status == PollStatus.FAILED and "boom" in (bad.error_message or "")
```

- [ ] **Step 2: 语法自检失败态**

```bash
cd /work/chayuan-desktop && python -c "import ast; ast.parse(open('chayuan-server/libs/chayuan-server/tests/unit_tests/test_dashscope_video_refactor.py').read()); print('test ast OK')"
```

- [ ] **Step 3: 重构**

把 `DashScopeT2VConnector` 改为 `class DashScopeT2VConnector(AsyncPollVideoConnector)`（import base_async 的基类），删掉自己的 `generate`/`resume`/`_poll_and_download`，改为实现 4 钩子：
- `build_submit(req)`：`submit_url, _ = _build_endpoints(req.api_base)`；headers = Bearer + `X-DashScope-Async: enable` + Content-Type；body = `self._build_submit_payload(req)`（**保留现有 `_build_submit_payload`**，含 I2V）。返回 `(submit_url, headers, body)`。
- `parse_submit(resp)`：`(resp.get("output") or {}).get("task_id")`。
- `build_poll(req, task_id)`：`_, tasks_prefix = _build_endpoints(req.api_base)`；return `(f"{tasks_prefix}/{task_id}", {"Authorization": f"Bearer {req.api_key}"})`。
- `parse_poll(resp)`：读 `output.task_status`，映射 PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED→`PollStatus`，SUCCEEDED 取 `output.video_url` 进 `video_urls`，FAILED 取 `output.message` 进 `error_message`。
保留 `@register(Capability.T2V, "dashscope")`、`_build_submit_payload`、`_build_endpoints`/`_normalize_size`/`_estimate_percent`（`_estimate_percent` 若基类已用同款可删本地、否则保留并让基类用——实现时统一一处避免重复）。

- [ ] **Step 4: 语法自检**

```bash
cd /work/chayuan-desktop && python -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/dashscope.py','chayuan-server/libs/chayuan-server/tests/unit_tests/test_dashscope_video_refactor.py']]; print('ast.parse OK')"
```
Expected: `ast.parse OK`。

完成报告：状态、删了哪些方法/留了哪些、`_estimate_percent` 去重情况、ast 结果、pytest 未运行。**强调 DashScope 行为应与 P1 完全等价。**

---

## Task T3: 能力按配置路由

**Files:**
- Create: `chayuan/server/modality/router/routing.py`
- Modify: `chayuan/server/api_server/openai_routes.py`（`create_modality_completion`）
- Test: `tests/unit_tests/test_capability_from_config.py`

**实现前先读：** `protocol.py` 的 `classify_capability` + `Capability`；`openai_routes.py` 的 `create_modality_completion`（`cap=classify_capability(...)` 与 `get_model_info(...)` 那几行）；`get_model_info` 返回结构 + 怎么从 model_platform 仓库拿某 platform 的各 `*_models` 列表（grep `get_config_models`/`model_platform` 仓库）。

- [ ] **Step 1: 写测试**

新建 `tests/unit_tests/test_capability_from_config.py`：
```python
from chayuan.server.modality.router.routing import capability_from_config
from chayuan.server.modality.router.protocol import Capability


def _platform(**lists):
    base = {"llm_models": [], "embed_models": [], "rerank_models": [],
            "text2image_models": [], "text2video_models": [], "image2text_models": [],
            "speech2text_models": [], "text2speech_models": []}
    base.update(lists)
    return base


def test_text2video_model_maps_to_t2v():
    p = _platform(text2video_models=["my-custom-video-1"])
    assert capability_from_config("my-custom-video-1", p) == Capability.T2V


def test_unmatched_returns_none():
    p = _platform(llm_models=["foo"])
    assert capability_from_config("bar", p) is None


def test_text2image_maps_to_t2i():
    p = _platform(text2image_models=["img-x"])
    assert capability_from_config("img-x", p) == Capability.T2I
```

- [ ] **Step 2: 语法自检失败态**

```bash
cd /work/chayuan-desktop && python -c "import ast; ast.parse(open('chayuan-server/libs/chayuan-server/tests/unit_tests/test_capability_from_config.py').read()); print('test ast OK')"
```

- [ ] **Step 3: 写 helper**

新建 `routing.py`：
```python
"""能力按配置路由:模型被配进某 platform 的 *_models 列表时,据字段判 capability。

配置优先、前缀兜底:create_modality_completion 先调本函数,返回 None 再退回 classify_capability。
"""
from __future__ import annotations

from typing import Dict, Optional

from chayuan.server.modality.router.protocol import Capability

# platform 配置字段 → capability
_FIELD_TO_CAP = {
    "text2video_models": Capability.T2V,
    "text2image_models": Capability.T2I,
    "image2text_models": Capability.VL,
    "rerank_models": Capability.RERANK,
    "embed_models": Capability.EMBEDDING,
    "speech2text_models": Capability.ASR,
    "text2speech_models": Capability.TTS,
    "llm_models": Capability.CHAT,
}


def capability_from_config(model: str, platform: Optional[Dict]) -> Optional[Capability]:
    if not model or not platform:
        return None
    name = model.split("::", 1)[1] if "::" in model else model
    for field, cap in _FIELD_TO_CAP.items():
        vals = platform.get(field)
        if isinstance(vals, list) and name in vals:
            return cap
    return None
```

- [ ] **Step 4: 接入路由**

在 `create_modality_completion` 里：拿到 `info = get_model_info(...)` 后，取得该 platform 的各 `*_models` 列表（`info` 若没带，则用 model_platform 仓库按 `info["platform_name"]` 多查一次配置，得到含 `text2video_models` 等的 dict），然后：
```python
from chayuan.server.modality.router.routing import capability_from_config
cap = capability_from_config(actual_model, platform_cfg) or classify_capability(actual_model)
```
替换原来的 `cap = classify_capability(actual_model)`。**未命中配置时行为与现在完全一致。** `platform_cfg` 怎么取以仓库实际 API 为准（实现时核对，避免循环 import）。

- [ ] **Step 5: 语法自检**

```bash
cd /work/chayuan-desktop && python -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan-server/libs/chayuan-server/chayuan/server/modality/router/routing.py','chayuan-server/libs/chayuan-server/chayuan/server/api_server/openai_routes.py','chayuan-server/libs/chayuan-server/tests/unit_tests/test_capability_from_config.py']]; print('ast.parse OK')"
```
Expected: `ast.parse OK`。

完成报告：状态、`get_model_info` 到底带不带模型列表 / 你用哪个仓库 API 取 platform 配置、ast 结果、pytest 未运行。

---

## Task T4: Kling 连接器

**Files:**
- Create: `connectors/video_gen/kling.py`
- Modify: `connectors/video_gen/__init__.py`
- Test: `tests/unit_tests/test_kling_connector.py`

**实现前先读：** `base_async.py`（钩子签名）、dashscope.py（参照风格）、`protocol.py` 的 `Attachment`。KlingAI 官方文档（endpoint/字段/状态串实现时核对）。

- [ ] **Step 1: 写测试**

新建 `tests/unit_tests/test_kling_connector.py`：
```python
import jwt
from chayuan.server.modality.router.protocol import GenerateReq, Capability, Attachment
from chayuan.server.modality.router.connectors.video_gen.kling import KlingVideoConnector, _kling_jwt
from chayuan.server.modality.router.connectors.video_gen.base_async import PollStatus


def test_kling_jwt_carries_ak():
    tok = _kling_jwt("AK123", "SK456")
    payload = jwt.decode(tok, options={"verify_signature": False})
    assert payload["iss"] == "AK123"
    assert "exp" in payload


def _req(att=None, key="AK123:SK456"):
    return GenerateReq(capability=Capability.T2V, model="kling-v2-5-turbo", platform_name="kling",
                       platform_type="kling", api_base="https://api.klingai.com", api_key=key,
                       prompt="跳舞的猫", attachments=att or [])


def test_build_submit_t2v_vs_i2v():
    c = KlingVideoConnector()
    url, headers, body = c.build_submit(_req())
    assert url.endswith("/v1/videos/text2video")
    assert headers["Authorization"].startswith("Bearer ")
    assert body["model_name"] == "kling-v2-5-turbo"
    assert "image" not in body
    url2, _h, body2 = c.build_submit(_req([Attachment(mime="image/png", url="http://x/a.png", name="a")]))
    assert url2.endswith("/v1/videos/image2video")
    assert body2.get("image") == "http://x/a.png"


def test_parse_poll_status_mapping():
    c = KlingVideoConnector()
    assert c.parse_poll({"data": {"task_status": "processing"}}).status == PollStatus.RUNNING
    ok = c.parse_poll({"data": {"task_status": "succeed", "task_result": {"videos": [{"url": "http://x/v.mp4"}]}}})
    assert ok.status == PollStatus.SUCCEEDED and ok.video_urls == ["http://x/v.mp4"]
    assert c.parse_poll({"data": {"task_status": "failed", "task_status_msg": "bad"}}).status == PollStatus.FAILED
```

- [ ] **Step 2: 语法自检失败态**

```bash
cd /work/chayuan-desktop && python -c "import ast; ast.parse(open('chayuan-server/libs/chayuan-server/tests/unit_tests/test_kling_connector.py').read()); print('test ast OK')"
```

- [ ] **Step 3: 写 Kling 连接器**

新建 `kling.py`：
```python
"""快手 Kling 可灵 文生/图生视频 Connector — JWT(ak/sk) 鉴权,异步轮询。

api_key 字段约定填 "<AccessKey>:<SecretKey>"(英文冒号)。
# TODO(P2-verify): endpoint / 字段 / 状态串以 KlingAI 当前官方文档实测核对。
"""
from __future__ import annotations

import time
from typing import Dict, Tuple

import jwt

from chayuan.server.modality.router.connectors.base import register
from chayuan.server.modality.router.connectors.video_gen.base_async import (
    AsyncPollVideoConnector, PollResult, PollStatus,
)
from chayuan.server.modality.router.protocol import Capability, GenerateReq

_DEFAULT_BASE = "https://api.klingai.com"
_RUNNING = {"submitted", "processing", "pending"}


def _kling_jwt(ak: str, sk: str) -> str:
    now = int(time.time())
    payload = {"iss": ak, "exp": now + 1800, "nbf": now - 5}
    return jwt.encode(payload, sk, algorithm="HS256", headers={"alg": "HS256", "typ": "JWT"})


def _split_keys(api_key: str) -> Tuple[str, str]:
    if ":" in (api_key or ""):
        ak, sk = api_key.split(":", 1)
        return ak.strip(), sk.strip()
    return (api_key or "").strip(), ""


@register(Capability.T2V, "kling")
class KlingVideoConnector(AsyncPollVideoConnector):
    poll_interval_s = 5.0
    poll_timeout_s = 600.0

    def _base(self, req: GenerateReq) -> str:
        return (req.api_base or "").rstrip("/") or _DEFAULT_BASE

    def _headers(self, req: GenerateReq) -> Dict[str, str]:
        ak, sk = _split_keys(req.api_key)
        return {"Authorization": f"Bearer {_kling_jwt(ak, sk)}", "Content-Type": "application/json"}

    def _is_i2v(self, req: GenerateReq) -> bool:
        return any((getattr(a, "mime", "") or "").startswith("image/") for a in (req.attachments or []))

    def _kind(self, req: GenerateReq) -> str:
        return "image2video" if self._is_i2v(req) else "text2video"

    def build_submit(self, req: GenerateReq) -> Tuple[str, Dict[str, str], Dict]:
        params = req.params or {}
        body: Dict = {"model_name": req.model, "prompt": req.prompt}
        if self._is_i2v(req):
            for a in req.attachments:
                if (getattr(a, "mime", "") or "").startswith("image/"):
                    body["image"] = a.url
                    break
        for k_src, k_dst in (("duration", "duration"), ("aspect_ratio", "aspect_ratio"), ("mode", "mode"), ("negative_prompt", "negative_prompt")):
            if params.get(k_src) is not None:
                body[k_dst] = params[k_src]
        url = f"{self._base(req)}/v1/videos/{self._kind(req)}"
        return url, self._headers(req), body

    def parse_submit(self, resp_json: Dict) -> str:
        return ((resp_json or {}).get("data") or {}).get("task_id") or ""

    def build_poll(self, req: GenerateReq, task_id: str) -> Tuple[str, Dict[str, str]]:
        url = f"{self._base(req)}/v1/videos/{self._kind(req)}/{task_id}"
        return url, self._headers(req)

    def parse_poll(self, resp_json: Dict) -> PollResult:
        data = (resp_json or {}).get("data") or {}
        st = (data.get("task_status") or "").lower()
        if st == "succeed":
            vids = ((data.get("task_result") or {}).get("videos")) or []
            urls = [v.get("url") for v in vids if v.get("url")]
            return PollResult(status=PollStatus.SUCCEEDED, video_urls=urls)
        if st == "failed":
            return PollResult(status=PollStatus.FAILED, error_message=data.get("task_status_msg") or "Kling 生成失败")
        if st in _RUNNING:
            return PollResult(status=PollStatus.RUNNING)
        return PollResult(status=PollStatus.UNKNOWN)
```
⚠️ `jwt.encode` 在 PyJWT 2.x 返回 str（确认）。endpoint/字段/状态串带 `# TODO(P2-verify)`，用真 ak/sk 实测后定稿。

- [ ] **Step 4: 注册**

`connectors/video_gen/__init__.py` 追加：
```python
from chayuan.server.modality.router.connectors.video_gen import kling  # noqa: F401
```

- [ ] **Step 5: 语法自检**

```bash
cd /work/chayuan-desktop && python -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/kling.py','chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/__init__.py','chayuan-server/libs/chayuan-server/tests/unit_tests/test_kling_connector.py']]; print('ast.parse OK')"
```
Expected: `ast.parse OK`。

完成报告：状态、贴 kling.py 关键钩子、ast 结果、pytest 未运行、列出所有 `# TODO(P2-verify)` 点。

---

## Task T5: Kling 厂商进目录

**Files:**
- Modify: `config_panel/model_config.py`
- Test: `tests/unit_tests/test_kling_provider_catalog.py`

**实现前先读：** `model_config.py` 的 `PROVIDER_CATALOG`(ProviderMeta 结构)、`_PROVIDER_DEFAULT_MODELS`、`_PROVIDER_LINKS`，照 bailian 那条加 kling。

- [ ] **Step 1: 写测试**

新建 `tests/unit_tests/test_kling_provider_catalog.py`：
```python
from chayuan.server.config_panel.model_config import _PROVIDER_DEFAULT_MODELS


def test_kling_default_video_models():
    kling = _PROVIDER_DEFAULT_MODELS.get("kling")
    assert kling is not None
    assert kling.get("text2video_models")
```
（若厂商 pid 不叫 "kling" 以实际为准；可再加对 PROVIDER_CATALOG 含 kling 的断言，按 ProviderMeta 实际字段写。）

- [ ] **Step 2: 语法自检失败态**

```bash
cd /work/chayuan-desktop && python -c "import ast; ast.parse(open('chayuan-server/libs/chayuan-server/tests/unit_tests/test_kling_provider_catalog.py').read()); print('test ast OK')"
```

- [ ] **Step 3: 加 kling 厂商**

- `PROVIDER_CATALOG` 加一条 `ProviderMeta("kling", display_name="快手可灵 Kling", platform_type="kling", ...)`（字段对齐现有 ProviderMeta；标签如 `("国内","视频")`）。
- `_PROVIDER_DEFAULT_MODELS["kling"] = {"text2video_models": ["kling-v2-5-turbo", "kling-v1-6"]}`。
- `_PROVIDER_LINKS["kling"] = "https://app.klingai.com/.../api"`（KlingAI 开放平台申请页，实现时核对真实 URL）。
- description / 提示文案里写明「API Key 处填 `AccessKey:SecretKey`（英文冒号连接）」。

- [ ] **Step 4: 语法自检**

```bash
cd /work/chayuan-desktop && python -c "import ast; [ast.parse(open(f).read()) for f in ['chayuan-server/libs/chayuan-server/chayuan/server/config_panel/model_config.py','chayuan-server/libs/chayuan-server/tests/unit_tests/test_kling_provider_catalog.py']]; print('ast.parse OK')"
```
Expected: `ast.parse OK`。

完成报告：状态、ProviderMeta 实际字段你怎么填的、申请 URL 用了什么、ast 结果、pytest 未运行。

---

## Task T6: 整体验收

- [ ] **Step 1: 全量语法自检**

```bash
cd /work/chayuan-desktop
python -c "import ast,glob; [ast.parse(open(f).read()) for f in ['chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/base_async.py','chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/dashscope.py','chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/kling.py','chayuan-server/libs/chayuan-server/chayuan/server/modality/router/connectors/video_gen/__init__.py','chayuan-server/libs/chayuan-server/chayuan/server/modality/router/routing.py','chayuan-server/libs/chayuan-server/chayuan/server/api_server/openai_routes.py','chayuan-server/libs/chayuan-server/chayuan/server/config_panel/model_config.py']]; print('ALL ast.parse OK')"
```
Expected: `ALL ast.parse OK`。

- [ ] **Step 2: 用户 py312 机器跑 pytest（本沙箱跑不了）**

```bash
PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_async_video_base.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_dashscope_video_refactor.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_capability_from_config.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_kling_connector.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_kling_provider_catalog.py
```
另外回归跑 P1 的视频相关测试 + 既有 modality 测试（`test_modality_routes.py`/`test_modality_task_manager.py` 等）确认 DashScope 重构无回归。

- [ ] **Step 3: 重建 desktop + 重启 sidecar 实测**

- 模型厂商页出现「快手可灵 Kling」厂商，可填 `AccessKey:SecretKey` + 配 `kling-v2-5-turbo`。
- `/ai-video` 页选 Kling 模型 + 提示词 → 出片（需真 ak/sk + 国内网）；传首帧图 → 图生视频。
- 回归:百炼 Wanx 仍能出片（DashScope 重构无回归）。
- 核对所有 `# TODO(P2-verify)`（Kling endpoint/字段/状态串）。

---

## Self-Review（已核对 spec）

- **Spec 覆盖**：基类→T1；DashScope 重构→T2；能力按配置路由→T3；Kling 连接器(JWT/I2V/状态映射)→T4；Kling 厂商目录(ak:sk 提示)→T5；验收→T6。前端不改（spec 已说明 Kling 凭 P1 的 text2video 类自动进清单）。
- **占位扫描**：代码步均给完整代码；「实现前先读 + 以实际为准 + TODO(P2-verify)」是外部 API/大代码库不可避免的核对点，已具体指明读哪个文件/用测试锁行为，非占位 TODO。
- **类型一致**：`PollResult{status,percent,video_urls,error_message}`/`PollStatus` 在 T1 定义，T2/T4 一致使用；4 钩子签名 T1 定义、T2/T4 实现一致；`capability_from_config(model,platform)` T3 定义即用；`_kling_jwt(ak,sk)` T4 定义即用。
- **风险**：本沙箱无 pytest；DashScope 重构行为敏感（测试+实测双保险）；Kling 外部接口需实测；`save_bytes`/`_estimate_percent` 须对齐 dashscope 现有实现避免行为漂移。

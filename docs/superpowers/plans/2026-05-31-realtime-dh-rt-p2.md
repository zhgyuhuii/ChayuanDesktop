# 实时数字人 RT-P2(WebRTC 实时口型·可验证骨架)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 给实时数字人接上 WebRTC 口型视频流的**可验证骨架**:注册 realtime_avatar GPU 运行时 + `realtime_avatar_server.py`(aiortc /offer + 自定义音视频 track 骨架)+ 主服务 /live/offer 转发 + 前端「实时口型」开关(RTCPeerConnection ↔ sidecar)。**MuseTalk 连续帧源 + TTS 推流的真媒体核心标 [GPU-VERIFY],只能你 GPU 环境验。**

**Architecture:** 复用 GPU 引擎那套运行时机制(catalog+_START_RECIPES+get_recipes)。sidecar 用 `_runtime_server_base.make_runtime_app` + aiortc(`RTCPeerConnection` + 自定义 `MediaStreamTrack`);浏览器经主服务 `/live/offer` 中继 SDP,媒体在 127.0.0.1 直连 sidecar。端口 18880。

**Tech Stack:** Python/FastAPI/`aiortc`(按需 GPU 运行时装)/`_runtime_server_base`;浏览器 `RTCPeerConnection`;httpx 中继。承接 RT-P1 + GPU-P3。

---

## ⚠ 本机不可验证边界(执行前必读)

本机**无 aiortc / 无 GPU / 无 MuseTalk**。可验 vs 不可验:
- ✅ 可验:框架注册形状、安装/启动配方形状、sidecar 模块 py_compile + import 干净(aiortc/av 延迟到调用期)、主服务 /live/offer 转发(stub httpx)、前端 typecheck。
- ❌ **只能用户 GPU 环境验**(标 `[GPU-VERIFY]`):aiortc 真建 peer/ICE、自定义 track 的 `recv()` 真产帧、**MuseTalk 连续帧源**(本期 `recv()` 返 idle/黑帧占位)、TTS 音频推流、text→LLM→TTS→MuseTalk 实时编排、端到端出画。
- RT-P2 骨架的 track `recv()` 与 LLM/TTS 编排是 **best-effort 占位**,真实时媒体待你环境逐步接。

---

## 文件结构

- `config_panel/runtime_framework_panel.py`(改):`_FRAMEWORK_CATALOG` 加 `realtime_avatar`(18880,needs_gpu)。
- `config_panel/install_task_manager.py`(改):`_START_RECIPES` 加 `realtime_avatar` 启动项(18880)。
- `config_panel/install_recipes.py`(改):`get_recipes` 加 `realtime_avatar` → `_realtime_avatar()`(pip aiortc + git clone MuseTalk)。
- `modality/realtime_avatar_server.py`(建):aiortc sidecar(/offer + 自定义 track 骨架)。
- `api_server/digital_human_routes.py`(改):`POST /live/offer` 转发 sidecar;`GET /live/available`(sidecar 可达性)。
- `packages/api/src/digitalHuman.ts`(改):`liveOffer(sdp)` / `liveAvailable()`。
- `packages/app/src/features/digital-human/LiveAvatarPage.tsx`(改):「实时口型」开关 + RTCPeerConnection。

测试:`tests/unit_tests/test_realtime_avatar.py`(新);扩 `test_digital_human_routes.py`。

---

## Task 1: 注册 realtime_avatar GPU 运行时框架

**Files:** `runtime_framework_panel.py`,`install_task_manager.py`,`install_recipes.py`,test `tests/unit_tests/test_realtime_avatar.py`(建)

> 真实名字(GPU-P2/P3 已验):`_FRAMEWORK_CATALOG`(`_FrameworkSpec`)、`install_task_manager._START_RECIPES`、`install_recipes.get_recipes(framework)`、`_pip_with_mirrors(pkg)`、`_bg_cmd`/`_bg_log_path`/`InstallRecipe`。READ `musetalk` 三处条目照搬。

- [ ] **Step 1: 写测试**
```python
def test_realtime_avatar_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "realtime_avatar"), None)
    assert spec is not None and spec.needs_gpu is True and "18880" in spec.default_url

def test_realtime_avatar_launch_recipe():
    from chayuan.server.config_panel import install_task_manager as itm
    rec = itm._START_RECIPES.get("realtime_avatar")
    assert rec is not None and "realtime_avatar_server" in rec.label

def test_realtime_avatar_install_recipe():
    from chayuan.server.config_panel.install_recipes import get_recipes
    out = get_recipes("realtime_avatar")
    joined = " ".join(" ".join(r.cmd) for r in out)
    assert "aiortc" in joined
```

- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_realtime_avatar.py -k framework -v`

- [ ] **Step 3: 实现**
(a) `_FRAMEWORK_CATALOG` 加(在 musetalk 后):
```python
    _FrameworkSpec(
        name="realtime_avatar", label="实时数字人 (WebRTC·MuseTalk)",
        capabilities=("talking-head",),
        default_url="http://127.0.0.1:18880", health_path="/health",
        install_kind="manual", install_pkg=None,
        bin_names=(),
        needs_gpu=True,
    ),
```
(b) `_START_RECIPES` 加:
```python
    "realtime_avatar": InstallRecipe(
        label="python -m chayuan.server.modality.realtime_avatar_server",
        cmd=_bg_cmd(
            [sys.executable, "-m", "chayuan.server.modality.realtime_avatar_server",
             "--host", "127.0.0.1", "--port", "18880"],
            _bg_log_path("realtime_avatar"),
        ),
        note=f"启 chayuan 内置 实时数字人 WebRTC 服务(需 GPU + aiortc);日志 {_bg_log_path('realtime_avatar')}",
        requires="",
    ),
```
(c) `install_recipes.py` 加 `_realtime_avatar` + dispatch 分支:
```python
def _realtime_avatar(host: str) -> List[InstallRecipe]:
    """实时数字人(WebRTC + MuseTalk)。需 GPU。装 aiortc + clone MuseTalk
    (权重用仓内脚本拉,[GPU-VERIFY] 用户环境)。"""
    out: List[InstallRecipe] = []
    out.extend(_pip_with_mirrors("aiortc av"))
    target = os.path.expanduser("~/MuseTalk") if host != "win" else "%USERPROFILE%\\MuseTalk"
    out.append(InstallRecipe(
        label="git clone MuseTalk(实时口型依赖)",
        cmd=["git", "clone", "https://github.com/TMElyralab/MuseTalk.git", target],
        note="clone 后按 README 拉权重",
        requires="git",
    ))
    return out
```
dispatch 加 `if framework == "realtime_avatar": return _realtime_avatar(host)`(挨着 musetalk)。

- [ ] **Step 4: 跑测试 + py_compile**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_realtime_avatar.py -k framework -v`(3 passed)
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/config_panel/{runtime_framework_panel,install_task_manager,install_recipes}.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_recipes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_realtime_avatar.py
git commit -m "feat(rt-dh): 注册 realtime_avatar GPU 运行时(WebRTC,catalog+启动+安装配方)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: realtime_avatar_server.py sidecar 骨架(aiortc)

**Files:** `modality/realtime_avatar_server.py`(建),test `test_realtime_avatar.py`

- [ ] **Step 1: 写测试**(模块 import 干净——aiortc/av 延迟到调用期)
```python
def test_realtime_avatar_server_imports_clean():
    import importlib
    m = importlib.import_module("chayuan.server.modality.realtime_avatar_server")
    assert hasattr(m, "main") and hasattr(m, "_register_routes")
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** — `modality/realtime_avatar_server.py`(仿 `sadtalker_server.py` 的 make_runtime_app 骨架;/offer 用 aiortc;aiortc/av 全在函数内 import):
```python
"""实时数字人 WebRTC 服务(内置)—— aiortc peer + MuseTalk 实时口型帧 + TTS 音频。

调用:python -m chayuan.server.modality.realtime_avatar_server --host 127.0.0.1 --port 18880
需 GPU + aiortc + MuseTalk。
[GPU-VERIFY] 自定义 track 的 recv() 真产帧(MuseTalk 连续帧 / TTS 音频)、
text→LLM→TTS→MuseTalk 实时编排,均待用户 GPU 环境接;本骨架 recv() 返 idle 黑帧/静音。
"""
from __future__ import annotations
import asyncio
import fractions
import logging
from typing import Any, Dict

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app, parse_serve_args, serve,
)

logger = logging.getLogger("chayuan.modality.realtime_avatar_server")

_DEFAULT_CONFIG: Dict[str, Any] = {
    "musetalk_repo": "",       # MuseTalk 仓路径(实时帧源)
    "fps": 25,
    "width": 512,
    "height": 512,
}

_PCS: set = set()  # 活跃 RTCPeerConnection


def _make_idle_video_track(cfg: Dict[str, Any]):
    """返回一个 aiortc VideoStreamTrack:recv() 给 idle 黑帧。
    [GPU-VERIFY] 真实现把 MuseTalk 连续帧塞进来(按 fps + 跟 TTS 音频对齐)。"""
    from aiortc import VideoStreamTrack  # type: ignore
    import av  # type: ignore
    import numpy as np  # type: ignore

    w, h, fps = int(cfg.get("width", 512)), int(cfg.get("height", 512)), int(cfg.get("fps", 25))

    class _IdleVideo(VideoStreamTrack):
        async def recv(self):
            pts, time_base = await self.next_timestamp()
            # [GPU-VERIFY] 这里换成 MuseTalk 当前帧(np.ndarray HxWx3 RGB)
            frame_arr = np.zeros((h, w, 3), dtype="uint8")
            frame = av.VideoFrame.from_ndarray(frame_arr, format="rgb24")
            frame.pts, frame.time_base = pts, fractions.Fraction(1, fps)
            return frame

    return _IdleVideo()


def _register_routes(app: Any, cfg: Dict[str, Any]) -> None:
    from fastapi import HTTPException, Request

    @app.post("/offer")
    async def offer(request: Request) -> Dict[str, Any]:
        try:
            from aiortc import RTCPeerConnection, RTCSessionDescription  # type: ignore
        except ImportError as e:
            app.state.lib_error = "aiortc 未安装,请装实时数字人运行时"
            raise HTTPException(status_code=503, detail=app.state.lib_error) from e
        payload = await request.json()
        sdp, typ = payload.get("sdp"), payload.get("type")
        if not (sdp and typ):
            raise HTTPException(status_code=400, detail="sdp/type 必填")
        pc = RTCPeerConnection()
        _PCS.add(pc)

        @pc.on("connectionstatechange")
        async def _on_state() -> None:
            if pc.connectionState in ("failed", "closed"):
                await pc.close(); _PCS.discard(pc)

        @pc.on("datachannel")
        def _on_dc(channel) -> None:  # 前端经 data channel 推文字
            @channel.on("message")
            def _on_msg(message) -> None:
                # [GPU-VERIFY] 收到用户文字 → LLM→TTS→MuseTalk 编排,驱动上面的 video/audio track
                app.state.lib_loaded = True
                logger.info("[rt-avatar] 收到文字(待接编排): %r", message)

        pc.addTrack(_make_idle_video_track(cfg))
        # [GPU-VERIFY] pc.addTrack(<TTS 音频 track>)
        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=typ))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}


def main() -> None:
    args = parse_serve_args(default_port=18880)
    app = make_runtime_app(
        framework="realtime_avatar", title="Realtime Avatar Runtime",
        default_config=_DEFAULT_CONFIG, register_routes=_register_routes,
    )

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await asyncio.gather(*[pc.close() for pc in list(_PCS)], return_exceptions=True)
        _PCS.clear()

    serve(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
```
> `make_runtime_app`/`parse_serve_args`/`serve` 签名对齐 `sadtalker_server.py`(GPU-P2 已验)。aiortc/av/numpy 全在函数内 import,模块 import 干净。

- [ ] **Step 4: 跑测试 + py_compile**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_realtime_avatar.py -k server -v`
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/modality/realtime_avatar_server.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/modality/realtime_avatar_server.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_realtime_avatar.py
git commit -m "feat(rt-dh): realtime_avatar_server sidecar 骨架(aiortc /offer + idle track)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 主服务 /live/offer 转发 + /live/available

**Files:** `api_server/digital_human_routes.py`,test `test_digital_human_routes.py`

- [ ] **Step 1: 写失败测试**(stub httpx 转发)
```python
def test_live_offer_relays(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    class _Resp:
        status_code = 200
        def json(self): return {"sdp": "ANSWER", "type": "answer"}
        def raise_for_status(self): pass
    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, url, json, timeout=None):
            assert url.endswith(":18880/offer"); return _Resp()
    monkeypatch.setattr("httpx.Client", _Client)
    r = c.post("/api/v1/digital-human/live/offer", json={"sdp": "OFFER", "type": "offer"})
    assert r.status_code == 200 and r.json()["sdp"] == "ANSWER"

def test_live_available(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    monkeypatch.setattr(routes, "_realtime_port_listening", lambda: True)
    assert c.get("/api/v1/digital-human/live/available").json()["available"] is True
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** — `digital_human_routes.py`:
顶部加(端口常量 + 端口探测):
```python
_REALTIME_PORT = 18880


def _realtime_port_listening() -> bool:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.3)
    try:
        return s.connect_ex(("127.0.0.1", _REALTIME_PORT)) == 0
    finally:
        s.close()
```
加端点:
```python
@digital_human_router.get("/live/available")
def live_available(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return {"available": _realtime_port_listening()}


@digital_human_router.post("/live/offer")
def live_offer(body: Dict[str, Any],
               user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    """中继浏览器 SDP offer 到 realtime_avatar sidecar 的 /offer,返回 answer。"""
    import httpx
    if not _realtime_port_listening():
        raise HTTPException(503, "实时数字人运行时未启动(去运行时框架安装/启动)")
    with httpx.Client() as client:
        resp = client.post(f"http://127.0.0.1:{_REALTIME_PORT}/offer", json=body, timeout=30)
        resp.raise_for_status()
        return resp.json()
```

- [ ] **Step 4: 跑测试通过 + py_compile**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -v`
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py
git commit -m "feat(rt-dh): /live/offer 转发 sidecar + /live/available 探测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 前端 API + LiveAvatarPage「实时口型」开关

**Files:** `packages/api/src/digitalHuman.ts`,`packages/app/src/features/digital-human/LiveAvatarPage.tsx`

- [ ] **Step 1: api**(`digitalHuman.ts` 加 liveAvailable / liveOffer + 挂对象)
```typescript
export async function dhLiveAvailable(): Promise<{ available: boolean }> {
  return rd<{ available: boolean }>('/api/v1/digital-human/live/available');
}
export async function dhLiveOffer(sdp: string, type: string): Promise<{ sdp: string; type: string }> {
  return rd<{ sdp: string; type: string }>('/api/v1/digital-human/live/offer', { method: 'POST', body: { sdp, type } });
}
```
`digitalHuman` 对象加 `liveAvailable: dhLiveAvailable, liveOffer: dhLiveOffer`。

- [ ] **Step 2: LiveAvatarPage 加「实时口型」开关 + WebRTC**(READ 现有 LiveAvatarPage 结构)
在配置条加一个开关 state `liveVideo`(默认 false)。`liveVideo` 开时:
- 建 `RTCPeerConnection`,`pc.addTransceiver('video', {direction:'recvonly'})`,建 data channel `dc = pc.createDataChannel('text')`。
- `pc.ontrack = (e) => { videoRef.current.srcObject = e.streams[0]; }`(上方 `<video ref={videoRef} autoPlay muted playsInline>` 替换形象图)。
- `createOffer` → `setLocalDescription` → `digitalHuman.liveOffer(pc.localDescription.sdp, pc.localDescription.type)` → `setRemoteDescription(answer)`。
- `send()` 改:`liveVideo && dc?.readyState==='open'` 时把用户文字 `dc.send(q)` 推给 sidecar(由它驱动口型+语音);否则走 RT-P1 文字流+TTS(现状)。
完整接法(实现者把 pc/dc 放 ref,liveVideo 切换时 connect/teardown;关闭时 `pc.close()`):
```tsx
const pcRef = React.useRef<RTCPeerConnection | null>(null);
const dcRef = React.useRef<RTCDataChannel | null>(null);
const videoRef = React.useRef<HTMLVideoElement | null>(null);
const startLive = React.useCallback(async () => {
  const avail = await digitalHuman.liveAvailable();
  if (!avail.available) { reportError(new Error('实时数字人运行时未启动(去运行时框架安装/启动 + 需 GPU)'), '实时口型不可用'); return; }
  const pc = new RTCPeerConnection();
  pcRef.current = pc;
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  dcRef.current = pc.createDataChannel('text');
  pc.ontrack = (e) => { if (videoRef.current) videoRef.current.srcObject = e.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const ans = await digitalHuman.liveOffer(pc.localDescription!.sdp, pc.localDescription!.type);
  await pc.setRemoteDescription(ans as RTCSessionDescriptionInit);
}, []);
const stopLive = React.useCallback(() => {
  try { dcRef.current?.close(); pcRef.current?.close(); } catch { /* noop */ }
  pcRef.current = null; dcRef.current = null;
  if (videoRef.current) videoRef.current.srcObject = null;
}, []);
React.useEffect(() => () => stopLive(), [stopLive]);
```
上方显示区:`liveVideo ? <video ref={videoRef} autoPlay muted playsInline className="max-h-full rounded-lg" /> : <现有形象图>`。`send()` 里 liveVideo 分支:`if (liveVideo && dcRef.current?.readyState === 'open') { dcRef.current.send(q); setInput(''); return; }`(口型由 sidecar 推,前端不再本地 TTS)。

- [ ] **Step 3: typecheck**(单包,全量 OOM)
Run: `cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"` → 空
> `RTCPeerConnection`/`RTCDataChannel`/`RTCSessionDescriptionInit` 是浏览器内置类型,TS dom lib 已含。

- [ ] **Step 4: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/api/src/digitalHuman.ts chayuan-client/packages/app/src/features/digital-human/LiveAvatarPage.tsx
git commit -m "feat(rt-dh): LiveAvatarPage 实时口型开关(WebRTC RTCPeerConnection ↔ sidecar)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 全链路自检 + 推送

- [ ] **Step 1:** `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_realtime_avatar.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -q`(全 passed)
- [ ] **Step 2:** `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/modality/realtime_avatar_server.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py`
- [ ] **Step 3:** `cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"`(空)
- [ ] **Step 4:** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(design 五节 RT-P2):realtime_avatar 注册为按需 GPU 运行时(T1)、aiortc sidecar /offer(T2)、主服务 /live/offer 中继(T3)、前端 WebRTC 客户端 + 实时口型开关(T4)。RT-P3(ASR)不在本计划。
- **占位扫描**:无 TBD。`[GPU-VERIFY]` 标的是"骨架已写、真媒体待 GPU 环境接"(track recv 返 idle 帧、LLM/TTS/MuseTalk 编排)——诚实标记,非 plan 占位。
- **类型一致**:端口 18880 三处(catalog/启动/路由常量 + sidecar default_port)一致;`/live/offer` 请求/响应 `{sdp,type}` 前后端一致;`liveOffer`/`liveAvailable` 前后端对应。
- **不回归**:RT-P1 文字流+TTS 路径在 liveVideo 关时不变;liveVideo 开且 data channel ready 时走 WebRTC。
- **风险/[GPU-VERIFY]**:① aiortc 真 peer/ICE + 自定义 track recv 真产帧(本期 idle 黑帧)② MuseTalk 连续帧源接入 track ③ TTS 音频 track + 与视频帧对齐 ④ data channel 收文字→LLM→TTS→MuseTalk 实时编排 ⑤ 媒体在 127.0.0.1 直连(desktop 同机)真连通性 —— **全部你 GPU+aiortc 环境逐步接/验**;本期只搭"装运行时→建 peer→收 idle 流"的可验证外壳。

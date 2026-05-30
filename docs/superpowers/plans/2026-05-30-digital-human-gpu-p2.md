# 数字人 GPU-P2(SadTalker 真引擎)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 把 GPU-P1 的 `sadtalker` 占位换成真引擎:注册 SadTalker 为按需安装的 GPU 运行时框架 + `sadtalker_server.py` sidecar(ModelScope `talking-head` pipeline 包装)+ `SadTalkerEngine` 转发 sidecar。基础包零变化。

**Architecture:** 复用现有运行时框架体系——`_FRAMEWORK_CATALOG` 注册 + `install_task_manager` 启动配方 + `install_recipes` 安装配方 + `_runtime_server_base.make_runtime_app` 起 sidecar(port 18680)+ 主服务 `SadTalkerEngine` 经 httpx 转发(仿 `audio._transcribe_via_sidecar`)。SadTalker 走 ModelScope 自定义 pipeline(`wwd123/sadtalker`,task=`talking-head`,image+audio→video),不 vendor SadTalker repo。

**Tech Stack:** Python/FastAPI/`_runtime_server_base`/modelscope pipeline(GPU,按需装);httpx 转发。承接 GPU-P1。

---

## ⚠ 本机不可验证边界(执行前必读)

本机**无 GPU / 无 modelscope / 无 SadTalker**。本计划只建**可 stub 验证的骨架**:
- ✅ 可验:框架注册形状、install/启动配方形状、sidecar 模块 py_compile + import 干净(modelscope 延迟到调用期)、`SadTalkerEngine` 转发逻辑(stub httpx)、`is_available` 端口探测逻辑(stub socket)。
- ❌ **只能在用户 GPU 环境验**:① sidecar 内 `modelscope.pipelines.pipeline('talking-head','wwd123/sadtalker')` 真加载 + 首次拉 checkpoints + 推理出片;② 装运行时→起 sidecar→出片整链路;③ 版本兼容(同 Wav2Lip,真跑必有 traceback 迭代)。
- 凡标 **[GPU-VERIFY]** 的点 = 实现照设计写、py_compile 过,但真行为待用户环境验/迭代。

---

## 文件结构

- `config_panel/runtime_framework_panel.py`(改):`_FRAMEWORK_CATALOG` 加 `sadtalker` spec。
- `config_panel/install_task_manager.py`(改):server-launch 字典加 `sadtalker` 启动项(18680)。
- `config_panel/install_recipes.py`(改):dispatch 加 `sadtalker` → `_sadtalker()` 安装配方。
- `modality/sadtalker_server.py`(建):sidecar(modelscope pipeline 包装)。
- `video_generation/digital_human/engine.py`(改):`SadTalkerEngine`(转发 sidecar)+ `_engine_installed("sadtalker")` 真检查 + `get_engine("sadtalker")` 返真引擎。

测试:`tests/unit_tests/test_digital_human_sadtalker.py`(新)、扩 `test_digital_human_jobs.py`。

---

## Task 1: 注册 SadTalker 运行时框架(catalog + 启动 + 安装配方)

**Files:** `runtime_framework_panel.py`,`install_task_manager.py`,`install_recipes.py`,test `tests/unit_tests/test_digital_human_sadtalker.py`(建)

- [ ] **Step 1: 写测试**(验三处注册都认识 sadtalker)
```python
def test_sadtalker_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "sadtalker"), None)
    assert spec is not None
    assert spec.needs_gpu is True
    assert "18680" in spec.default_url

def test_sadtalker_launch_recipe_present():
    from chayuan.server.config_panel import install_task_manager as itm
    # 启动配方字典里有 sadtalker(指向 sadtalker_server,端口 18680)
    rec = itm._SERVICE_RECIPES.get("sadtalker") if hasattr(itm, "_SERVICE_RECIPES") else None
    # 字典名不确定:实现时核对 install_task_manager 里 funasr/cosyvoice 所在那个 dict 的真名,
    # 并把它暴露成可取(或提供 get 函数)。断言其 label 含 sadtalker_server。
    assert rec is not None and "sadtalker_server" in rec.label

def test_sadtalker_install_recipe_present():
    from chayuan.server.config_panel.install_recipes import recipes_for  # 核对真实入口名
    out = recipes_for("sadtalker", host="linux")  # 核对 dispatch 函数签名
    assert any("modelscope" in " ".join(r.cmd) for r in out)
```
> ⚠ 实现者先 READ `install_task_manager.py`(funasr/cosyvoice 启动项所在 dict 的变量名)和 `install_recipes.py`(dispatch 入口函数名 + 签名,如 `if framework == "voxcpm2": return _voxcpm2(host)`),把测试里的 `_SERVICE_RECIPES`/`recipes_for` 改成**真实名字**再写。

- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py -k framework -v`

- [ ] **Step 3: 实现**
(a) `runtime_framework_panel.py` `_FRAMEWORK_CATALOG` 加(端口避开已用 18180/280/380/480/580):
```python
    _FrameworkSpec(
        name="sadtalker", label="SadTalker (数字人·高清头动)",
        capabilities=("talking-head",),
        default_url="http://127.0.0.1:18680", health_path="/health",
        install_kind="pip", install_pkg="modelscope",
        bin_names=(),  # 无 cli;按"端口监听/health"判活
        needs_gpu=True,
    ),
```
(b) `install_task_manager.py` 在 funasr/cosyvoice/voxcpm2 所在的 server-launch dict 里加(变量名以文件实际为准):
```python
    "sadtalker": InstallRecipe(
        label="python -m chayuan.server.modality.sadtalker_server",
        cmd=_bg_cmd(
            [sys.executable, "-m", "chayuan.server.modality.sadtalker_server",
             "--host", "127.0.0.1", "--port", "18680"],
            _bg_log_path("sadtalker"),
        ),
        note=f"启 chayuan 内置 SadTalker HTTP 包装(需 GPU);日志 {_bg_log_path('sadtalker')}",
        requires="",
    ),
```
(c) `install_recipes.py` dispatch 加分支 + `_sadtalker()`:
```python
def _sadtalker(host: str) -> List[InstallRecipe]:
    """SadTalker 数字人(ModelScope talking-head pipeline)。需 GPU + modelscope 拉
    wwd123/sadtalker checkpoints(首次 pipeline() 自动下)。"""
    out: List[InstallRecipe] = []
    out.extend(_pip_with_mirrors("modelscope"))
    return out
```
并在 dispatch(`if framework == "voxcpm2": return _voxcpm2(host)` 那串)加 `if framework == "sadtalker": return _sadtalker(host)`。

- [ ] **Step 4: 跑测试确认通过 + py_compile**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py -k "framework or launch or install" -v`
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_recipes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py
git commit -m "feat(dh): 注册 SadTalker GPU 运行时框架(catalog+启动+安装配方)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: sadtalker_server.py sidecar(modelscope pipeline 包装)

**Files:** `modality/sadtalker_server.py`(建),test `test_digital_human_sadtalker.py`

- [ ] **Step 1: 写测试**(模块 import 干净——modelscope 延迟到调用期;有 main/app 工厂)
```python
def test_sadtalker_server_imports_clean():
    import importlib
    m = importlib.import_module("chayuan.server.modality.sadtalker_server")
    assert hasattr(m, "main")          # 入口(parse_serve_args+serve)
    assert hasattr(m, "_register_routes")
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** — `modality/sadtalker_server.py`(仿 `cosyvoice_server.py`;READ 它对照 `make_runtime_app`/`parse_serve_args`/`serve` 用法):
```python
"""SadTalker HTTP wrapper(内置)— 数字人 talking-head。

调用:python -m chayuan.server.modality.sadtalker_server --host 127.0.0.1 --port 18680
配置:<CHAYUAN_ROOT>/runtime/sadtalker.yaml
需 GPU + modelscope(按需装);首次 pipeline() 自动拉 wwd123/sadtalker checkpoints。
"""
from __future__ import annotations
import logging
from typing import Any, Dict

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app, parse_serve_args, serve,
)

logger = logging.getLogger("chayuan.modality.sadtalker_server")

_DEFAULT_CONFIG: Dict[str, Any] = {
    "model_id": "wwd123/sadtalker",
    "model_revision": "v1.0.0",
    "task": "talking-head",
}


def _register_routes(app: Any, cfg: Dict[str, Any]) -> None:
    from fastapi import HTTPException, Request

    def _ensure_loaded() -> Any:
        if app.state.lib_loaded and app.state.lib_handle is not None:
            return app.state.lib_handle
        try:
            from modelscope.pipelines import pipeline  # type: ignore
        except ImportError as e:
            app.state.lib_error = "modelscope 未安装,请装 SadTalker 运行时"
            raise HTTPException(status_code=503, detail=app.state.lib_error) from e
        try:
            handle = pipeline(
                task=cfg.get("task", "talking-head"),
                model=cfg.get("model_id", "wwd123/sadtalker"),
                model_revision=cfg.get("model_revision", "v1.0.0"),
            )
        except Exception as e:  # noqa: BLE001
            app.state.lib_error = f"SadTalker pipeline 初始化失败: {e}"
            logger.exception("SadTalker init failed")
            raise HTTPException(status_code=503, detail=app.state.lib_error) from e
        app.state.lib_handle = handle
        app.state.lib_loaded = True
        app.state.lib_error = ""
        return handle

    @app.post("/infer")
    async def infer(request: Request) -> Dict[str, Any]:
        payload = await request.json()
        image_path = (payload.get("image_path") or "").strip()
        audio_path = (payload.get("audio_path") or "").strip()
        out_path = (payload.get("out_path") or "").strip()
        if not (image_path and audio_path and out_path):
            raise HTTPException(status_code=400, detail="image_path/audio_path/out_path 必填")
        handle = _ensure_loaded()
        # [GPU-VERIFY] pipeline 输入/输出键名 + 产物落盘方式需用户 GPU 环境实测对齐:
        # ModelScope talking-head pipeline 通常 result[OutputKeys.OUTPUT_VIDEO] 给出视频路径,
        # 这里把它拷/移到 out_path。真实键名/返回结构以实测为准。
        import shutil, os
        result = handle({"source_image": image_path, "driven_audio": audio_path})
        produced = None
        if isinstance(result, dict):
            produced = result.get("output_video") or result.get("output_video_path")
        if produced and os.path.isfile(produced):
            if os.path.abspath(produced) != os.path.abspath(out_path):
                shutil.copy2(produced, out_path)
        elif not os.path.isfile(out_path):
            raise HTTPException(status_code=500, detail=f"SadTalker 未产出视频: {result!r}")
        return {"ok": True, "out_path": out_path}


def main() -> None:
    args = parse_serve_args(default_port=18680)
    app = make_runtime_app(
        framework="sadtalker", title="SadTalker Runtime",
        default_config=_DEFAULT_CONFIG, register_routes=_register_routes,
    )
    serve(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
```
> 所有 modelscope import 都在 `_ensure_loaded` 内(模块 import 不碰 modelscope)。`parse_serve_args`/`serve`/`make_runtime_app` 的真实签名 READ `_runtime_server_base.py` + `cosyvoice_server.py` 对齐(parse_serve_args 是否收 default_port、serve 参数名)。

- [ ] **Step 4: 跑测试 + py_compile**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py -k server -v`
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/modality/sadtalker_server.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/modality/sadtalker_server.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py
git commit -m "feat(dh): sadtalker_server sidecar(ModelScope talking-head pipeline 包装)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: SadTalkerEngine 转发 + is_available 真检查

**Files:** `video_generation/digital_human/engine.py`,test `test_digital_human_sadtalker.py`

- [ ] **Step 1: 写测试**(stub httpx + 端口检查)
```python
def test_sadtalker_engine_forwards(monkeypatch, tmp_path):
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    posted = {}
    class _Resp:
        status_code = 200
        def json(self): return {"ok": True, "out_path": posted.get("out")}
        def raise_for_status(self): pass
    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def post(self, url, json, timeout=None):
            posted.update(url=url, body=json, out=json["out_path"]); return _Resp()
    import httpx  # noqa
    monkeypatch.setattr(dh_engine, "_SADTALKER_PORT", 18680, raising=False)
    monkeypatch.setattr("httpx.Client", _Client)
    # 让 ensure_ready/可达性检查直接通过
    monkeypatch.setattr(dh_engine, "_sadtalker_ensure_ready", lambda: None, raising=False)
    out = os.path.join(tmp_path, "o.mp4"); open(out, "wb").write(b"x")
    e = dh_engine.SadTalkerEngine()
    r = e.generate(avatar_path="img.png", audio_path="a.wav", out_path=out, width=720, height=1280)
    assert r == out and posted["url"].endswith("/infer")
    assert posted["body"]["image_path"] == "img.png"

def test_get_engine_sadtalker_is_real_engine():
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    assert isinstance(dh_engine.get_engine("sadtalker"), dh_engine.SadTalkerEngine)
```

- [ ] **Step 2: 跑测试确认失败**(无 SadTalkerEngine)

- [ ] **Step 3: 实现** — `engine.py`:
顶部常量 `_SADTALKER_PORT = 18680`。加:
```python
def _port_listening(port: int, timeout: float = 0.3) -> bool:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def _sadtalker_ensure_ready() -> None:
    """确保 sidecar 在跑(端口监听)。未跑则尝试 install_task_manager 启动;
    [GPU-VERIFY] 启动/就绪等待在用户 GPU 环境实测。"""
    if _port_listening(_SADTALKER_PORT):
        return
    try:
        from chayuan.server.config_panel.install_task_manager import get_install_manager
        get_install_manager().start_service(framework="sadtalker")
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"SadTalker 运行时未启动且自启失败: {e}") from e
    import time
    for _ in range(60):  # 最多等 ~30s
        if _port_listening(_SADTALKER_PORT):
            return
        time.sleep(0.5)
    raise RuntimeError("SadTalker sidecar 启动超时(检查运行时框架日志)")


class SadTalkerEngine:
    """转发到 sadtalker_server sidecar(GPU)。"""
    def generate(self, *, avatar_path: str, audio_path: str, out_path: str,
                 width: int, height: int,
                 on_progress: Optional[ProgressCb] = None) -> str:
        import httpx
        _sadtalker_ensure_ready()
        if on_progress:
            on_progress(10)
        with httpx.Client() as client:
            resp = client.post(
                f"http://127.0.0.1:{_SADTALKER_PORT}/infer",
                json={"image_path": avatar_path, "audio_path": audio_path, "out_path": out_path},
                timeout=600,
            )
            resp.raise_for_status()
        if on_progress:
            on_progress(100)
        if not os.path.isfile(out_path):
            raise RuntimeError("SadTalker 未产出 mp4")
        return out_path
```
`_engine_installed` 的 sadtalker 分支改成真检查(端口监听 = 可用):
```python
def _engine_installed(engine_id: str) -> bool:
    spec = _SPECS.get(engine_id)
    if spec is None:
        return False
    if spec.builtin:
        return True
    if engine_id == "sadtalker":
        return _port_listening(_SADTALKER_PORT)
    return False  # musetalk 仍占位(GPU-P3)
```
`get_engine` 的 sadtalker 分支返真引擎:
```python
def get_engine(engine_id: str = "wav2lip") -> DigitalHumanEngine:
    if engine_id == "wav2lip":
        return Wav2LipEngine()
    if engine_id == "sadtalker":
        return SadTalkerEngine()
    spec = _SPECS.get(engine_id)
    if spec is None:
        raise RuntimeError(f"未知引擎: {engine_id}")
    return _UnavailableGpuEngine(spec)  # musetalk
```

- [ ] **Step 4: 跑测试确认通过 + 全 dh 测试不回归**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -v`
> 注:GPU-P1 的 `test_get_engine_gpu_placeholder_raises_on_generate` 用的是 `sadtalker` —— 现在 sadtalker 变真引擎不再抛"未安装"。把那条测试的引擎 id 改成 `musetalk`(仍占位),保持"占位引擎报错"的覆盖。

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): SadTalkerEngine 转发 sidecar + sadtalker 真可用性检查

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 全链路自检 + 推送

- [ ] **Step 1:** `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -q`(全 passed)
- [ ] **Step 2:** `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/*.py chayuan-server/libs/chayuan-server/chayuan/server/modality/sadtalker_server.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/{runtime_framework_panel,install_task_manager,install_recipes}.py`
- [ ] **Step 3:** `cd /work/chayuan-desktop && git push origin main`

> 前端无需改:GPU-P1 的引擎 picker 已按 `/engines` 的 `installed` 动态 gating;sadtalker 装好+起 sidecar 后 `_engine_installed` 返 True,picker 自动放开。

---

## 自检(Self-Review)

- **Spec 覆盖**(GPU-engine design 二节 + 分期 GPU-P2):SadTalker 注册为按需 GPU 运行时(T1)、sidecar(T2)、转发 impl + 可用性检查(T3)。MuseTalk = GPU-P3。
- **占位扫描**:无 TBD。`[GPU-VERIFY]` 标注的是"实现已写、真行为待 GPU 环境验"的诚实标记,非 plan 占位。
- **类型一致**:`SadTalkerEngine.generate` 签名 = `DigitalHumanEngine` 协议;sidecar `/infer` body `{image_path,audio_path,out_path}` 与 `SadTalkerEngine` 发送体一致;端口 18680 三处(catalog/启动配方/engine 常量)一致。
- **不回归**:wav2lip 默认链路不变;musetalk 仍占位;GPU-P1 占位测试改用 musetalk。
- **风险/[GPU-VERIFY]**:① modelscope talking-head pipeline 的真实输入/输出键名(`source_image`/`driven_audio`/`output_video`)需实测对齐 —— 已在 sidecar 注释标注,错了按 traceback 改;② 装运行时(modelscope + SadTalker 依赖链,首次 pipeline 拉 ~2GB)在用户 GPU 环境跑;③ SadTalker 要**图**形象,jobs 传的 avatar 若是视频需先抽帧(本期 SadTalkerEngine 原样转发 avatar_path,sidecar 或 jobs 抽帧留 GPU 环境联调时补);④ 自启 sidecar(install_task_manager.start_service)就绪等待逻辑实测。

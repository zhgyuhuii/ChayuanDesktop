# 数字人 GPU-P3(MuseTalk 真引擎)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 把 GPU-P1 的 `musetalk` 占位换成真引擎:注册 MuseTalk 为按需安装 GPU 运行时 + `musetalk_server.py` sidecar(subprocess 跑 MuseTalk 仓 inference)+ `MuseTalkEngine` 转发。基础包零变化。

**Architecture:** 复用 GPU-P2 SadTalker 同套机制(framework 注册 + sidecar + httpx 转发)。**关键区别:MuseTalk 不是 ModelScope pipeline**,而是 git clone `TMElyralab/MuseTalk` + 多组件权重 + 跑它的 `scripts/inference`。sidecar 用 **subprocess** 调 MuseTalk 仓里的推理脚本。端口 18780。

**Tech Stack:** Python/FastAPI/`_runtime_server_base`/subprocess;httpx 转发。承接 GPU-P2。

---

## ⚠ 本机不可验证边界(执行前必读)

本机**无 GPU / 无 MuseTalk 仓 / 无权重**。可验 vs 不可验:
- ✅ 可验:framework 注册形状、install/启动配方形状、sidecar 模块 py_compile + import 干净(重依赖延迟)、`MuseTalkEngine` 转发(stub httpx)、可用性端口检查(stub socket)。
- ❌ **只能用户 GPU 环境验**(标 **[GPU-VERIFY]**):MuseTalk 仓的 clone 路径、权重下载、inference 脚本的真实**命令行/配置格式/产物路径**,以及整链路出片 + 版本兼容迭代。MuseTalk 比 SadTalker 更挑(VAE/whisper/dwpose 多组件),sidecar 的 subprocess 调用是**best-effort 骨架**,大概率要按你环境实测调。

---

## 文件结构

- `config_panel/runtime_framework_panel.py`(改):`_FRAMEWORK_CATALOG` 加 `musetalk`(port 18780,needs_gpu)。
- `config_panel/install_task_manager.py`(改):`_START_RECIPES` 加 `musetalk` 启动项(18780)。
- `config_panel/install_recipes.py`(改):`get_recipes` 加 `musetalk` → `_musetalk()`(git clone + pip)。
- `modality/musetalk_server.py`(建):sidecar(subprocess 跑 MuseTalk inference)。
- `video_generation/digital_human/engine.py`(改):`MuseTalkEngine`(转发)+ `_engine_installed("musetalk")` 真检查 + `get_engine("musetalk")` 返真引擎。

测试:`tests/unit_tests/test_digital_human_musetalk.py`(新)。

---

## Task 1: 注册 MuseTalk 运行时框架

**Files:** `runtime_framework_panel.py`,`install_task_manager.py`,`install_recipes.py`,test `tests/unit_tests/test_digital_human_musetalk.py`(建)

> 真实名字已知(GPU-P2 实测):launch dict = `install_task_manager._START_RECIPES`;install dispatch = `install_recipes.get_recipes(framework)`;helper `_pip_with_mirrors(pkg)`;`_FrameworkSpec` 字段见 sadtalker 条目。

- [ ] **Step 1: 写测试**
```python
def test_musetalk_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "musetalk"), None)
    assert spec is not None and spec.needs_gpu is True and "18780" in spec.default_url

def test_musetalk_launch_recipe_present():
    from chayuan.server.config_panel import install_task_manager as itm
    rec = itm._START_RECIPES.get("musetalk")
    assert rec is not None and "musetalk_server" in rec.label

def test_musetalk_install_recipe_present():
    from chayuan.server.config_panel.install_recipes import get_recipes
    out = get_recipes("musetalk")
    joined = " ".join(" ".join(r.cmd) for r in out)
    assert "MuseTalk" in joined or "musetalk" in joined  # git clone 或 pip 命令含仓名
```

- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_musetalk.py -v`

- [ ] **Step 3: 实现**
(a) `runtime_framework_panel.py` `_FRAMEWORK_CATALOG` 加(在 sadtalker 后):
```python
    _FrameworkSpec(
        name="musetalk", label="MuseTalk (数字人·高清口型)",
        capabilities=("talking-head",),
        default_url="http://127.0.0.1:18780", health_path="/health",
        install_kind="manual", install_pkg=None,
        bin_names=(),
        needs_gpu=True,
    ),
```
(b) `install_task_manager.py` `_START_RECIPES` 加(仿 sadtalker,端口 18780,module `chayuan.server.modality.musetalk_server`):
```python
    "musetalk": InstallRecipe(
        label="python -m chayuan.server.modality.musetalk_server",
        cmd=_bg_cmd(
            [sys.executable, "-m", "chayuan.server.modality.musetalk_server",
             "--host", "127.0.0.1", "--port", "18780"],
            _bg_log_path("musetalk"),
        ),
        note=f"启 chayuan 内置 MuseTalk HTTP 包装(需 GPU);日志 {_bg_log_path('musetalk')}",
        requires="",
    ),
```
(c) `install_recipes.py` 加 `_musetalk` + dispatch 分支(git clone 仓 + pip 依赖;[GPU-VERIFY] 权重下载在用户环境跑 MuseTalk 自带脚本):
```python
def _musetalk(host: str) -> List[InstallRecipe]:
    """MuseTalk 数字人(需 GPU)。git clone 官方仓 + pip 依赖;权重用仓内
    download_weights 脚本拉(VAE/whisper/dwpose 多组件,[GPU-VERIFY] 用户环境跑)。"""
    out: List[InstallRecipe] = []
    target = os.path.expanduser("~/MuseTalk") if host != "win" else "%USERPROFILE%\\MuseTalk"
    out.append(InstallRecipe(
        label="git clone MuseTalk(官方)",
        cmd=["git", "clone", "https://github.com/TMElyralab/MuseTalk.git", target],
        note="clone 后按仓库 README 跑 download_weights 拉权重(需 GPU)",
        requires="git",
    ))
    out.append(InstallRecipe(
        label="git clone MuseTalk(国内代理 ghproxy)",
        cmd=["git", "clone", "https://mirror.ghproxy.com/https://github.com/TMElyralab/MuseTalk.git", target],
        note="国内网络优选",
        requires="git",
    ))
    return out
```
dispatch 里加 `if framework == "musetalk": return _musetalk(host)`(挨着 sadtalker 分支)。

- [ ] **Step 4: 跑测试通过 + py_compile**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_musetalk.py -v`
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_recipes.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/config_panel/runtime_framework_panel.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_task_manager.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/install_recipes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_musetalk.py
git commit -m "feat(dh): 注册 MuseTalk GPU 运行时框架(catalog+启动+git clone 安装配方)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: musetalk_server.py sidecar(subprocess 跑 MuseTalk inference)

**Files:** `modality/musetalk_server.py`(建),test `test_digital_human_musetalk.py`

- [ ] **Step 1: 写测试**(模块 import 干净;有 main/_register_routes)
```python
def test_musetalk_server_imports_clean():
    import importlib
    m = importlib.import_module("chayuan.server.modality.musetalk_server")
    assert hasattr(m, "main") and hasattr(m, "_register_routes")
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** — `modality/musetalk_server.py`(仿 `sadtalker_server.py` 的 make_runtime_app 骨架,但 /infer 用 subprocess 调 MuseTalk 仓):
```python
"""MuseTalk HTTP wrapper(内置)— 数字人 talking-head(高清口型)。

调用:python -m chayuan.server.modality.musetalk_server --host 127.0.0.1 --port 18780
配置:<CHAYUAN_ROOT>/runtime/musetalk.yaml(repo_dir / python_exe / 推理脚本参数)
需 GPU。MuseTalk 不是 modelscope pipeline → 用 subprocess 跑仓内 inference 脚本。
[GPU-VERIFY] 真实命令行/配置/产物路径以用户环境 MuseTalk 仓实测为准。
"""
from __future__ import annotations
import logging, os, subprocess
from typing import Any, Dict

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app, parse_serve_args, serve,
)

logger = logging.getLogger("chayuan.modality.musetalk_server")

_DEFAULT_CONFIG: Dict[str, Any] = {
    "repo_dir": os.path.expanduser("~/MuseTalk"),  # git clone 落点
    "python_exe": "",                               # 空=用当前解释器
    # [GPU-VERIFY] MuseTalk 推理入口/参数:仓内常见 scripts/inference.py 吃
    # --inference_config yaml(含 video_path/audio_path/result_dir)。真实参数实测。
    "infer_module": "scripts.inference",
}


def _register_routes(app: Any, cfg: Dict[str, Any]) -> None:
    from fastapi import HTTPException, Request

    @app.post("/infer")
    async def infer(request: Request) -> Dict[str, Any]:
        payload = await request.json()
        image_path = (payload.get("image_path") or "").strip()  # MuseTalk 用视频/图底
        audio_path = (payload.get("audio_path") or "").strip()
        out_path = (payload.get("out_path") or "").strip()
        if not (image_path and audio_path and out_path):
            raise HTTPException(status_code=400, detail="image_path/audio_path/out_path 必填")
        repo = cfg.get("repo_dir") or os.path.expanduser("~/MuseTalk")
        if not os.path.isdir(repo):
            app.state.lib_error = f"MuseTalk 仓未找到: {repo}(先在运行时框架安装)"
            raise HTTPException(status_code=503, detail=app.state.lib_error)
        py = cfg.get("python_exe") or __import__("sys").executable
        # [GPU-VERIFY] 下面命令行是 best-effort 骨架,真实参数/配置以 MuseTalk 仓 README 实测调整。
        cmd = [py, "-m", cfg.get("infer_module", "scripts.inference"),
               "--video_path", image_path, "--audio_path", audio_path,
               "--result_dir", os.path.dirname(out_path) or "."]
        try:
            subprocess.run(cmd, cwd=repo, check=True, timeout=1800,
                           capture_output=True, text=True)
        except Exception as e:  # noqa: BLE001
            logger.exception("MuseTalk inference failed")
            raise HTTPException(status_code=500, detail=f"MuseTalk 推理失败: {e}") from e
        app.state.lib_loaded = True
        if not os.path.isfile(out_path):
            # [GPU-VERIFY] MuseTalk 产物文件名可能不是 out_path,需按其 result_dir 命名规则
            # 找到真实产物再拷到 out_path(实测后补)。
            raise HTTPException(status_code=500, detail="MuseTalk 未产出指定 out_path(产物命名待对齐)")
        return {"ok": True, "out_path": out_path}


def main() -> None:
    args = parse_serve_args(default_port=18780)
    app = make_runtime_app(
        framework="musetalk", title="MuseTalk Runtime",
        default_config=_DEFAULT_CONFIG, register_routes=_register_routes,
    )
    serve(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
```
> `make_runtime_app`/`parse_serve_args`/`serve` 签名对齐 `sadtalker_server.py`(GPU-P2 已验)。所有重操作在 /infer(subprocess),模块 import 干净。

- [ ] **Step 4: 跑测试 + py_compile**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_musetalk.py -k server -v`
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/modality/musetalk_server.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/modality/musetalk_server.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_musetalk.py
git commit -m "feat(dh): musetalk_server sidecar(subprocess 跑 MuseTalk inference 骨架)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: MuseTalkEngine 转发 + is_available 真检查

**Files:** `video_generation/digital_human/engine.py`,test `test_digital_human_musetalk.py`

> 完全镜像 GPU-P2 的 SadTalkerEngine,端口换 18780。READ engine.py 现有 `SadTalkerEngine`/`_sadtalker_ensure_ready`/`_port_listening`/`_engine_installed`/`get_engine` 照搬。

- [ ] **Step 1: 写测试**
```python
import os

def test_musetalk_engine_forwards(monkeypatch, tmp_path):
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    posted = {}
    class _Resp:
        status_code = 200
        def json(self): return {"ok": True}
        def raise_for_status(self): pass
    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, url, json, timeout=None):
            posted.update(url=url, body=json); return _Resp()
    monkeypatch.setattr("httpx.Client", _Client)
    monkeypatch.setattr(dh_engine, "_musetalk_ensure_ready", lambda: None)
    out = os.path.join(tmp_path, "o.mp4"); open(out, "wb").write(b"x")
    e = dh_engine.MuseTalkEngine()
    r = e.generate(avatar_path="v.mp4", audio_path="a.wav", out_path=out, width=720, height=1280)
    assert r == out and posted["url"].endswith("/infer") and ":18780/" in posted["url"]

def test_get_engine_musetalk_is_real_engine():
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    assert isinstance(dh_engine.get_engine("musetalk"), dh_engine.MuseTalkEngine)

def test_musetalk_installed_reflects_port(monkeypatch):
    from chayuan.server.video_generation.digital_human import engine as dh_engine
    monkeypatch.setattr(dh_engine, "_port_listening", lambda port, timeout=0.3: port == 18780)
    assert dh_engine.is_available("musetalk") is True
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** — `engine.py`:
加常量 `_MUSETALK_PORT = 18780`。加 `_musetalk_ensure_ready()`(镜像 `_sadtalker_ensure_ready`,framework="musetalk",端口 `_MUSETALK_PORT`)+ `MuseTalkEngine`(镜像 `SadTalkerEngine`,POST `http://127.0.0.1:{_MUSETALK_PORT}/infer`)。
`_engine_installed` 把 musetalk 分支从 `return False` 改成:
```python
    if engine_id == "musetalk":
        return _port_listening(_MUSETALK_PORT)
    return False
```
`get_engine` 加 musetalk 分支:
```python
    if engine_id == "musetalk":
        return MuseTalkEngine()
```
(放在 sadtalker 分支后,`_UnavailableGpuEngine` 兜底之前。此后 `_UnavailableGpuEngine` 实际不再被任何已知引擎命中,但保留作未知/未来引擎兜底——不删。)

> ⚠ GPU-P2 把"占位引擎报错"测试改用了 `musetalk`;现在 musetalk 变真引擎。把
> `test_digital_human_jobs.py` 里 `test_get_engine_gpu_placeholder_raises_on_generate`
> 改成直接构造 `_UnavailableGpuEngine`(用一个假 spec)验证它 generate 抛"未安装",
> 不再依赖某个具体 engine_id:
> ```python
> def test_get_engine_gpu_placeholder_raises_on_generate():
>     from chayuan.server.video_generation.digital_human import engine as dh_engine
>     spec = dh_engine.EngineSpec("xfake", "X", "gpu", "image", False)
>     import pytest
>     with pytest.raises(RuntimeError, match="未安装"):
>         dh_engine._UnavailableGpuEngine(spec).generate(
>             avatar_path="a", audio_path="b", out_path="o", width=720, height=1280)
> ```

- [ ] **Step 4: 跑全 DH 测试**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -v`
Expected: musetalk 3 条 + 改写的占位测试 + 其余全 passed

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_musetalk.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): MuseTalkEngine 转发 sidecar + musetalk 真可用性检查

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 全链路自检 + 推送

- [ ] **Step 1:** `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -q`(全 passed)
- [ ] **Step 2:** `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/*.py chayuan-server/libs/chayuan-server/chayuan/server/modality/musetalk_server.py chayuan-server/libs/chayuan-server/chayuan/server/config_panel/{runtime_framework_panel,install_task_manager,install_recipes}.py`
- [ ] **Step 3:** `cd /work/chayuan-desktop && git push origin main`

> 前端无需改:引擎 picker 已按 `/engines` 的 `installed` 动态 gating;musetalk 装好+起 sidecar 后 `_engine_installed` 返 True,picker 自动放开。

---

## 自检(Self-Review)

- **Spec 覆盖**(GPU-engine design 分期 GPU-P3):MuseTalk 注册为按需 GPU 运行时(T1)、sidecar(T2)、转发 impl + 可用性检查(T3)。三引擎(wav2lip/sadtalker/musetalk)注册表齐活。
- **占位扫描**:无 TBD。`[GPU-VERIFY]` 是诚实的"实现已写、真行为待 GPU 环境验/调"标记;MuseTalk sidecar 的 subprocess 命令行是 best-effort 骨架(已显式标注)。
- **类型一致**:`MuseTalkEngine.generate` = `DigitalHumanEngine` 协议;端口 18780 三处(catalog/启动/engine 常量)一致;sidecar `/infer` body `{image_path,audio_path,out_path}` 与 engine 发送体一致。
- **不回归**:wav2lip 默认链路不变;sadtalker 不变;占位测试改为直接验 `_UnavailableGpuEngine`,不再绑具体 engine_id。
- **风险/[GPU-VERIFY]**:① MuseTalk inference 的真实命令行/配置/产物命名(本期 subprocess 骨架按常见 `scripts/inference` 猜)需用户环境实测对齐 —— 错了 /infer 会 500 带 stderr,按报错改;② 权重下载(VAE/whisper/dwpose 多组件)走 MuseTalk 自带脚本,在用户 GPU 环境跑;③ MuseTalk 吃视频底为佳;④ 自启就绪等待。**这是三个引擎里最依赖你环境迭代的一个。**

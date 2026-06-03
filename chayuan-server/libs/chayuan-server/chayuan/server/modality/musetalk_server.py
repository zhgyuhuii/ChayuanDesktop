"""MuseTalk HTTP wrapper(内置)— 数字人 talking-head(高清口型)。

调用:python -m chayuan.server.modality.musetalk_server --host 127.0.0.1 --port 18780
配置:<CHAYUAN_ROOT>/runtime/musetalk.yaml(repo_dir / python_exe / 推理脚本参数)
需 GPU。MuseTalk 不是 modelscope pipeline → 用 subprocess 跑仓内 inference 脚本。
[GPU-VERIFY] 真实命令行/配置/产物路径以用户环境 MuseTalk 仓实测为准。
"""
from __future__ import annotations

import logging
import os
import subprocess
from typing import Any, Dict

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app,
    parse_serve_args,
    serve,
)

logger = logging.getLogger("chayuan.modality.musetalk_server")

_DEFAULT_CONFIG: Dict[str, Any] = {
    "repo_dir": "",  # 空=运行时解析(优先 bundled 数据目录,回退 ~/MuseTalk)
    "python_exe": "",
    "infer_module": "scripts.inference",
}


def _resolve_musetalk_repo() -> str:
    """MuseTalk 仓目录:优先 bundled(CHAYUAN_ROOT/models/bundled/digital_human/musetalk
    → vendor),未命中回退 ~/MuseTalk(老行为)。"""
    try:
        from chayuan.server.video_generation.digital_human.engine import _bundled_engine_dir
        d = _bundled_engine_dir("musetalk")
        if d:
            return d
    except Exception:  # noqa: BLE001
        pass
    return os.path.expanduser("~/MuseTalk")


def _register_routes(app: Any, cfg: Dict[str, Any]) -> None:
    from fastapi import HTTPException, Request

    @app.post("/infer")
    async def infer(request: Request) -> Dict[str, Any]:
        payload = await request.json()
        image_path = (payload.get("image_path") or "").strip()
        audio_path = (payload.get("audio_path") or "").strip()
        out_path = (payload.get("out_path") or "").strip()
        if not (image_path and audio_path and out_path):
            raise HTTPException(status_code=400, detail="image_path/audio_path/out_path 必填")
        repo = cfg.get("repo_dir") or _resolve_musetalk_repo()
        if not os.path.isdir(repo):
            app.state.lib_error = f"MuseTalk 仓未找到: {repo}(先在运行时框架安装)"
            raise HTTPException(status_code=503, detail=app.state.lib_error)
        import sys as _sys
        py = cfg.get("python_exe") or _sys.executable
        # [GPU-VERIFY] best-effort 命令行,真实参数以 MuseTalk 仓 README 实测调整。
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
            # [GPU-VERIFY] MuseTalk 产物命名/位置可能不是 out_path,需按其 result_dir 规则
            # 找真实产物再拷过去(实测后补)。
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

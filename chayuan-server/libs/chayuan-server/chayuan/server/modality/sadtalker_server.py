"""SadTalker HTTP wrapper(内置)— 数字人 talking-head。

调用:python -m chayuan.server.modality.sadtalker_server --host 127.0.0.1 --port 18680
配置:<CHAYUAN_ROOT>/runtime/sadtalker.yaml
需 GPU + modelscope(按需装);首次 pipeline() 自动拉 wwd123/sadtalker checkpoints。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app,
    parse_serve_args,
    serve,
)

logger = logging.getLogger("chayuan.modality.sadtalker_server")

_DEFAULT_CONFIG: Dict[str, Any] = {
    "model_id": "wwd123/sadtalker",
    "model_revision": "v1.0.0",
    "task": "talking-head",
}


def _pick_sadtalker_dir(bases) -> Optional[str]:
    """在每个 base 的 ``sadtalker/`` 子目录里找非空权重目录,返回首个命中。"""
    for base in bases:
        cand = Path(base) / "sadtalker"
        if cand.is_dir() and any(
            p.is_file() and p.suffix.lower() in (".pth", ".safetensors", ".bin", ".tar")
            for p in cand.rglob("*")
        ):
            return str(cand)
    return None


def _resolve_sadtalker_dir() -> Optional[str]:
    """本地 SadTalker 权重目录:CHAYUAN_ROOT/models/bundled/digital_human/sadtalker
    → vendor/bundled_models/digital_human/sadtalker。未命中返回 None(回退联网)。"""
    bases = []
    try:
        from chayuan.settings import CHAYUAN_ROOT
        bases.append(Path(CHAYUAN_ROOT) / "models" / "bundled" / "digital_human")
    except Exception:  # noqa: BLE001
        pass
    here = Path(__file__).resolve()
    for parent in here.parents:
        vd = parent / "vendor" / "bundled_models" / "digital_human"
        if vd.is_dir():
            bases.append(vd); break
    return _pick_sadtalker_dir(bases)


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
            local_dir = _resolve_sadtalker_dir()
            model_arg = local_dir or cfg.get("model_id", "wwd123/sadtalker")
            handle = pipeline(
                task=cfg.get("task", "talking-head"),
                model=model_arg,
                model_revision=None if local_dir else cfg.get("model_revision", "v1.0.0"),
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
        # [GPU-VERIFY] ModelScope talking-head pipeline 的真实输入/输出键名 +
        # 产物落盘方式需用户 GPU 环境实测对齐;错了按 traceback 改。
        import os
        import shutil

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
        framework="sadtalker",
        title="SadTalker Runtime",
        default_config=_DEFAULT_CONFIG,
        register_routes=_register_routes,
    )
    serve(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()

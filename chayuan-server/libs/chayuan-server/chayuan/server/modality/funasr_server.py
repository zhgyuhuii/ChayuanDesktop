"""FunASR HTTP wrapper(内置).

调用方式:
    python -m chayuan.server.modality.funasr_server --host 127.0.0.1 --port 18180

配置文件: <CHAYUAN_ROOT>/runtime/funasr.yaml(首次启动自动生成默认配置)。
被 chayuan-server 配置面板里"FunASR 已安装·未启动 → ▶ 启动"按钮调用。

懒加载:启动时不预加载模型(避免秒级启动变成几十秒);
       首次 POST /v1/audio/transcriptions 时才 import funasr 并加载模型。
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from chayuan.server.modality._runtime_server_base import (
    make_runtime_app,
    parse_serve_args,
    serve,
)

logger = logging.getLogger("chayuan.modality.funasr_server")

# 默认配置 — 首次启动会被写入 <CHAYUAN_ROOT>/runtime/funasr.yaml,可在 UI 里编辑
_DEFAULT_CONFIG: Dict[str, Any] = {
    "model": "paraformer-zh",      # 主 ASR 模型;可改为 "paraformer-en" 等
    "vad_model": "fsmn-vad",       # 语音端点检测;空字符串关闭
    "punc_model": "ct-punc",       # 标点符号;空字符串关闭
    "device": "cpu",                # cpu / cuda
    "ngpu": 0,                      # 0 = 纯 CPU
    "ncpu": 4,                      # 并行 CPU 线程
    "language": "zh",               # 默认识别语言
    "model_revision": "",           # 留空走 funasr 默认版本
}


def _register_routes(app: Any, cfg: Dict[str, Any]) -> None:
    """挂 FunASR 业务端点。"""
    from fastapi import HTTPException, Request

    def _ensure_loaded() -> Any:
        """懒加载 funasr.AutoModel;失败抛 HTTP 503,触发 UI 提示重装。"""
        if app.state.lib_loaded and app.state.lib_handle is not None:
            return app.state.lib_handle
        try:
            from funasr import AutoModel  # type: ignore
        except ImportError as e:
            app.state.lib_error = "funasr 未安装,请 pip install funasr"
            raise HTTPException(status_code=503, detail=app.state.lib_error) from e
        try:
            kwargs: Dict[str, Any] = {"model": cfg.get("model", "paraformer-zh")}
            if cfg.get("vad_model"):
                kwargs["vad_model"] = cfg["vad_model"]
            if cfg.get("punc_model"):
                kwargs["punc_model"] = cfg["punc_model"]
            if cfg.get("model_revision"):
                kwargs["model_revision"] = cfg["model_revision"]
            kwargs["ngpu"] = int(cfg.get("ngpu", 0) or 0)
            kwargs["ncpu"] = int(cfg.get("ncpu", 4) or 4)
            handle = AutoModel(**kwargs)
        except Exception as e:  # noqa: BLE001
            app.state.lib_error = f"FunASR 初始化失败: {e}"
            logger.exception("FunASR init failed")
            raise HTTPException(status_code=503, detail=app.state.lib_error) from e
        app.state.lib_handle = handle
        app.state.lib_loaded = True
        app.state.lib_error = ""
        return handle

    @app.post("/v1/audio/transcriptions")
    async def transcribe(request: Request) -> Dict[str, Any]:
        """OpenAI 兼容的转写端点。

        body 兼容两种:
            * {"file": "/abs/path/or/url"}                       (json)
            * multipart/form-data with field "file"              (二进制)
        """
        ctype = request.headers.get("content-type", "")
        file_value: Any = None
        if "multipart/form-data" in ctype:
            form = await request.form()
            up = form.get("file")
            if up is not None and hasattr(up, "read"):
                # FastAPI UploadFile;落盘到 tmp 让 FunASR 直接读
                import tempfile
                from pathlib import Path
                td = tempfile.mkdtemp(prefix="chayuan_funasr_")
                p = Path(td) / (getattr(up, "filename", None) or "input.audio")
                p.write_bytes(await up.read())
                file_value = str(p)
        else:
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            file_value = payload.get("file") if isinstance(payload, dict) else None

        if not file_value:
            raise HTTPException(status_code=400, detail="file 字段必填(json 或 multipart)")

        handle = _ensure_loaded()
        try:
            result = handle.generate(input=file_value, language=cfg.get("language", "zh"))
        except Exception as e:  # noqa: BLE001
            logger.exception("FunASR generate failed")
            raise HTTPException(status_code=500, detail=f"FunASR 转写失败: {e}") from e
        text = ""
        if isinstance(result, list) and result:
            text = result[0].get("text", "") or ""
        return {"text": text, "model": cfg.get("model"), "framework": "funasr"}


def main() -> None:
    args = parse_serve_args(default_port=18180)
    app = make_runtime_app(
        framework="funasr",
        title="Chayuan FunASR Wrapper",
        default_config=_DEFAULT_CONFIG,
        register_routes=_register_routes,
    )
    serve(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()

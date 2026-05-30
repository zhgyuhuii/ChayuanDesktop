"""数字人引擎 provider 抽象 + Wav2Lip 实现(in-proc,模型 module 级缓存)。

未来换 ONNX / 独立 sidecar / GPU 高质量:实现同 ``DigitalHumanEngine`` 协议,
改 ``get_engine()`` 选择即可,上层 jobs/routes 不动。
"""
from __future__ import annotations
import logging, os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

logger = logging.getLogger("chayuan.dh.engine")
ProgressCb = Callable[[int], None]


class DigitalHumanEngine(Protocol):
    def generate(self, *, avatar_path: str, audio_path: str, out_path: str,
                 width: int, height: int,
                 on_progress: Optional[ProgressCb] = None) -> str: ...


def _resolve_wav2lip_dir() -> Optional[str]:
    """含 wav2lip_gan.pth + s3fd 的本地权重目录。
    顺序:CHAYUAN_ROOT/models/bundled/digital_human → vendor/bundled_models/digital_human。
    """
    roots = []
    try:
        from chayuan.settings import CHAYUAN_ROOT
        roots.append(Path(CHAYUAN_ROOT) / "models" / "bundled" / "digital_human")
    except Exception:  # noqa: BLE001
        pass
    here = Path(__file__).resolve()
    for parent in here.parents:
        vd = parent / "vendor" / "bundled_models" / "digital_human"
        if vd.is_dir():
            roots.append(vd); break
    for r in roots:
        if (Path(r) / "wav2lip_gan.pth").is_file():
            return str(r)
    return None


class Wav2LipEngine:
    """Wav2Lip in-proc。模型权重 module 级缓存(首次加载一次)。"""
    _handle: Any = None  # 缓存的 (model, face_detector)

    def generate(self, *, avatar_path: str, audio_path: str, out_path: str,
                 width: int, height: int,
                 on_progress: Optional[ProgressCb] = None) -> str:
        from chayuan.server.video_generation.digital_human.wav2lip import infer as w2l
        weights_dir = _resolve_wav2lip_dir()
        if not weights_dir:
            raise RuntimeError(
                "Wav2Lip 权重未就绪:跑 scripts/seed_digital_human.py 或确认 "
                "vendor/bundled_models/digital_human/wav2lip_gan.pth 存在"
            )
        if Wav2LipEngine._handle is None:
            Wav2LipEngine._handle = w2l.load_models(weights_dir)
        w2l.run(
            handle=Wav2LipEngine._handle, face=avatar_path, audio=audio_path,
            out_path=out_path, out_size=(width, height), on_progress=on_progress,
        )
        if not os.path.isfile(out_path):
            raise RuntimeError("Wav2Lip 未产出 mp4")
        return out_path


@dataclass(frozen=True)
class EngineSpec:
    id: str
    label: str
    kind: str       # "cpu" | "gpu"
    input: str      # "image" | "video" | "both"
    builtin: bool


_SPECS: dict[str, EngineSpec] = {
    "wav2lip":   EngineSpec("wav2lip",   "Wav2Lip · 快速(CPU)",     "cpu", "both",  True),
    "sadtalker": EngineSpec("sadtalker", "SadTalker · 高清头动(GPU)", "gpu", "image", False),
    "musetalk":  EngineSpec("musetalk",  "MuseTalk · 高清口型(GPU)",  "gpu", "video", False),
}


class _UnavailableGpuEngine:
    """GPU 引擎占位(GPU-P1 只搭骨架,真实现 P2/P3)。generate 抛"未安装"明确错误,
    绝不静默回退 Wav2Lip(避免用户以为用了高质量档)。"""
    def __init__(self, spec: EngineSpec) -> None:
        self._spec = spec

    def generate(self, *, avatar_path: str, audio_path: str, out_path: str,
                 width: int, height: int,
                 on_progress: Optional[ProgressCb] = None) -> str:
        raise RuntimeError(
            f"{self._spec.label} 运行时未安装：请在模型广场安装 {self._spec.id} "
            f"运行时后重试（需 GPU）"
        )


def _engine_installed(engine_id: str) -> bool:
    spec = _SPECS.get(engine_id)
    if spec is None:
        return False
    if spec.builtin:
        return True
    # GPU-P1:真 GPU 运行时尚未实现 → 恒 False。GPU-P2/P3 在此接
    # local_runtime_registry 查"运行时已装 + sidecar /health ready"。
    return False


def is_available(engine_id: str) -> bool:
    return _engine_installed(engine_id)


def get_engine(engine_id: str = "wav2lip") -> DigitalHumanEngine:
    if engine_id == "wav2lip":
        return Wav2LipEngine()
    spec = _SPECS.get(engine_id)
    if spec is None:
        raise RuntimeError(f"未知引擎: {engine_id}")
    return _UnavailableGpuEngine(spec)


def list_engines() -> list[dict]:
    return [
        {"id": s.id, "label": s.label, "kind": s.kind, "input": s.input,
         "builtin": s.builtin, "installed": _engine_installed(s.id)}
        for s in _SPECS.values()
    ]

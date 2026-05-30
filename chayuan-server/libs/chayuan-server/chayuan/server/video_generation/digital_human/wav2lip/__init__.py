# Source: Rudrabha/Wav2Lip (https://github.com/Rudrabha/Wav2Lip)
# License: research-only; 商用前需法务确认或换商用许可模型
"""Vendored Wav2Lip inference package.

The official Wav2Lip source files are vendored verbatim under:
  models/          – Wav2Lip generator, SyncNet, conv helpers
  audio.py         – mel-spectrogram helpers (official hparams)
  hparams.py       – HParams dataclass with official defaults
  face_detection/  – S3FD-based face detector (FaceAlignment API)

Public API (import via infer sub-module only):
  infer.load_models(weights_dir) -> handle
  infer.run(*, handle, face, audio, out_path, out_size, on_progress) -> str

No heavy imports at package level — torch/cv2/librosa are only imported
inside infer.load_models / infer.run so this package can be imported safely
on machines without those libraries.
"""

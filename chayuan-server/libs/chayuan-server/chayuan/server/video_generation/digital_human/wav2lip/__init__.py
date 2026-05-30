# Source: Rudrabha/Wav2Lip (https://github.com/Rudrabha/Wav2Lip)
# License: research-only; 商用前需法务确认或换商用许可模型
"""Vendored minimal Wav2Lip inference package.

Only exposes:
  infer.load_models(weights_dir) -> handle
  infer.run(*, handle, face, audio, out_path, out_size, on_progress) -> str

All heavy imports (torch, cv2, numpy, librosa) are deferred inside functions
so this package can be imported safely on machines without those libraries.
"""

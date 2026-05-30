# Source: Rudrabha/Wav2Lip (https://github.com/Rudrabha/Wav2Lip)
# License: research-only; 商用前需法务确认或换商用许可模型
"""Wav2Lip minimal inference entry-point.

Public contract (called by engine.py):

    handle = load_models(weights_dir: str)
    out    = run(*, handle, face, audio, out_path, out_size, on_progress=None)

All heavy imports (torch, cv2, numpy, librosa) are deferred inside functions
so this module imports cleanly on a machine without those libraries.

Mel-spectrogram hyperparameters faithfully match the official Wav2Lip audio.py:
  sample_rate   = 16000
  n_mels        = 80
  hop_length    = 200   (12.5 ms @16kHz)
  win_length    = 800   (50  ms @16kHz)
  n_fft         = 800
  fmin          = 55
  fmax          = 7600
  mel_step_size = 16    (frames per audio chunk fed to the network)

Face crop size matches the official inference: 96x96.
"""
from __future__ import annotations

import os
import logging
import tempfile
from pathlib import Path
from typing import Callable, Optional, Tuple

logger = logging.getLogger("chayuan.dh.wav2lip.infer")

# ---- Mel hparams (official audio.py) ----------------------------------------
_SR           = 16000
_N_MELS       = 80
_HOP          = 200
_WIN          = 800
_N_FFT        = 800
_FMIN         = 55
_FMAX         = 7600
_MEL_STEP     = 16    # mel frames per chunk fed to the network

# Face crop size used by the official inference
_FACE_SIZE    = 96

# Fps assumed for the output video (overridden by source video fps when available)
_DEFAULT_FPS  = 25.0

# ---- Internal model handle --------------------------------------------------

class _Handle:
    """Opaque handle holding loaded models, device, and weights path."""

    def __init__(self, wav2lip_net, s3fd_net, device: str):
        self.wav2lip_net = wav2lip_net
        self.s3fd_net    = s3fd_net
        self.device      = device


# ---- Public API -------------------------------------------------------------

def load_models(weights_dir: str) -> _Handle:
    """Load wav2lip_gan.pth + s3fd-619a316812.pth from *weights_dir*.

    Returns an opaque *handle* for reuse across calls.  Raises FileNotFoundError
    if the weight files are absent.
    """
    import torch

    # Validate weight files
    w2l_path  = os.path.join(weights_dir, "wav2lip_gan.pth")
    s3fd_path = os.path.join(weights_dir, "s3fd-619a316812.pth")
    if not os.path.isfile(w2l_path):
        raise FileNotFoundError(f"Wav2Lip weights not found: {w2l_path}")
    if not os.path.isfile(s3fd_path):
        raise FileNotFoundError(f"S3FD weights not found: {s3fd_path}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Wav2Lip: loading models on device=%s", device)

    # Load Wav2Lip generator
    from .models import build_wav2lip_model
    wav2lip_net = build_wav2lip_model()
    checkpoint  = torch.load(w2l_path, map_location=device)
    # Official checkpoint saves the state_dict under key "state_dict"
    state_dict  = checkpoint.get("state_dict", checkpoint)
    # Strip "module." prefix if saved with DataParallel
    cleaned = {k.replace("module.", ""): v for k, v in state_dict.items()}
    wav2lip_net.load_state_dict(cleaned)
    wav2lip_net.eval()
    wav2lip_net.to(device)

    # Load S3FD face detector
    from .face_detect import load_s3fd
    s3fd_net = load_s3fd(s3fd_path, device)

    logger.info("Wav2Lip: models loaded successfully")
    return _Handle(wav2lip_net, s3fd_net, device)


def run(
    *,
    handle: _Handle,
    face: str,
    audio: str,
    out_path: str,
    out_size: Tuple[int, int],
    on_progress: Optional[Callable[[int], None]] = None,
) -> str:
    """Synthesise lip-sync video.

    Parameters
    ----------
    handle    : opaque object returned by :func:`load_models`
    face      : path to an image (single frame loop) or video file
    audio     : path to a WAV file (any sample rate; resampled to 16kHz)
    out_path  : destination mp4 file path
    out_size  : (width, height) of the output video
    on_progress : optional callback(int 0..100)

    Returns
    -------
    out_path  : same as the *out_path* argument
    """
    import numpy as np
    import cv2

    _prog(on_progress, 0)

    # ------------------------------------------------------------------
    # 1. Read face frames
    # ------------------------------------------------------------------
    frames, fps = _read_face(face)
    if len(frames) == 0:
        raise RuntimeError("未检测到人脸,请换正脸形象 (source is empty)")

    _prog(on_progress, 5)

    # ------------------------------------------------------------------
    # 2. Face detection on every frame → crop lower-half regions
    # ------------------------------------------------------------------
    from .face_detect import detect_faces

    face_det_results = []  # list of (bbox, padded_face_crop, coords) per frame
    total_frames = len(frames)
    for fi, frame in enumerate(frames):
        bboxes = detect_faces(handle.s3fd_net, frame, handle.device)
        if not bboxes:
            raise RuntimeError(
                "未检测到人脸,请换正脸形象 "
                f"(frame {fi} out of {total_frames} has no face)"
            )
        x1, y1, x2, y2, _score = bboxes[0]
        x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
        # Pad lower-half of face (Wav2Lip convention: mask lower half when feeding)
        y1_lower = y1 + (y2 - y1) // 2
        coords = (x1, y1_lower, x2, y2)
        crop = _crop_and_resize(frame, coords, _FACE_SIZE)
        face_det_results.append((coords, crop, frame.copy()))

        prog_frac = 5 + int(25 * fi / total_frames)
        _prog(on_progress, prog_frac)

    _prog(on_progress, 30)

    # ------------------------------------------------------------------
    # 3. Build mel spectrogram chunks
    # ------------------------------------------------------------------
    mel_chunks = _build_mel_chunks(audio, fps)
    if len(mel_chunks) == 0:
        raise RuntimeError("音频太短或无法解码,请换有效 WAV 文件")

    _prog(on_progress, 40)

    # ------------------------------------------------------------------
    # 4. Loop frames to match mel chunks (official inference behaviour)
    # ------------------------------------------------------------------
    n_chunks = len(mel_chunks)
    # Extend or loop face frames to match number of mel chunks
    if total_frames < n_chunks:
        # Loop
        reps = (n_chunks // total_frames) + 1
        face_det_results = (face_det_results * reps)[:n_chunks]
    else:
        face_det_results = face_det_results[:n_chunks]

    _prog(on_progress, 42)

    # ------------------------------------------------------------------
    # 5. Inference: batch inference for efficiency
    # ------------------------------------------------------------------
    gen_frames = _batch_inference(
        handle, face_det_results, mel_chunks, on_progress, start=42, end=90
    )
    _prog(on_progress, 90)

    # ------------------------------------------------------------------
    # 6. Compose output video via ffmpeg
    # ------------------------------------------------------------------
    out_w, out_h = out_size
    _write_video(gen_frames, audio, out_path, fps, out_w, out_h)
    _prog(on_progress, 100)

    return out_path


# ---- Helpers ----------------------------------------------------------------

def _prog(cb: Optional[Callable[[int], None]], v: int) -> None:
    if cb is not None:
        try:
            cb(v)
        except Exception:  # noqa: BLE001
            pass


def _read_face(face_path: str):
    """Return (list_of_bgr_frames, fps).

    If face_path is an image, returns a single-element list and fps=_DEFAULT_FPS.
    If face_path is a video, reads all frames.
    """
    import cv2
    import numpy as np

    img_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    ext = Path(face_path).suffix.lower()
    if ext in img_exts:
        img = cv2.imread(face_path)
        if img is None:
            raise RuntimeError(f"无法读取形象图: {face_path}")
        return [img], _DEFAULT_FPS

    cap = cv2.VideoCapture(face_path)
    if not cap.isOpened():
        raise RuntimeError(f"无法打开形象视频: {face_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or _DEFAULT_FPS
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frames.append(frame)
    cap.release()
    if not frames:
        raise RuntimeError(f"形象视频无帧: {face_path}")
    return frames, fps


def _crop_and_resize(frame, coords, size: int):
    """Crop *coords* (x1,y1,x2,y2) from *frame*, resize to (size, size)."""
    import cv2
    x1, y1, x2, y2 = coords
    h, w = frame.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        import numpy as np
        return np.zeros((size, size, 3), dtype=np.uint8)
    return cv2.resize(crop, (size, size))


def _build_mel_chunks(audio_path: str, fps: float):
    """Load WAV → resample → mel-spectrogram → slice into chunks.

    Each chunk is a numpy array of shape [80, mel_step_size].
    The number of chunks equals the number of output video frames.
    """
    import numpy as np
    import librosa

    y, _sr = librosa.load(audio_path, sr=_SR, mono=True)

    # Build mel spectrogram using official hparams
    mel = librosa.feature.melspectrogram(
        y=y,
        sr=_SR,
        n_fft=_N_FFT,
        hop_length=_HOP,
        win_length=_WIN,
        n_mels=_N_MELS,
        fmin=_FMIN,
        fmax=_FMAX,
    )
    # Convert to log scale (official uses np.log10 clamped at -5)
    mel = np.log10(np.maximum(mel, 1e-5))

    # Number of mel frames per video frame
    mel_fps = _SR / _HOP           # mel frames per second ≈ 80 for 16kHz/hop200
    mel_per_vid_frame = mel_fps / fps

    # Number of video frames
    n_vid_frames = int(mel.shape[1] / mel_per_vid_frame)

    chunks = []
    for i in range(n_vid_frames):
        mel_start = int(round(i * mel_per_vid_frame))
        mel_end   = mel_start + _MEL_STEP
        if mel_end > mel.shape[1]:
            # Pad the last chunk
            chunk = mel[:, mel_start:]
            pad_w = _MEL_STEP - chunk.shape[1]
            chunk = np.pad(chunk, ((0, 0), (0, pad_w)), mode="edge")
        else:
            chunk = mel[:, mel_start:mel_end]
        chunks.append(chunk)          # shape [80, 16]

    return chunks


def _batch_inference(handle: _Handle, face_det_results, mel_chunks,
                     on_progress, start: int, end: int):
    """Run Wav2Lip inference in batches.

    Returns list of final BGR frames (already composited onto original frame).
    """
    import numpy as np
    import torch
    import cv2

    device = handle.device
    batch_size = 128
    gen_frames = []
    n = len(face_det_results)

    for batch_start in range(0, n, batch_size):
        batch_end_idx = min(batch_start + batch_size, n)
        face_batch  = []
        audio_batch = []
        meta_batch  = []   # (coords, original_frame)

        for i in range(batch_start, batch_end_idx):
            coords, crop_lower, orig_frame = face_det_results[i]
            mel_chunk = mel_chunks[i]

            # Build the input face tensor: [6, 96, 96]
            # Upper half → zeroed (masked), lower half → crop
            # Two frames: masked + original (official inputs both halves)
            face_frame = cv2.resize(
                orig_frame[coords[1]:coords[3], coords[0]:coords[2]],
                (_FACE_SIZE, _FACE_SIZE)
            )
            masked = face_frame.copy()
            masked[_FACE_SIZE // 2:] = 0   # mask lower half

            # Normalise to [0, 1] and stack [masked | original] → [6, H, W]
            m = (masked.astype(np.float32) / 255.0).transpose(2, 0, 1)
            o = (face_frame.astype(np.float32) / 255.0).transpose(2, 0, 1)
            face_t = np.concatenate([m, o], axis=0)  # [6, 96, 96]

            # Mel chunk: [1, 80, 16]
            audio_t = mel_chunk[np.newaxis]           # [1, 80, 16]

            face_batch.append(face_t)
            audio_batch.append(audio_t)
            meta_batch.append((coords, orig_frame))

        face_arr  = np.stack(face_batch,  axis=0)   # [B, 6, 96, 96]
        audio_arr = np.stack(audio_batch, axis=0)   # [B, 1, 80, 16]

        face_t  = torch.FloatTensor(face_arr).to(device)
        audio_t = torch.FloatTensor(audio_arr).to(device)

        with torch.no_grad():
            pred = handle.wav2lip_net(audio_t, face_t)  # [B, 3, 96, 96]

        pred_np = pred.cpu().numpy()                   # [B, 3, 96, 96]

        for bi, (coords, orig_frame) in enumerate(meta_batch):
            p = pred_np[bi].transpose(1, 2, 0)         # [96, 96, 3]
            p = np.clip(p * 255, 0, 255).astype(np.uint8)

            # Paste predicted region back into original frame
            x1, y1, x2, y2 = coords
            out_frame = orig_frame.copy()
            ph = y2 - y1
            pw = x2 - x1
            if ph > 0 and pw > 0:
                p_resized = cv2.resize(p, (pw, ph))
                out_frame[y1:y2, x1:x2] = p_resized

            gen_frames.append(out_frame)

        # Progress update
        prog = start + int((end - start) * batch_end_idx / n)
        _prog(on_progress, prog)

    return gen_frames


def _write_video(frames, audio_path: str, out_path: str,
                 fps: float, out_w: int, out_h: int) -> None:
    """Write frames + audio to mp4 using the project's bundled ffmpeg."""
    import numpy as np
    import cv2
    import subprocess

    # First write frames to a temp raw video (no audio)
    tmp_video = out_path + ".tmp_noaudio.mp4"
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ff = "ffmpeg"   # fallback: system ffmpeg (should not happen in bundled env)

    # Use subprocess + ffmpeg pipe to write frames
    cmd_write = [
        ff, "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{out_w}x{out_h}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",                # stdin
        "-an",
        "-vcodec", "libx264",
        "-preset", "fast",
        "-crf", "18",
        tmp_video,
    ]
    proc = subprocess.Popen(cmd_write, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for frame in frames:
        resized = cv2.resize(frame, (out_w, out_h))
        proc.stdin.write(resized.tobytes())
    proc.stdin.close()
    proc.wait()

    if not os.path.isfile(tmp_video):
        raise RuntimeError("ffmpeg 未生成临时视频文件")

    # Mux audio with the video
    cmd_mux = [
        ff, "-y",
        "-i", tmp_video,
        "-i", audio_path,
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        out_path,
    ]
    subprocess.run(cmd_mux, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        os.remove(tmp_video)
    except OSError:
        pass

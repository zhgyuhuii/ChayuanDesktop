# Source: Rudrabha/Wav2Lip (https://github.com/Rudrabha/Wav2Lip)
# License: research-only; 商用前需法务确认或换商用许可模型
"""Wav2Lip inference entry-point (adapted from official inference.py).

Public contract (called by engine.py):

    handle = load_models(weights_dir: str)
    out    = run(*, handle, face, audio, out_path, out_size, on_progress=None)

All heavy imports (torch, cv2, numpy, librosa, and from .) are deferred inside
functions so this module imports cleanly on a machine without those libraries.
"""
from __future__ import annotations

import os
import logging
import tempfile
from pathlib import Path
from typing import Callable, Optional, Tuple

logger = logging.getLogger("chayuan.dh.wav2lip.infer")

_DEFAULT_FPS = 25.0
_MEL_STEP_SIZE = 16
_IMG_SIZE = 96


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_models(weights_dir: str) -> dict:
    """Load wav2lip_gan.pth + s3fd weights from *weights_dir*.

    Returns an opaque handle dict (model, detector, device).
    Raises FileNotFoundError if weight files are absent.
    """
    import torch
    from .models import Wav2Lip
    from . import face_detection

    w2l_path = os.path.join(weights_dir, "wav2lip_gan.pth")
    s3fd_path = os.path.join(weights_dir, "s3fd-619a316812.pth")
    if not os.path.isfile(w2l_path):
        raise FileNotFoundError(f"Wav2Lip weights not found: {w2l_path}")
    if not os.path.isfile(s3fd_path):
        raise FileNotFoundError(f"S3FD weights not found: {s3fd_path}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Wav2Lip: loading models on device=%s", device)

    # Load Wav2Lip generator (official checkpoint format)
    model = Wav2Lip()
    checkpoint = torch.load(w2l_path, map_location=device)
    s = checkpoint.get("state_dict", checkpoint)
    new_s = {k.replace("module.", ""): v for k, v in s.items()}
    model.load_state_dict(new_s)
    model = model.to(device)
    model.eval()

    # Load S3FD face detector — pass local path so it never hits the network
    detector = face_detection.FaceAlignment(
        face_detection.LandmarksType._2D,
        flip_input=False,
        device=device,
        face_detector="sfd",
    )
    # Override the default weight path to our bundled file
    detector.face_detector.face_detector.load_state_dict(
        torch.load(s3fd_path, map_location=device)
    )
    detector.face_detector.face_detector.to(device)
    detector.face_detector.face_detector.eval()

    logger.info("Wav2Lip: models loaded")
    return {"model": model, "detector": detector, "device": device}


def run(
    *,
    handle: dict,
    face: str,
    audio: str,
    out_path: str,
    out_size: Tuple[int, int],
    on_progress: Optional[Callable[[int], None]] = None,
) -> str:
    """Synthesise lip-sync video.

    Parameters
    ----------
    handle    : opaque dict returned by :func:`load_models`
    face      : path to an image (single frame loop) or video file
    audio     : path to a WAV file (16 kHz preferred; other rates resampled)
    out_path  : destination mp4 file path
    out_size  : (width, height) of the output video
    on_progress : optional callback(int 0..100)

    Returns
    -------
    out_path  : same as the *out_path* argument
    """
    import numpy as np
    import cv2
    import torch
    from . import audio as wav2lip_audio

    model = handle["model"]
    detector = handle["detector"]
    device = handle["device"]

    _prog(on_progress, 0)

    # ------------------------------------------------------------------
    # 1. Read face frames (official style)
    # ------------------------------------------------------------------
    img_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    ext = Path(face).suffix.lower()
    if ext in img_exts:
        full_frames = [cv2.imread(face)]
        fps = _DEFAULT_FPS
        static = True
    else:
        video_stream = cv2.VideoCapture(face)
        fps = video_stream.get(cv2.CAP_PROP_FPS) or _DEFAULT_FPS
        full_frames = []
        while True:
            still_reading, frame = video_stream.read()
            if not still_reading:
                video_stream.release()
                break
            full_frames.append(frame)
        static = False

    if not full_frames or full_frames[0] is None:
        raise RuntimeError("未检测到人脸,请换正脸形象 (cannot read face source)")

    _prog(on_progress, 5)

    # ------------------------------------------------------------------
    # 2. Load audio and build mel chunks (official approach)
    # ------------------------------------------------------------------
    wav = wav2lip_audio.load_wav(audio, 16000)
    mel = wav2lip_audio.melspectrogram(wav)

    if np.isnan(mel.reshape(-1)).sum() > 0:
        raise ValueError(
            "Mel 含 NaN — 音频可能全静音,请检查 WAV 文件"
        )

    mel_chunks = []
    mel_idx_multiplier = 80.0 / fps
    i = 0
    while True:
        start_idx = int(i * mel_idx_multiplier)
        if start_idx + _MEL_STEP_SIZE > len(mel[0]):
            mel_chunks.append(mel[:, len(mel[0]) - _MEL_STEP_SIZE :])
            break
        mel_chunks.append(mel[:, start_idx : start_idx + _MEL_STEP_SIZE])
        i += 1

    if not mel_chunks:
        raise RuntimeError("音频太短或无法解码,请换有效 WAV 文件")

    _prog(on_progress, 15)

    # Trim / loop face frames to match mel chunks (official behaviour)
    full_frames = full_frames[: len(mel_chunks)]

    # ------------------------------------------------------------------
    # 3. Face detection (official datagen approach)
    # ------------------------------------------------------------------
    face_det_results = _face_detect(full_frames, detector, static)
    _prog(on_progress, 40)

    # ------------------------------------------------------------------
    # 4. Batch inference (official datagen + model forward)
    # ------------------------------------------------------------------
    batch_size = 128
    gen_frames = []
    gen_coords = []

    img_batch_buf, mel_batch_buf = [], []
    frame_buf, coord_buf = [], []

    for i, m in enumerate(mel_chunks):
        idx = 0 if static else (i % len(full_frames))
        frame_to_save = full_frames[idx].copy()
        face_crop, coords = face_det_results[idx]

        face_crop = cv2.resize(face_crop, (_IMG_SIZE, _IMG_SIZE))

        img_batch_buf.append(face_crop)
        mel_batch_buf.append(m)
        frame_buf.append(frame_to_save)
        coord_buf.append(coords)

        if len(img_batch_buf) >= batch_size:
            img_b, mel_b, frames_b, coords_b = _flush_batch(
                img_batch_buf, mel_batch_buf, frame_buf, coord_buf,
                model, device
            )
            gen_frames.extend(frames_b)
            gen_coords.extend(coords_b)
            img_batch_buf, mel_batch_buf, frame_buf, coord_buf = [], [], [], []

        prog = 40 + int(50 * (i + 1) / len(mel_chunks))
        _prog(on_progress, prog)

    if img_batch_buf:
        img_b, mel_b, frames_b, coords_b = _flush_batch(
            img_batch_buf, mel_batch_buf, frame_buf, coord_buf,
            model, device
        )
        gen_frames.extend(frames_b)
        gen_coords.extend(coords_b)

    _prog(on_progress, 90)

    # ------------------------------------------------------------------
    # 5. Write output video (official: raw avi then mux audio)
    # ------------------------------------------------------------------
    out_w, out_h = out_size
    frame_h, frame_w = full_frames[0].shape[:-1]
    tmp_avi = out_path + ".tmp_result.avi"
    try:
        out_writer = cv2.VideoWriter(
            tmp_avi,
            cv2.VideoWriter_fourcc(*"DIVX"),
            fps,
            (frame_w, frame_h),
        )
        for frame in gen_frames:
            out_writer.write(frame)
        out_writer.release()

        if not os.path.isfile(tmp_avi):
            raise RuntimeError("cv2.VideoWriter 未生成 AVI 文件")

        _mux_audio(tmp_avi, audio, out_path, out_w, out_h, fps)
    finally:
        try:
            os.remove(tmp_avi)
        except OSError:
            pass

    _prog(on_progress, 100)
    return out_path


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _prog(cb: Optional[Callable[[int], None]], v: int) -> None:
    if cb is not None:
        try:
            cb(v)
        except Exception:  # noqa: BLE001
            pass


def _face_detect(images, detector, static: bool):
    """Run face detection on frames, return list of (face_crop, (y1,y2,x1,x2)).

    Mirrors the official face_detect() function logic.
    """
    import numpy as np
    import cv2

    pads = (0, 10, 0, 0)  # pady1, pady2, padx1, padx2 (official defaults)
    batch_size = 16

    predictions = []
    try:
        for i in range(0, len(images), batch_size):
            batch = np.array(images[i : i + batch_size])
            predictions.extend(detector.get_detections_for_batch(batch))
    except RuntimeError:
        # OOM fallback: single-frame detection
        for img in images:
            predictions.extend(
                detector.get_detections_for_batch(np.array([img]))
            )

    results = []
    pady1, pady2, padx1, padx2 = pads
    for rect, image in zip(predictions, images):
        if rect is None:
            raise RuntimeError(
                "未检测到人脸,请换正脸形象 (face detection returned None)"
            )
        y1 = max(0, rect[1] - pady1)
        y2 = min(image.shape[0], rect[3] + pady2)
        x1 = max(0, rect[0] - padx1)
        x2 = min(image.shape[1], rect[2] + padx2)
        results.append([x1, y1, x2, y2])

    if not static:
        # Temporal smoothing (T=5 window, official get_smoothened_boxes)
        boxes = np.array(results)
        T = 5
        for i in range(len(boxes)):
            window = boxes[max(0, i - T // 2) : i + T // 2 + 1]
            boxes[i] = np.mean(window, axis=0)
        results = boxes.tolist()

    face_det_results = [
        [image[y1:y2, x1:x2], (y1, y2, x1, x2)]
        for image, (x1, y1, x2, y2) in zip(images, results)
    ]
    return face_det_results


def _flush_batch(img_batch, mel_batch, frame_batch, coords_batch, model, device):
    """Run one batch through the Wav2Lip model and paste predictions back."""
    import numpy as np
    import torch
    import cv2

    img_arr = np.asarray(img_batch)   # [B, H, W, 3]
    mel_arr = np.asarray(mel_batch)   # [B, 80, 16]

    # Mask lower half (official: img_masked[:, img_size//2:] = 0)
    img_masked = img_arr.copy()
    img_masked[:, _IMG_SIZE // 2 :] = 0

    # Concat masked + original along axis=3 (channels), then normalise
    # Official: np.concatenate((img_masked, img_batch), axis=3) / 255.
    img_input = np.concatenate((img_masked, img_arr), axis=3) / 255.0  # [B, H, W, 6]
    # Official: mel_batch = np.reshape(mel_batch, [B, 80, 16, 1])
    mel_input = np.reshape(mel_arr, [len(mel_arr), mel_arr.shape[1], mel_arr.shape[2], 1])  # [B, 80, 16, 1]

    # Transpose to [B, C, H, W] (official: (0, 3, 1, 2))
    img_t = torch.FloatTensor(np.transpose(img_input, (0, 3, 1, 2))).to(device)  # [B, 6, H, W]
    mel_t = torch.FloatTensor(np.transpose(mel_input, (0, 3, 1, 2))).to(device)  # [B, 1, 80, 16]

    with torch.no_grad():
        pred = model(mel_t, img_t)  # [B, 3, H, W]

    # Official: pred.cpu().numpy().transpose(0,2,3,1) * 255.
    pred_np = pred.cpu().numpy().transpose(0, 2, 3, 1) * 255.0  # [B, H, W, 3]

    out_frames = []
    for p, f, c in zip(pred_np, frame_batch, coords_batch):
        y1, y2, x1, x2 = c
        p_resized = cv2.resize(p.astype(np.uint8), (x2 - x1, y2 - y1))
        f[y1:y2, x1:x2] = p_resized
        out_frames.append(f)

    return None, None, out_frames, coords_batch


def _mux_audio(
    tmp_avi: str,
    audio_path: str,
    out_path: str,
    out_w: int,
    out_h: int,
    fps: float,
) -> None:
    """Mux video frames + audio to final mp4 using bundled ffmpeg."""
    import subprocess

    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        ff = "ffmpeg"  # fallback: system ffmpeg

    # Resize + mux: scale to out_size, add audio
    cmd = [
        ff, "-y",
        "-i", tmp_avi,
        "-i", audio_path,
        "-vf", f"scale={out_w}:{out_h}",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-c:a", "aac",
        "-strict", "-2",
        "-q:v", "1",
        out_path,
    ]
    subprocess.run(
        cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )

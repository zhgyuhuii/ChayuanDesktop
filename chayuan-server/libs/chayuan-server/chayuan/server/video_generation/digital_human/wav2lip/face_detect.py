# Source: Rudrabha/Wav2Lip (https://github.com/Rudrabha/Wav2Lip)
# License: research-only; 商用前需法务确认或换商用许可模型
"""S3FD-based face detector wrapper.

Ported from:
  https://github.com/Rudrabha/Wav2Lip/blob/master/face_detection/

The S3FD (Single Shot Scale-invariant Face Detector) model file is:
  s3fd-619a316812.pth  (must live in weights_dir alongside wav2lip_gan.pth)

All heavy imports (torch, numpy, cv2) are deferred inside functions.
"""
from __future__ import annotations

import os
from typing import List, Tuple

# Bounding-box type: (x1, y1, x2, y2, score)
BBox = Tuple[float, float, float, float, float]

# -------------------------------------------------------------------
# S3FD network definition (faithful to the Wav2Lip repo's face_detection/)
# -------------------------------------------------------------------

def _build_s3fd():
    """Build the S3FD network.  Must be called only when torch is available."""
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class L2Norm(nn.Module):
        def __init__(self, n_channels: int, scale: float = 1.0):
            super().__init__()
            self.n_channels = n_channels
            self.gamma = nn.Parameter(torch.Tensor(n_channels).fill_(scale))
            self.eps = 1e-10

        def forward(self, x):
            norm = x.pow(2).sum(dim=1, keepdim=True).sqrt() + self.eps
            x = x / norm
            return self.gamma.unsqueeze(0).unsqueeze(2).unsqueeze(3).expand_as(x) * x

    class S3FD(nn.Module):
        def __init__(self):
            super().__init__()
            # VGG-16 conv feature extraction backbone
            self.conv1_1 = nn.Conv2d(3, 64, 3, 1, 1)
            self.conv1_2 = nn.Conv2d(64, 64, 3, 1, 1)

            self.conv2_1 = nn.Conv2d(64, 128, 3, 1, 1)
            self.conv2_2 = nn.Conv2d(128, 128, 3, 1, 1)

            self.conv3_1 = nn.Conv2d(128, 256, 3, 1, 1)
            self.conv3_2 = nn.Conv2d(256, 256, 3, 1, 1)
            self.conv3_3 = nn.Conv2d(256, 256, 3, 1, 1)

            self.conv4_1 = nn.Conv2d(256, 512, 3, 1, 1)
            self.conv4_2 = nn.Conv2d(512, 512, 3, 1, 1)
            self.conv4_3 = nn.Conv2d(512, 512, 3, 1, 1)

            self.conv5_1 = nn.Conv2d(512, 512, 3, 1, 1)
            self.conv5_2 = nn.Conv2d(512, 512, 3, 1, 1)
            self.conv5_3 = nn.Conv2d(512, 512, 3, 1, 1)

            # Extra SSD layers
            self.fc6 = nn.Conv2d(512, 1024, 3, 1, 6, dilation=6)
            self.fc7 = nn.Conv2d(1024, 1024, 1, 1, 0)
            self.conv6_1 = nn.Conv2d(1024, 256, 1, 1, 0)
            self.conv6_2 = nn.Conv2d(256, 512, 3, 2, 1)
            self.conv7_1 = nn.Conv2d(512, 128, 1, 1, 0)
            self.conv7_2 = nn.Conv2d(128, 256, 3, 2, 1)

            # L2 normalization for shallow features
            self.conv3_3_norm = L2Norm(256, scale=10)
            self.conv4_3_norm = L2Norm(512, scale=8)
            self.conv5_3_norm = L2Norm(512, scale=5)

            # Classification heads (face / not-face)
            self.conv3_3_norm_mbox_conf = nn.Conv2d(256, 4, 3, 1, 1)
            self.conv4_3_norm_mbox_conf = nn.Conv2d(512, 2, 3, 1, 1)
            self.conv5_3_norm_mbox_conf = nn.Conv2d(512, 2, 3, 1, 1)
            self.fc7_mbox_conf = nn.Conv2d(1024, 2, 3, 1, 1)
            self.conv6_2_mbox_conf = nn.Conv2d(512, 2, 3, 1, 1)
            self.conv7_2_mbox_conf = nn.Conv2d(256, 2, 3, 1, 1)

            # Localisation heads
            self.conv3_3_norm_mbox_loc = nn.Conv2d(256, 4, 3, 1, 1)
            self.conv4_3_norm_mbox_loc = nn.Conv2d(512, 4, 3, 1, 1)
            self.conv5_3_norm_mbox_loc = nn.Conv2d(512, 4, 3, 1, 1)
            self.fc7_mbox_loc = nn.Conv2d(1024, 4, 3, 1, 1)
            self.conv6_2_mbox_loc = nn.Conv2d(512, 4, 3, 1, 1)
            self.conv7_2_mbox_loc = nn.Conv2d(256, 4, 3, 1, 1)

        def forward(self, x):
            # Input: [B, 3, H, W]  (mean-subtracted BGR)
            h = F.relu(self.conv1_1(x), inplace=True)
            h = F.relu(self.conv1_2(h), inplace=True)
            h = F.max_pool2d(h, 2, 2)

            h = F.relu(self.conv2_1(h), inplace=True)
            h = F.relu(self.conv2_2(h), inplace=True)
            h = F.max_pool2d(h, 2, 2)

            h = F.relu(self.conv3_1(h), inplace=True)
            h = F.relu(self.conv3_2(h), inplace=True)
            h = F.relu(self.conv3_3(h), inplace=True)
            f3_3 = h
            h = F.max_pool2d(h, 2, 2)

            h = F.relu(self.conv4_1(h), inplace=True)
            h = F.relu(self.conv4_2(h), inplace=True)
            h = F.relu(self.conv4_3(h), inplace=True)
            f4_3 = h
            h = F.max_pool2d(h, 2, 2)

            h = F.relu(self.conv5_1(h), inplace=True)
            h = F.relu(self.conv5_2(h), inplace=True)
            h = F.relu(self.conv5_3(h), inplace=True)
            f5_3 = h
            h = F.max_pool2d(h, 2, 2)

            h = F.relu(self.fc6(h), inplace=True)
            h = F.relu(self.fc7(h), inplace=True)
            ffc7 = h

            h = F.relu(self.conv6_1(h), inplace=True)
            h = F.relu(self.conv6_2(h), inplace=True)
            f6_2 = h

            h = F.relu(self.conv7_1(h), inplace=True)
            h = F.relu(self.conv7_2(h), inplace=True)
            f7_2 = h

            # Normalise shallow-feature maps
            f3_3 = self.conv3_3_norm(f3_3)
            f4_3 = self.conv4_3_norm(f4_3)
            f5_3 = self.conv5_3_norm(f5_3)

            # Classification predictions
            cls3 = self.conv3_3_norm_mbox_conf(f3_3)
            cls4 = self.conv4_3_norm_mbox_conf(f4_3)
            cls5 = self.conv5_3_norm_mbox_conf(f5_3)
            cls7 = self.fc7_mbox_conf(ffc7)
            cls6 = self.conv6_2_mbox_conf(f6_2)
            cls8 = self.conv7_2_mbox_conf(f7_2)

            # Localisation predictions
            loc3 = self.conv3_3_norm_mbox_loc(f3_3)
            loc4 = self.conv4_3_norm_mbox_loc(f4_3)
            loc5 = self.conv5_3_norm_mbox_loc(f5_3)
            loc7 = self.fc7_mbox_loc(ffc7)
            loc6 = self.conv6_2_mbox_loc(f6_2)
            loc8 = self.conv7_2_mbox_loc(f7_2)

            # Collect and reshape cls/loc
            # The special handling for cls3 (4 channels → pick conf channels)
            # mirrors the original s3fd_test.py
            cls = [
                cls3.permute(0, 2, 3, 1).contiguous(),
                cls4.permute(0, 2, 3, 1).contiguous(),
                cls5.permute(0, 2, 3, 1).contiguous(),
                cls7.permute(0, 2, 3, 1).contiguous(),
                cls6.permute(0, 2, 3, 1).contiguous(),
                cls8.permute(0, 2, 3, 1).contiguous(),
            ]
            loc = [
                loc3.permute(0, 2, 3, 1).contiguous(),
                loc4.permute(0, 2, 3, 1).contiguous(),
                loc5.permute(0, 2, 3, 1).contiguous(),
                loc7.permute(0, 2, 3, 1).contiguous(),
                loc6.permute(0, 2, 3, 1).contiguous(),
                loc8.permute(0, 2, 3, 1).contiguous(),
            ]
            return loc, cls

    return S3FD()


# -------------------------------------------------------------------
# Anchor / NMS helpers (faithful to Wav2Lip face_detection/api.py)
# -------------------------------------------------------------------

_VARIANCE = [0.1, 0.2]
_STEPS = [4, 8, 16, 32, 64, 128]
# MIN_SIZES per feature map (index-aligned with _STEPS)
_MIN_SIZES = [[16, 32], [64, 128], [256, 512],
              [1024, 2048], [2048, 4096], [4096, 8192]]


def _detect(net, img_bgr, device, score_thresh: float = 0.5) -> List[BBox]:
    """Run S3FD on a single BGR image, return list of (x1,y1,x2,y2,score) boxes."""
    import numpy as np
    import torch
    import torch.nn.functional as F

    h_orig, w_orig = img_bgr.shape[:2]
    # Resize to the nearest multiple of 32 (keeps anchors aligned)
    h = ((h_orig + 31) // 32) * 32
    w = ((w_orig + 31) // 32) * 32
    img = np.zeros((h, w, 3), dtype=np.float32)
    img[:h_orig, :w_orig] = img_bgr.astype(np.float32)

    # BGR mean subtraction (ImageNet means, original uses these values)
    img -= np.array([104.0, 117.0, 123.0], dtype=np.float32)
    img = img.transpose(2, 0, 1)[None]  # [1, 3, H, W]
    tensor = torch.from_numpy(img).to(device)

    with torch.no_grad():
        locs, clss = net(tensor)

    # Decode predictions
    bboxes = _decode_preds(locs, clss, h, w, score_thresh)
    # Scale back to original image coords
    sx = w_orig / w
    sy = h_orig / h
    scaled = []
    for x1, y1, x2, y2, score in bboxes:
        scaled.append((x1 * sx, y1 * sy, x2 * sx, y2 * sy, score))
    return scaled


def _decode_preds(locs, clss, img_h, img_w,
                  score_thresh: float) -> List[BBox]:
    """Decode SSD-style predictions into bounding boxes.

    Faithful to the original face_detection/s3fd/s3fd_test.py logic.
    """
    import numpy as np
    import torch
    import torch.nn.functional as F

    # Build anchor boxes for each feature level
    feature_map_sizes = [
        (int(img_h / s), int(img_w / s)) for s in _STEPS
    ]

    anchors = []
    for idx, (fmh, fmw) in enumerate(feature_map_sizes):
        step = _STEPS[idx]
        for i in range(fmh):
            for j in range(fmw):
                cx = (j + 0.5) * step / img_w
                cy = (i + 0.5) * step / img_h
                for min_size in _MIN_SIZES[idx]:
                    s_kx = min_size / img_w
                    s_ky = min_size / img_h
                    anchors.append([cx, cy, s_kx, s_ky])

    anchors_t = torch.tensor(anchors, dtype=torch.float32)  # [N, 4]

    # Flatten all loc/cls predictions
    loc_all = torch.cat(
        [l.view(l.size(0), -1, 4) for l in locs], dim=1
    )[0]  # [N, 4]
    cls_all = torch.cat(
        [c.view(c.size(0), -1, 2) if c.size(-1) == 2
         else c.view(c.size(0), -1, 4)[..., 2:4]  # cls3 has 4 ch; take last 2
         for c in clss], dim=1
    )[0]  # [N, 2]

    scores = F.softmax(cls_all, dim=1)[:, 1].cpu().numpy()  # face class
    loc_np = loc_all.cpu().numpy()
    anc_np = anchors_t.numpy()

    # Decode box offsets (SSD style with variance)
    pred_cx = loc_np[:, 0] * _VARIANCE[0] * anc_np[:, 2] + anc_np[:, 0]
    pred_cy = loc_np[:, 1] * _VARIANCE[0] * anc_np[:, 3] + anc_np[:, 1]
    pred_w = np.exp(loc_np[:, 2] * _VARIANCE[1]) * anc_np[:, 2]
    pred_h = np.exp(loc_np[:, 3] * _VARIANCE[1]) * anc_np[:, 3]

    x1 = (pred_cx - pred_w / 2) * img_w
    y1 = (pred_cy - pred_h / 2) * img_h
    x2 = (pred_cx + pred_w / 2) * img_w
    y2 = (pred_cy + pred_h / 2) * img_h

    mask = scores >= score_thresh
    boxes = np.stack([x1[mask], y1[mask], x2[mask], y2[mask]], axis=1)
    scores_f = scores[mask]

    if len(boxes) == 0:
        return []

    keep = _nms(boxes, scores_f, iou_thresh=0.3)
    result = []
    for i in keep:
        result.append((
            float(boxes[i, 0]), float(boxes[i, 1]),
            float(boxes[i, 2]), float(boxes[i, 3]),
            float(scores_f[i]),
        ))
    return result


def _nms(boxes: "np.ndarray", scores: "np.ndarray",
         iou_thresh: float = 0.3) -> List[int]:
    """Pure-numpy NMS."""
    import numpy as np

    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter)
        inds = np.where(iou <= iou_thresh)[0]
        order = order[inds + 1]
    return keep


# -------------------------------------------------------------------
# Public API
# -------------------------------------------------------------------

def load_s3fd(weights_path: str, device: str):
    """Load the S3FD model from *weights_path* onto *device*.

    Returns the network in eval mode.
    """
    import torch

    net = _build_s3fd()
    state = torch.load(weights_path, map_location=device)
    net.load_state_dict(state)
    net.eval()
    net.to(device)
    return net


def detect_faces(s3fd_net, frame_bgr, device: str,
                 score_thresh: float = 0.5) -> List[BBox]:
    """Run face detection on a single BGR uint8 frame.

    Returns list of (x1, y1, x2, y2, score) sorted by descending score.
    """
    bboxes = _detect(s3fd_net, frame_bgr, device, score_thresh)
    bboxes.sort(key=lambda b: -b[4])
    return bboxes

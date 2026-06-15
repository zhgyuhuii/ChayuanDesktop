# VG 叠加元素 D 期(马赛克/模糊区) 实现计划

> REQUIRED SUB-SKILL: executing-plans. Steps `- [ ]`.

**Goal:** 叠加「马赛克/模糊区」:选区域+时间段,成片对该区域做模糊(后端 ffmpeg crop→boxblur→overlay),预览用 backdrop-filter 近似。

**Architecture:** mosaic 不走 _render_overlays(它处理的是叠加绘制);generate_video 出片后追加 _apply_mosaics(ffmpeg filter_complex:每区域 crop+boxblur+overlay+enable 时间窗,多个链式)。前端预览 backdrop-blur div。

---

### Task D1:后端 mosaic 后处理

**Files:** Modify `steps/compose.py`(_apply_mosaics + generate_video 末尾调用)

- [ ] **Step 1: _apply_mosaics(放 generate_video 前)**
```python
def _apply_mosaics(output_file, overlays, W, H, fps=30):
    """对 mosaic 叠加元素:ffmpeg 对各区域 boxblur 并按时间段 overlay 回原片(原地替换)。失败保留原片。"""
    mos = [o for o in (overlays or []) if getattr(o, "type", "") == "mosaic"]
    if not mos:
        return output_file
    try:
        from .outro import _ffmpeg
        ff = _ffmpeg()
        parts = []
        n = len(mos)
        # split 出 base + 每个 mosaic 一路
        labels = "".join(f"[c{i}]" for i in range(n))
        parts.append(f"[0:v]split={n + 1}[base]{labels}")
        prev = "base"
        for i, o in enumerate(mos):
            x = max(0, int((getattr(o, "x", 0.1) or 0) * W))
            y = max(0, int((getattr(o, "y", 0.1) or 0) * H))
            w = max(2, int((getattr(o, "w", 0.3) or 0.3) * W))
            h = max(2, int((getattr(o, "h", 0.2) or 0.2) * H))
            w -= w % 2; h -= h % 2
            s = max(0.0, (getattr(o, "track_start_ms", 0) or 0) / 1000.0)
            e = s + max(0.2, (getattr(o, "duration_ms", 3000) or 3000) / 1000.0)
            parts.append(f"[c{i}]crop={w}:{h}:{x}:{y},boxblur=12:2[b{i}]")
            out = "v%d" % (i + 1) if i < n - 1 else "vout"
            parts.append(f"[{prev}][b{i}]overlay={x}:{y}:enable='between(t,{s:.3f},{e:.3f})'[{out}]")
            prev = out
        fc = ";".join(parts)
        tmp = output_file + ".mosaic.mp4"
        cmd = [ff, "-y", "-i", output_file, "-filter_complex", fc, "-map", "[vout]",
               "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", tmp]
        r = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if r.returncode != 0 or not os.path.isfile(tmp):
            logger.warning("[mosaic] ffmpeg 失败,保留原片: %s", (r.stderr or "")[-400:])
            if os.path.isfile(tmp):
                try: os.remove(tmp)
                except OSError: pass
            return output_file
        os.replace(tmp, output_file)
        return output_file
    except Exception as exc:  # noqa: BLE001
        logger.warning("[mosaic] 异常,保留原片: %s", exc)
        return output_file
```
（`subprocess`/`os`/`logger` 已在 compose 顶部。）
- [ ] **Step 2: generate_video 末尾调用** —— 在 `generate_video` 写出 output_file(`write_videofile` 之后、`return output_file` 之前)加:
```python
    try:
        _apply_mosaics(output_file, overlays, video_width, video_height)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[mosaic] 后处理跳过: %s", exc)
```
- [ ] **Step 3: ast 自检 + Commit**。

### Task D2:前端 mosaic

**Files:** Modify `timeline/overlayEdit.ts`(mosaic 默认)、`timeline/OverlayToolbar.tsx`(启用)、`timeline/LivePreviewCanvas.tsx`(backdrop-blur 渲染)

- [ ] **Step 1: addOverlay mosaic 默认** —— `type==='mosaic'` → `{ w: 0.3, h: 0.2, stroke_width: 0 }`。
- [ ] **Step 2: OverlayToolbar** —— 'mosaic' 项 enabled:true,label「马赛克/模糊」。
- [ ] **Step 3: 预览渲染** —— LivePreviewCanvas 叠加元素加 `{ov.type === 'mosaic' && <div className="pointer-events-none h-full w-full" style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', background: 'rgba(255,255,255,0.04)' }} />}`(真实模糊其下视频层)。
- [ ] **Step 4: app tsc + 手动(重建+重启 sidecar)** —— 点马赛克→预览出模糊框可拖可缩可时间段;成片该区域时间段内模糊。Commit。

## 自审
- mosaic 不进 _render_overlays(else 分支已 continue);D1 单独 ffmpeg 后处理;D2 预览 backdrop-blur。
- 时间段 enable=between;多 mosaic split 链式。失败保留原片。
- ⚠ 后端 pytest 本机跑不了;真机成片待重建。CSS backdrop-blur 与 ffmpeg boxblur 视觉近似不等同(预览近似)。

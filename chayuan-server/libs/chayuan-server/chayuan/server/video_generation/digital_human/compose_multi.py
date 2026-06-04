"""多形象合成:同框(coframe)与分段(sequential)。

各形象先由 jobs 各自生成单人说话片段(已自带音频,引擎 mux),这里只做视频合成。
直接走 moviepy(与 compose.render_with_product_matte 同模式,自包含),失败抛异常
由 caller 兜底回退单形象。

- sequential:concatenate_videoclips 顺序拼接,音频随之顺序拼接(各形象轮流出场)。
- coframe:CompositeVideoClip 把各片段按 layout 摆同一画面、同时播放,moviepy 自动
  把各片段音轨叠加(注意:各形象台词会同时出声;若要轮流需 idle 帧,本期不做)。
"""
from __future__ import annotations
import logging
from typing import List, Tuple

logger = logging.getLogger("chayuan.dh.compose_multi")


def _mk_logger(on_progress):
    """把 moviepy write_videofile 的写帧进度(proglog)转成 on_progress(frac 0-1) 回调。
    长视频合成时让上层能实时上报进度(否则 90→100 间一片空白看着卡死)。"""
    if on_progress is None:
        return None
    try:
        from proglog import ProgressBarLogger

        class _L(ProgressBarLogger):
            def bars_callback(self, bar, attr, value, old_value=None):
                try:
                    if attr != "index":
                        return
                    total = (self.bars.get(bar) or {}).get("total") or 0
                    if total:
                        on_progress(min(1.0, float(value) / float(total)))
                except Exception:  # noqa: BLE001
                    pass
        return _L()
    except Exception:  # noqa: BLE001
        return None


def _sort_by_z(items, zs):
    """按图层 z 升序重排(列表越靠后越上层 → z 大的在上);zs 为 None / 某元素 None 时回退数组序。"""
    if not zs:
        return items
    order = sorted(range(len(items)),
                   key=lambda i: (zs[i] if i < len(zs) and zs[i] is not None else i))
    return [items[i] for i in order]


def _with_opacity(clip, op):
    """给 moviepy clip 应用不透明度(0-1);op 为 None/1 或不支持时原样返回。"""
    if op is None:
        return clip
    try:
        o = max(0.0, min(1.0, float(op)))
        if o >= 0.999 or not hasattr(clip, "with_opacity"):
            return clip
        return clip.with_opacity(o)
    except Exception:  # noqa: BLE001
        return clip


def _coframe_positions(layout: str, n: int, width: int, height: int) -> List[Tuple[int, int, int]]:
    """返回每个片段的 (x_px, y_px, target_width_px)。layout:
      side       并排等分(默认,最稳):横向均分 n 份,各占 width/n。
      pip        画中画:第 0 个全屏底,其余缩小堆右下。
      main_minor 主+角:第 0 个占左 ~0.62 宽,其余小图堆右侧。
    """
    n = max(1, n)
    if layout == "pip":
        out = [(0, 0, width)]
        small = max(1, int(width * 0.26))
        for i in range(1, n):
            out.append((width - small - 8, height - (small + 8) * i, small))
        return out
    if layout == "main_minor":
        main_w = int(width * 0.62)
        out = [(0, int((height - main_w * height // max(1, width)) / 2), main_w)]
        small = max(1, int(width * 0.34))
        gap = max(1, (height - small * (n - 1)) // max(1, n))
        for i in range(1, n):
            out.append((width - small - 8, gap + (small + gap) * (i - 1), small))
        return out
    # side(默认):横向均分
    col = max(1, width // n)
    return [(i * col, 0, col) for i in range(n)]


def _resolve_positions(positions, layout, n, width, height):
    """每角色位置 -> 像素 (x_px, y_px, target_w_px)。
    positions: 归一 (x,y,scale) 列表(0-1);非空且数量够 -> 自由位置,否则回退 _coframe_positions(layout)。"""
    if positions and len(positions) >= n:
        out = []
        for x, y, scale in positions[:n]:
            tw = max(1, int(float(scale) * width))
            out.append((int(float(x) * width), int(float(y) * height), tw))
        return out
    return _coframe_positions(layout, n, width, height)


def render_sequential(clip_paths: List[str], *, out_path: str, width: int, height: int,
                      on_progress=None) -> str:
    """各片段顺序拼接(各形象轮流)。片段自带音频。失败抛异常。"""
    from moviepy import VideoFileClip, concatenate_videoclips
    if not clip_paths:
        raise RuntimeError("没有可拼接的片段")
    clips = []
    try:
        for p in clip_paths:
            clips.append(VideoFileClip(p).resized(new_size=(width, height)))
        final = concatenate_videoclips(clips, method="compose")
        final.write_videofile(out_path, codec="libx264", audio_codec="aac",
                              fps=25, threads=2, logger=_mk_logger(on_progress))
        try:
            final.close()
        except Exception:  # noqa: BLE001
            pass
        return out_path
    finally:
        for c in clips:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass


def render_coframe(clip_paths: List[str], *, layout: str = "side", out_path: str,
                   width: int, height: int, positions=None, zs=None, opacities=None) -> str:
    """各片段按 layout 摆同一画面、同时播放(音轨叠加)。zs=各角色图层 z(大=在上),
    opacities=各角色不透明度(0-1,None=不透明)。None 元素回退默认。失败抛异常。"""
    from moviepy import VideoFileClip, CompositeVideoClip
    if not clip_paths:
        raise RuntimeError("没有可合成的片段")
    raw = []
    placed = []
    try:
        for p in clip_paths:
            raw.append(VideoFileClip(p))
        pos = _resolve_positions(positions, layout, len(raw), width, height)
        dur = max((c.duration for c in raw), default=0.1)
        for i, (c, (x, y, tw)) in enumerate(zip(raw, pos)):
            op = opacities[i] if opacities and i < len(opacities) else None
            placed.append(_with_opacity(c.resized(width=tw).with_position((x, y)), op))
        placed = _sort_by_z(placed, zs)  # 列表越靠后越上层 → 按 z 升序叠放
        comp = CompositeVideoClip(placed, size=(width, height)).with_duration(dur)
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac",
                            fps=25, threads=2, logger=None)
        try:
            comp.close()
        except Exception:  # noqa: BLE001
            pass
        return out_path
    finally:
        for c in raw:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass


def _turntaking_segments(unit_roles, durations, role_index):
    """某角色的全长轨分段:每句 (is_speak, duration_ms) -- 属于该角色=说,否则=待机。"""
    out = []
    for r, d in zip(unit_roles, durations):
        out.append((r == role_index, int(d)))
    return out


def _probe_ms(path):
    try:
        from moviepy import VideoFileClip
        c = VideoFileClip(path)
        try:
            return int(c.duration * 1000)
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        return 0


def render_coframe_turntaking(unit_clips, unit_roles, positions, avatars, *,
                              out_path, width, height, zs=None, opacities=None,
                              on_progress=None, products=None):
    """同框按句轮流:每角色全长轨(说话句=该句片段,他句=静态待机帧)+ 商品图层,
    全部按各自 z/位置/大小/透明度统一合成。只说话句带音频->叠加即顺序音轨。失败抛异常(caller 兜底)。"""
    import os as _os
    from moviepy import VideoFileClip, ImageClip, CompositeVideoClip, concatenate_videoclips, vfx
    n_roles = len(positions)
    durs = [max(1, _probe_ms(c)) for c in unit_clips]
    total_s = max(0.1, sum(durs) / 1000.0)   # 同框总时长(各角色全长轨 = 所有段之和)
    pos_px = _resolve_positions(positions, "side", n_roles, width, height)
    opened = []
    entries = []  # (z, fi, clip);角色 + 商品统一按 z 叠
    try:
        speak_clips = [VideoFileClip(c) for c in unit_clips]
        opened.extend(speak_clips)
        for ri in range(n_roles):
            x, y, tw = pos_px[ri]
            segs = []
            for j, (r, d) in enumerate(zip(unit_roles, durs)):
                if r == ri:
                    segs.append(speak_clips[j].resized(width=tw))
                else:
                    src = None
                    for jj, rr in enumerate(unit_roles):
                        if rr == ri:
                            src = speak_clips[jj]
                            break
                    if src is not None:
                        idle = ImageClip(src.get_frame(0))
                    else:
                        idle = ImageClip(avatars[ri])
                    idle = idle.resized(width=tw).with_duration(d / 1000.0)
                    segs.append(idle)
            track = concatenate_videoclips(segs, method="compose").with_position((x, y))
            track = _with_opacity(track, opacities[ri] if opacities and ri < len(opacities) else None)
            _rz = zs[ri] if (zs and ri < len(zs) and zs[ri] is not None) else ri
            entries.append((_rz, ri, track))
            opened.append(track)
        # 商品图层(视频循环到总时长、图片常显),与角色按 z 统一叠放。
        for k, p in enumerate(products or []):
            path = p.get("path")
            if not path:
                continue
            if _os.path.splitext(path)[1].lower() in (".mp4", ".mov", ".webm", ".mkv", ".avi"):
                pc = VideoFileClip(path, audio=False)
                try:
                    pc = pc.with_effects([vfx.Loop(duration=total_s)])
                except Exception:  # noqa: BLE001
                    try:
                        pc = pc.with_duration(min(pc.duration, total_s))
                    except Exception:  # noqa: BLE001
                        pass
            else:
                pc = ImageClip(path).with_duration(total_s)
            pw = max(1, int(width * float(p.get("scale") or 0.32)))
            pc = pc.resized(width=pw).with_position(
                (int(float(p.get("x") or 0.66) * width), int(float(p.get("y") or 0.60) * height)))
            pc = _with_opacity(pc, p.get("opacity"))
            _pz = p.get("z") if p.get("z") is not None else (n_roles + k)
            entries.append((_pz, n_roles + k, pc))
            opened.append(pc)
        entries.sort(key=lambda e: (e[0], e[1]))  # z 升序 → 列表越靠后越上层
        comp = CompositeVideoClip([c for _, _, c in entries], size=(width, height))
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac", fps=25, threads=2,
                             logger=_mk_logger(on_progress))
        opened.append(comp)
        return out_path
    finally:
        for c in opened:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass

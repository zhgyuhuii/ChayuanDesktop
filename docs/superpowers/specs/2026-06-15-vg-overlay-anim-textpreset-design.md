# VG 叠加增强 B':入场/出场动画 + 文字预设 — 设计文档

- 日期:2026-06-15;范围:overlay 元素(A-D 已完)增强。
- 决策:① 所有叠加元素加 入场/出场 **淡入淡出** 动画(none/fade + 时长);② 文字叠加加 **样式预设**(颜色/描边/底色组合)。滑入/缩放等动画留后续。

## ① 数据模型
- 后端 `VgOverlay` 加 `anim_in: str="none"`(none/fade)、`anim_out: str="none"`、`anim_dur: float=0.5`。
- 前端 `VgOverlay` 加 `anim_in?/anim_out?: 'none'|'fade'; anim_dur?: number`。
- `overlayEdit.patchOverlay` 已是 Partial,无需改 clamp(anim_dur clamp 0.1–3 可加)。

## ② 后端(compose._render_overlays)
- 每个 overlay clip(text/shape image/不含 mosaic)在 with_start/end 后,按 anim_in/out 加:
  `eff=[]; if anim_in=='fade': eff.append(vfx.CrossFadeIn(d)); if anim_out=='fade': eff.append(vfx.CrossFadeOut(d)); if eff: clip=clip.with_effects(eff)`(d=anim_dur,clamp≤时长一半)。CrossFade=alpha 淡入淡出(叠加层正确)。失败跳过。
- mosaic(ffmpeg 后处理)本期不做动画(注明)。

## ③ 前端
- 预览 LivePreviewCanvas:叠加元素按 playhead 在 [start,start+dur) 内的相对位置,入场/出场窗口内 opacity 渐变(类似 clip transitionStyle):elapsed<anim_dur→opacity=elapsed/dur;剩余<anim_dur→opacity=剩余/dur;叠加到现有 opacity。
- 样式条(预览头部 selOverlay):加「动画」入场/出场两个 select(无/淡)+ 时长;文字加「预设」select(默认/标题白/警示红/字幕黑底…各填 text_color/stroke/bg/font_size)。
- 文字预设(纯前端填字段):标题白(大字/白/黑描边)、警示(红/粗描边)、字幕条(白/黑底)、霓虹(亮色/同色描边)。

## ④ 文件
- 后端 `schemas.py`(VgOverlay 3 字段)、`steps/compose.py`(_render_overlays 加 CrossFade)。
- 前端 `@chayuan/api`(VgOverlay 3 字段)、`LivePreviewCanvas.tsx`(opacity 动画)、`VgTimelineEditorPage.tsx`(样式条动画 + 文字预设)。

## ⑤ 验证
- 后端 ast;真渲染构建机(CrossFade 视觉)。前端 tsc;预览淡入淡出可见。
- ⚠ 后端 pytest 跑不了;CrossFade 类名若该版本不同(FadeIn/CrossFadeIn)真机校;mosaic 无动画。

# VG 编辑器:工具栏精致化 + 几何变换(第 2 期)— 设计文档

- 日期:2026-06-15
- 范围:`chayuan-client` 视频生成时间轴编辑器 + `chayuan-server` PIP 合成
- 前置:第 1 期(片段属性面板 + 透明度/音量/位置缩放,见 `2026-06-15-vg-timeline-clip-properties-design.md`)已发
- 两个独立子项,可分阶段实现:**A 工具栏精致化(纯前端、零后端)**;**B 几何变换(前后端穿透)**

---

## 子项 A:TimelineToolbar 精致化(图标优先)

### 背景
`timeline/TimelineToolbar.tsx` 的 6 个组件目前是重边框按钮(`h-8 + border-strong + px-3`),占地方、不够精致。项目已有「精致紧凑」工具栏范式(`VgComposerToolbar`:小 chip + 品牌色图标)。本子项把这 6 个改成**图标优先**形态,与之对齐。

### 行为与范围(用户已选「图标优先 + 悬浮名」方向)
6 个组件分两类语义:
- **动作类**(点击开弹窗,无选中态):生成脚本、编辑脚本、编辑字幕
- **设置开关类**(单选,在工具栏上方内联展开设置面板,有选中态):语音、字幕、背景音乐

改为:
- 全部去掉文字标签与重边框,改 **icon-only** 圆形/圆角 ghost 按钮(`h-7 w-7`,hover 浅底 `--cy-surface-2`),中文名走 `title` + `aria-label`(可发现性靠 tooltip,用户已知悉并接受)。
- 动作类:`生成脚本` 用 `Wand2`(避开右侧「提交合成」的 `Sparkles` 撞图标)、`编辑脚本` `FileText`、`编辑字幕` `Captions`;点击触发既有 `onScriptGen/onScriptEdit/onSubtitleEdit`,无选中态。
- 开关类:`语音` `Volume2`、`字幕` `Type`、`背景音乐` `Music`;选中态 = `bg-[var(--cy-brand-50)] + 品牌色图标`,再点收起;沿用既有 `settingsPanel` 单值单选语义。
- 两组之间保留竖向分隔 `·`(`h-5 w-px bg-border-subtle`)。
- 「时间轴」标题 + 展开/折叠 toggle 保持(折叠 toggle 可一并改 icon-only 风格保持一致)。
- **「提交合成」右侧渐变主 CTA 保留文字不动**(主操作,不属于「别用按钮」范围)。

### 改动清单(零后端、零逻辑)
- `timeline/TimelineToolbar.tsx` — 仅样式 + 图标 + props 不变。

### 验证
- 6 个图标可点、tooltip 出中文名;开关类单选 + 选中态 + 再点收起;动作类正常开弹窗;提交合成不变。
- typecheck:`packages/app` tsc 通过。

---

## 子项 B:几何变换(旋转 + 翻转 + 裁剪,仅 PIP 层)

### 范围与边界
- 仅作用于**画中画 / 附加视频层**(第 2+ 条视频轨)的片段,与现有透明度/位置/缩放边界一致。主视频轨是 concat 拼接,无逐片段几何语义,**属性面板对主轨片段不显示几何控件**。
- 本期含:旋转(角度)、水平/垂直翻转(镜像)、裁剪 crop(预览里拖拽裁剪框)。
- 不含关键帧/变速/调色(P3–P5)。

### 数据模型(穿透链路)
**后端** `chayuan/server/video_generation/schemas.py` `TimelineClip` 新增:
```python
rotation: float = 0.0          # 顺时针角度,-180..180
flip_h: bool = False           # 水平镜像
flip_v: bool = False           # 垂直镜像
crop: CropRect | None = None   # 归一保留区,缺省 None = 全幅
```
新增 `CropRect(BaseModel)`:`x: float=0.0; y: float=0.0; w: float=1.0; h: float=1.0`(均归一 0–1,x/y=保留区左上角,w/h=保留区尺寸;校验 0<=x,y<1、0.05<=w,h<=1、x+w<=1、y+h<=1)。

**前端** `packages/api/src/videoGeneration.ts` `VgTimelineClip` 同步加可选字段:
```ts
rotation?: number;
flip_h?: boolean;
flip_v?: boolean;
crop?: { x: number; y: number; w: number; h: number };
```

**前端** `timeline/timelineEdit.ts` `ClipPatch` 扩这 4 项;`patchClip` 加 clamp:
- rotation → clamp 到 [-180, 180]
- flip_h/flip_v → 布尔原样
- crop → 各分量 clamp 到 [0,1],w/h 下限 0.05,且保证 x+w<=1、y+h<=1(越界则收缩 w/h)

### 后端合成(`steps/compose.py`)
1. `_build_pip_layers` 的 layer dict 增带 `rotation / flip_h / flip_v / crop` 四个字段(从 clip `getattr` 读,缺省同 schema 默认)。
2. 正式合成路径(约 588–603 行,现有 `resized` + `with_position` + `with_opacity` 处)与**低清代理预览路径**(约 705+ 行)两处**都**按固定顺序对每个 PIP clip 应用 MoviePy(moviepy 2.x API):
   ```
   crop   →  clip.cropped(x1=cx*W, y1=cy*H, x2=(cx+cw)*W, y2=(cy+ch)*H)    # 仅当 crop 非 None
   flip   →  clip.with_effects([vfx.MirrorX()])  / vfx.MirrorY()            # 按 flip_h/flip_v
   rotate →  clip.rotated(angle)                                            # 仅当 rotation != 0
   resize →  (现有)按 scale 缩放到 video_width*scale
   pos    →  (现有)with_position(x,y)
   opacity→  (现有)with_opacity
   ```
   顺序固定为 crop→flip→rotate→resize→pos→opacity,前端预览须按同序模拟。W/H 取该 clip resize 前的源分辨率。
3. 抽一个 `_apply_pip_geometry(clip, layer) -> clip` 小函数收敛上述变换,两条路径共用,避免两套逻辑。

### 前端 UI
**`timeline/ClipPropertyPopover.tsx`**(仅 `isPip` 片段渲染,与透明度同款门控)新增:
- 旋转:角度滑条(-180..180,step 1)+ 数值框,写 `patchClip({ rotation })`。
- 翻转:水平 / 垂直两个切换图标按钮(`FlipHorizontal2` / `FlipVertical2`),写 `patchClip({ flip_h / flip_v })`。
- 裁剪:一个「裁剪」切换按钮(`Crop` 图标),点击进入裁剪模式。

**裁剪框(预览拖拽)**:
- `VgTimelineEditorPage` 加 `cropEditingClipId: string | null` 状态,由属性面板「裁剪」按钮 set,Esc/再点取消。
- `timeline/LivePreviewCanvas.tsx`:当某 PIP 片段处于 `cropEditingClipId` 时,该图层**临时显示完整源(暂不套 crop 的 clip-path、隐藏 move/scale 手柄)**,在完整源上叠一个**可拖移(移动保留区)+ 四角缩放(改保留区尺寸)的裁剪矩形**,复用现有 corner-handle 拖拽基建(`drag()` + corner 列表),实时写 `crop:{x,y,w,h}`(归一到完整源/图层显示框,= 后端 cropped 的归一基准)。退出裁剪模式后按 `crop` 套 clip-path 显示保留区。
- 图层渲染 style 叠加:
  - `transform: rotate(${rotation}deg) scaleX(${flip_h?-1:1}) scaleY(${flip_v?-1:1})`
  - crop 用 `clip-path: inset(${y*100}% ${(1-(x+w))*100}% ${(1-(y+h))*100}% ${x*100}%)` 反映保留区
  - 现有 `opacity` 与 x/y/scale 定位保留

### 已知差异(spec 注明,工具级可接受)
- CSS `transform: rotate()` 不扩布局框、MoviePy `.rotated()` 默认 expand 会扩画布(透明角)。预览与成片在旋转后的角点/边界可能轻微不一致,作几何工具级可接受。
- 旋转 + 裁剪同时使用时,预览顺序须严格 crop(clip-path)→ 再 transform rotate,与后端 crop→rotate 同序,避免视觉错位。

### 改动清单(子项 B)
- 后端 `schemas.py` — `TimelineClip` 加 4 字段 + `CropRect`
- 后端 `steps/compose.py` — `_build_pip_layers` 带字段 + `_apply_pip_geometry` + 两路径接入
- 前端 `packages/api/src/videoGeneration.ts` — `VgTimelineClip` 加 4 可选字段
- 前端 `timeline/timelineEdit.ts` — `ClipPatch` + `patchClip` clamp
- 前端 `timeline/ClipPropertyPopover.tsx` — 旋转/翻转/裁剪控件
- 前端 `timeline/LivePreviewCanvas.tsx` — transform + clip-path + 裁剪框
- 前端 `timeline/VgTimelineEditorPage.tsx` — `cropEditingClipId` 状态贯通

### 验证
- 后端:`PYTHONPATH=... python -m py_compile` 改动文件;补/跑 schema 测试(rotation/flip/crop 默认值 + CropRect 校验)。本机可跑 py312 pytest。
- 前端:`packages/api` + `packages/app` tsc 通过。
- 手动(用户重建 desktop + 重启 sidecar 后):PIP 片段旋转/翻转预览实时变;裁剪框可拖可缩、clip-path 实时反映;提交合成后成片几何与预览一致(允许旋转角点轻微差异);主轨片段不显几何控件。

## 风险
- 多层传播漏层(参照 memory:加字段穿 6+ 层),清单已列全 6 处。
- crop 框拖拽与现有 move/scale 拖拽手柄的交互冲突 → 用 `cropEditingClipId` 模式互斥(裁剪模式下隐藏 move/scale 手柄)。
- 预览 clip-path 与后端 cropped 的归一基准须一致(都基于完整源;裁剪编辑时显示完整源,故裁剪框坐标 = 源归一坐标)。

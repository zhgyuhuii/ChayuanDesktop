# 时间轴编辑器 P5c-1 设计 —— 自包含生成 + 字幕整体编辑 + 素材库体验 + 全轨删除

> 状态:已用户审过设计(2026-05-29),待写 implementation plan。
> 前置:P1-P5b 已落地(三区 NLE、手拖素材成片、图像渲染、编辑字幕 cue/替换 clip、
> 插入音频混音、右键菜单上传/库添加/试听/删除、合成时长含旁白/插入音频取最右)。

## 背景与目标

把时间轴编辑器做成**自包含**(不必从对话进也能生成)并补齐编辑体验。本阶段是
"全真多轨 NLE" 终极目标的 P5c 第一子阶段。**P5c-2**(随后单独 spec)做:添加视频/音频
轨道(动态轨道列表重构)+ 多视频层画中画 PIP(clip 加 x/y/scale/z、预览拖拽缩放、
compose CompositeVideoClip 分层)。

P5c-1 交付 4 块:① 编辑页内「生成脚本」表单(自包含,ai 生成旁白+字幕填充);
② 字幕整体编辑框 + 重新生成音频;③ 素材库可拖调宽 + 卡片/列表视图切换;④ 右键删除
扩展到字幕 cue。

## 选定决策(brainstorming 结论)

| 维度 | 选择 |
|---|---|
| P5c 拆分 | 两阶段:P5c-1(编辑体验/自包含)先做;P5c-2(加轨 + PIP)后做 |
| 「添加轨道」归属 | 统一放 P5c-2(需动态轨道列表重构,与 PIP 多视频轨同源) |
| 生成脚本表单字段 | 主题 + 脚本模型 + 段落数 + 语言;语音/BGM/字幕样式沿用工具栏 params |
| 字幕编辑框 | 纯文本逐行(P5b 已选)+ 重新生成音频 |
| 右键删除语义 | 视频/插入音频 clip + 字幕 cue 可删;旁白/BGM 派生,不提供右键删 |

## 现状(已确认)

- `VgTimelineEditorPage`:草稿编排 `submitTask(params, { stop_at: 'subtitle' })`,自动生成
  effect 守卫 `if (!hasScript) return`(`hasScript = video_script 非空`);`startDraftGen` 已抽出
  可复用。draft ready → 拉 `audio-peaks` + srt 回填 `cues`/`peaks`(本地 state)。
- `TimelineTracks`:固定 5 轨(视频/旁白/音频/音乐/字幕);`onLaneContextMenu(e, track:'video'|'audio', clipId?)`
  仅挂在视频/音频 lane;字幕轨头 `onEditSubtitle` prop 已埋(编辑器未传)。
- `SubtitleCueTrack`:可编辑(把手拖时间 + 双击改文字,`onCuesChange`)。
- `subtitleEdit.ts`:`editCueTime`/`editCueText`/`cuesToSrt`/`rebuildCuesFromLines`(均已实现+测)。
- `MediaPoolPanel`:可折叠,内嵌 `<MaterialsStep>`;MaterialsStep 卡片已 `draggable`(P5a/b)。
- 后端:`stop_at='subtitle'` 走 script(ai 用 LLM,manual 用 video_script)→ terms → tts → subtitle。
  `script` 步对 `script_source=='ai'` 用 `video_subject` + LLM 生成;无改动。

## ① 编辑页「生成脚本」表单(自包含)

文件:`VgTimelineEditorPage.tsx`(改:加按钮 + 表单 dialog + 触发条件)、新
`timeline/ScriptGenDialog.tsx`(表单组件)。

- 编辑页时间轴标题栏加「生成脚本」按钮 → 打开 `ScriptGenDialog`。
- `ScriptGenDialog` 字段:
  - **主题** `video_subject`(textarea)
  - **脚本模型** model(下拉,按厂商 optgroup 分组;复用 BatchModePage/VgChatPage 的模型列表来源 —— `videoGeneration` 或 composer 已有的模型获取方式,沿用现有分组下拉实现)
  - **段落数** `paragraph_number`(1-10)
  - **语言** `video_language`(下拉:auto/zh/en/…,复用现有选项)
  - 提交按钮「生成」
- 提交:`patchParams({ video_subject, model, paragraph_number, video_language, script_source: 'ai' })`
  → `resetDraft()` → 关闭 dialog。自动生成 effect 触发(见下)。
- **自动生成触发条件放宽**(VgTimelineEditorPage):
  ```ts
  const canGen = (params.video_script || '').trim().length > 0
    || (params.script_source === 'ai' && (params.video_subject || '').trim().length > 0);
  // effect / 手动按钮 / 空态判断都用 canGen 取代原 hasScript
  ```
  scriptHash 也需纳入 `video_subject`(ai 模式脚本由主题决定),否则改主题不触发重生:
  `scriptHashOf` 增加 `video_subject`(在 store)。
- 空态文案改:无 script 且无 subject 时显「点『生成脚本』开始,或从对话『去编辑合成』进入」。

## ② 字幕整体编辑框 + 重新生成音频

文件:新 `timeline/SubtitleBulkEditor.tsx`(dialog)、`VgTimelineEditorPage.tsx`(传 `onEditSubtitle` + 状态 + 重新生成音频)。

- 字幕轨头「编辑」按钮(`onEditSubtitle` 已埋)→ 打开 `SubtitleBulkEditor`。
- `SubtitleBulkEditor`:大 `<textarea>` 初值 `cues.map(c=>c.text).join('\n')`;
  - 「保存」→ `onSave(rebuildCuesFromLines(cues, value.split('\n'), contentMs))` → 编辑器 `setCues(...)`。
  - 「重新生成音频」→ `onRegenAudio(value)`:编辑器把整文设为脚本重跑旁白:
    ```ts
    const st = useVgComposer.getState();
    st.setScriptSlot('manual', text); st.setScriptSource('manual'); st.resetDraft();
    // 关闭 dialog;自动生成 effect 重跑 TTS+字幕
    ```
  - 关闭按钮。
- 编辑器把 `onEditSubtitle={() => setSubtitleEditorOpen(true)}` 传 TimelineTracks;渲染 dialog。

## ③ 素材库可调宽 + 卡片/列表视图

文件:`VgTimelineEditorPage.tsx`(上半区改成可拖分隔)、`MediaPoolPanel.tsx`(宽度受控 + 视图切换透传)、`steps/MaterialsStep.tsx`(卡片/列表两种渲染 + 视图 prop)。

- **可调宽**:上半区(MediaPool | 预览)之间加 4px 拖拽分隔条。MediaPool 宽 = state(默认 288px),
  pointer 拖改宽(夹 160-560px),存 `localStorage('cy.vg.mediapool.w')`。MediaPoolPanel 接受 `width` prop。
- **视图切换**:MediaPoolPanel 顶部加「卡片/列表」切换(state 存 localStorage)。透传 `view: 'card'|'list'` 给 MaterialsStep。
  - 卡片视图:缩略图为主,**默认不显名**,`group-hover` 才浮出名(覆盖层)。
  - 列表视图:每行 = 小缩略图 + 名 + 时长 + 格式(mime/扩展名),单列紧凑。
  - 两种视图卡片都 `draggable`(沿用 P5a/b 的 setDragData;含图像,draggable=false 已修在 img 上)。
- MaterialsStep 现有卡片网格保留为 `view==='card'`;新增 `view==='list'` 行式渲染。

## ④ 右键删除扩展到字幕 cue

文件:`SubtitleCueTrack.tsx`(cue 右键)、`TimelineTracks.tsx`(字幕轨 lane 透传)、
`VgTimelineEditorPage.tsx`(删 cue 处理)。

- `SubtitleCueTrack` cue 块加 `onContextMenu` → 回调 `onCueContextMenu(e, index)`。
- 编辑器:右键 cue → 复用 `TrackContextMenu`(track 视为 'subtitle' 仅显「删除此字幕」)→
  删除 = `setCues(cues.filter((_,i)=>i!==idx))`。
- 旁白/BGM 轨:不加右键删除(派生数据)。视频/插入音频 clip 删除沿用 P5b 右键 + 现有 🗑。
- `TrackContextMenu` 增加一个"仅删除"形态(track 为 'subtitle' 时只显删除项,无上传/库)。

> 范围说明:右键菜单的「上传/库添加」仍只在视频/音频轨(可放素材的轨);字幕轨右键只「删除该 cue」。

## ⑤ 错误处理

- 生成脚本表单:主题空 → 禁用「生成」。模型/段落/语言有默认值。
- 字幕重新生成音频:整文为空 → 提示不可生成。
- 素材库拖分隔条:夹宽度边界;视图/宽度读 localStorage 失败 → 用默认。

## ⑥ 测试

- 前端纯函数:`rebuildCuesFromLines`(已测);`scriptHashOf` 含 video_subject(补一条断言改主题→hash 变)。
- 其余为 UI(dialog/分隔条/视图/右键),走 typecheck + 现有 timeline vitest 不破 + web build。
- 后端:无改动(生成脚本走已有 ai + stop_at=subtitle 链路)。

## 文件清单(plan 阶段细化)

- `store/vgComposer.ts` — `scriptHashOf` 纳入 `video_subject`。
- `timeline/ScriptGenDialog.tsx`(新) — 生成脚本表单。
- `timeline/SubtitleBulkEditor.tsx`(新) — 字幕整体编辑框。
- `timeline/SubtitleCueTrack.tsx` — cue 右键回调。
- `timeline/TrackContextMenu.tsx` — 'subtitle' 仅删除形态。
- `timeline/TimelineTracks.tsx` — 字幕轨 cue 右键透传 + onEditSubtitle(已埋)。
- `timeline/MediaPoolPanel.tsx` — width prop + 视图切换。
- `steps/MaterialsStep.tsx` — card/list 双视图 + view prop。
- `VgTimelineEditorPage.tsx` — 生成脚本按钮+dialog、字幕编辑 dialog+regen、可拖分隔条、canGen 放宽、删 cue。

## 非目标(P5c-1 不做,留 P5c-2)

- 添加视频/音频轨道(动态轨道列表重构)。
- 多视频层画中画 PIP(x/y/scale/z + 预览拖拽缩放 + 分层渲染)。
- 字幕精确逐句时间表格编辑(纯文本逐行 + 轨道把手已够)。

# 时间轴编辑器优化(A 拆分 + B 性能 + C 工具栏/虚拟/栅格)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。逐 task 执行,**每 task 后 typecheck 守底**(`cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"` 必须空),独立提交。

**Goal:** 把 677 行旗舰 NLE 巨组件 `VgTimelineEditorPage.tsx` 优化:A=纯重构拆分(零行为变化)、B=修播放头 rAF 每帧全树重渲、C=工具栏分组+长时间轴虚拟滚动+三栏栅格收口。

**Architecture:** 抽组件(`TimelineToolbar`)+ 抽 hook(`useVgDraft`/`useTimelinePlayback`),逻辑搬家不改语义;播放头改 CSS transform/ref 推进 + `React.memo` 隔离 TimelineTracks;clip 多时虚拟化只渲可视区。

**Tech Stack:** React 19 / Tailwind `var(--cy-*)` / @tanstack/react-query / 既有 timeline 算子。承接 P5c。

**红线:** 不破 P5c 任何既有交互(拖素材/裁时长/PIP/多轨/字幕/提交);每步可独立回滚;typecheck 守底。

---

## 阶段 A:纯重构拆分(零行为变化)

### Task A1:抽 `<TimelineToolbar>` 组件
**Files:** 建 `timeline/TimelineToolbar.tsx`;改 `VgTimelineEditorPage.tsx`
工具栏按钮行(现 ~495-531:折叠/生成脚本/编辑脚本/编辑字幕 + 语音/字幕/背景音乐 chips + 提交合成)抽成受控组件。
- props:`timelineCollapsed, onToggleCollapse, onScriptGen, onScriptEdit, onSubtitleEdit, settingsPanel, onSettingsPanel, onSubmit, submitting, canSubmit`。
- 父用 `<TimelineToolbar timelineCollapsed={timelineCollapsed} onToggleCollapse={()=>setTimelineCollapsed(v=>!v)} ... canSubmit={draft.state==='ready'} onSubmit={()=>void onSubmit()} />`。
- 图标 import 迁到新文件。行为/className 逐字保留。
- [ ] 写组件 → 替换父 JSX → typecheck 空 → 提交 `refactor(vg): 抽 TimelineToolbar 组件`。

### Task A2:抽 `useTimelinePlayback` hook
**Files:** 建 `timeline/useTimelinePlayback.ts`;改父
搬:`playheadMs/setPlayheadMs, seekMs, seekNonce, playing/setPlaying, previewMode/setPreviewMode, playheadRef, rAF 播放 effect(~171-202), fit effect(~206-211), containerRef`。
- 入参:`{ timeline, contentMs, draft, params }`(rAF effect 读这些)。
- 返回:`{ playheadMs, setPlayheadMs, seekMs, setSeekMs, seekNonce, setSeekNonce, playing, setPlaying, previewMode, setPreviewMode, containerRef }`。
- ⚠ 逐字搬运 effect 体 + 依赖数组 + eslint-disable 注释,不改语义。
- [ ] 抽 → 父调用 hook 解构 → typecheck 空 → 提交 `refactor(vg): 抽 useTimelinePlayback`。

### Task A3:抽 `useVgDraft` hook
**Files:** 建 `timeline/useVgDraft.ts`;改父
搬:草稿生成编排 `runDraftGen/startDraftGen/submitScriptGen/onSaveScript/onSynthesizeScript`、自动生成 effect(~109-115)、轮询 query(~118-142)、peaks/cues effect(~145-162)、`peaks/setPeaks, cues/setCues`。
- 入参:`{ params, patchParams, draft, patchDraft, canGen, curHash }`。
- 返回:`{ peaks, cues, setCues, runDraftGen, startDraftGen, submitScriptGen, onSaveScript, onSynthesizeScript }`。
- ⚠ 最易出错——effect 依赖/闭包逐字保留;`useQuery` 整段搬。
- [ ] 抽 → 父调用 → typecheck 空 → 提交 `refactor(vg): 抽 useVgDraft`。

---

## 阶段 B:播放头性能(修每帧全树重渲)

### Task B1:`React.memo` 隔离 TimelineTracks + 播放头 ref 化
**Files:** 改 `timeline/TimelineTracks.tsx`,`VgTimelineEditorPage.tsx`(或 useTimelinePlayback)
问题:rAF 每帧 `setPlayheadMs` → 父重渲 → TimelineTracks(全 clip)重渲 60fps。
方案:
1. `TimelineTracks` 包 `React.memo`;确认其 props 引用稳定(handler 用 useCallback;timeline 只在编辑时变)。
2. 播放头竖线**不靠 props.playheadMs 重渲**:TimelineTracks 暴露一个 `playheadElRef`(或内部用 `useImperativeHandle`),父在 rAF tick 里直接 `el.style.transform = translateX(px)` 推竖线,**不 setState**。setPlayheadMs 仍保留给 TransportBar 时间显示(可降频:每 ~100ms 一次,或单独 state)。
- 折中实现(低风险):rAF tick 内不再每帧 `setPlayheadMs`;改为 (a) 直接移动播放头 DOM(ref)+ (b) 每 ~4 帧或 100ms 才 `setPlayheadMs` 一次给 TransportBar。PreviewPlayer 的 live 模式播放头同理用节流值。
- [ ] memo + ref 推播放头 + 节流 setState → typecheck 空 → **重建实测拖播流畅** → 提交 `perf(vg): 播放头 ref 推进 + memo TimelineTracks(消每帧全树重渲)`。

---

## 阶段 C:工具栏分组 + 虚拟滚动 + 三栏栅格

### Task C1:工具栏分组 + 溢出菜单
**Files:** 改 `timeline/TimelineToolbar.tsx`
窄屏按钮 wrap → 分两组(脚本/字幕 一组、设置 chips 一组),次要操作收进「⋯ 更多」溢出菜单(复用既有 dropdown/popover 模式)。提交合成始终右侧常驻。
- [ ] 分组 + 溢出 → typecheck 空 → 提交 `feat(vg): 工具栏分组 + 溢出菜单`。

### Task C2:长时间轴虚拟滚动
**Files:** 改 `timeline/TimelineTracks.tsx`
clip 极多(长视频多轨)时只渲可视区 ± 缓冲。按 `pxPerSec` + 滚动位置算可视时间窗,轨内 clip `track_start_ms` 落窗外的不渲(占位空 div 撑宽度)。⚠ 拖放/选中坐标仍按真实 px,不受影响。
- [ ] 虚拟化 → typecheck 空 → **实测多 clip 滚动 + 拖放正常** → 提交 `perf(vg): 时间轴 clip 虚拟滚动(只渲可视区)`。

### Task C3:三栏栅格收口
**Files:** 改 `VgTimelineEditorPage.tsx`
现手写嵌套 flex + pointer-drag 分隔条工作正常,但风格不统一。收口为清晰的「左素材池 | 右(上预览/下时间轴)」结构,保留可拖宽/拖高 + localStorage 记忆(不破现有行为,只整理层级 + 注释)。⚠ 最低优先,若收益不明显可只做注释化不动结构。
- [ ] 收口 → typecheck 空 → 提交 `refactor(vg): 三栏布局层级收口 + 注释`。

---

## 自检(Self-Review)
- **不回归**:每 task typecheck 守底;A 纯搬运零语义变化;B/C 后需用户重建实测拖播/拖放/多轨。
- **风险**:A3(useVgDraft 闭包/effect 依赖)、B1(播放头节流别让 PreviewPlayer live 跳)、C2(虚拟化坐标)最易出错——逐字保留 + 实测。
- **可回滚**:每 task 独立 commit。
- **[VERIFY 实测]**:B/C 的流畅度与多 clip 表现需用户重建 desktop 后实测(本机无 GUI)。

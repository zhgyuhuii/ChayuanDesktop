# 时间轴编辑器 P5c-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让时间轴编辑器自包含(页内「生成脚本」表单 → ai 生成旁白+字幕填充)并补齐编辑体验:字幕整体编辑框 + 重新生成音频、素材库可拖调宽 + 卡片/列表视图、右键删除扩展到字幕 cue。

**Architecture:** 纯前端(后端无改动,生成脚本复用已有 `stop_at=subtitle` 的 ai 链路)。生成脚本表单写 `params`(subject/model/段落/语言 + `script_source='ai'`)+ `resetDraft` → 现有自动生成 effect 触发(触发条件放宽为 ai+主题也算);`scriptHashOf` 纳入 `video_subject`。字幕编辑/素材库视图/分隔条均为受控组件 + 复用已有纯算子(`rebuildCuesFromLines`)。

**Tech Stack:** TS / React 19 / Zustand / TanStack Query / Tailwind v4;vitest(纯函数)。

**前置:** P1-P5b 已落地(三区 NLE、手拖素材、编辑 cue/替换 clip、插入音频混音、右键菜单、合成时长含旁白/插入音频)。

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 `main`,每 task `git push origin main`。

---

## File Structure

- `packages/app/src/features/video-generation/store/vgComposer.ts`(改)— `scriptHashOf` 纳入 `video_subject`。
- `packages/app/src/features/video-generation/store/vgComposer.test.ts`(新)— scriptHashOf 单测。
- `packages/app/src/features/video-generation/timeline/ScriptGenDialog.tsx`(新)— 生成脚本表单。
- `packages/app/src/features/video-generation/timeline/SubtitleBulkEditor.tsx`(新)— 字幕整体编辑框。
- `packages/app/src/features/video-generation/timeline/SubtitleCueTrack.tsx`(改)— cue 右键回调。
- `packages/app/src/features/video-generation/timeline/TrackContextMenu.tsx`(改)— `'subtitle'` 仅删除形态。
- `packages/app/src/features/video-generation/timeline/TimelineTracks.tsx`(改)— 字幕 cue 右键透传 + 传 onEditSubtitle。
- `packages/app/src/features/video-generation/timeline/MediaPoolPanel.tsx`(改)— `width` 受控 + 卡片/列表视图切换。
- `packages/app/src/features/video-generation/steps/MaterialsStep.tsx`(改)— `view: 'card'|'list'` 双视图(MineTab/OnlineTab)。
- `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`(改)— 生成脚本按钮+dialog、字幕编辑+regen、可拖分隔条、canGen 放宽、删 cue。

---

## Task 1: scriptHashOf 纳入 video_subject

**Files:**
- Modify: `packages/app/src/features/video-generation/store/vgComposer.ts`
- Test: `packages/app/src/features/video-generation/store/vgComposer.test.ts`

参考(已有):`scriptHashOf(p)` 现含 `video_script/voice_*/bgm_*/video_language/paragraph_number`。

- [ ] **Step 1: 写失败测试**

`vgComposer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { scriptHashOf } from './vgComposer';
import { VG_DEFAULT_PARAMS } from '@chayuan/api';

it('scriptHashOf changes when video_subject changes (ai 模式靠主题)', () => {
  const a = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '猫' });
  const b = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '狗' });
  expect(a).not.toBe(b);
});

it('scriptHashOf stable when irrelevant field changes (画幅)', () => {
  const a = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '猫', video_aspect: '9:16' });
  const b = scriptHashOf({ ...VG_DEFAULT_PARAMS, video_subject: '猫', video_aspect: '1:1' });
  expect(a).toBe(b);
});
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm exec vitest run packages/app/src/features/video-generation/store/vgComposer.test.ts`
Expected: 第一条 FAIL(当前 hash 不含 subject)。

- [ ] **Step 3: 改 scriptHashOf**

把 `scriptHashOf` 的数组加入 `p.video_subject`:
```typescript
export function scriptHashOf(p: VgVideoParams): string {
  return JSON.stringify([
    p.video_subject, p.video_script, p.voice_provider, p.voice_name, p.voice_rate, p.voice_volume,
    p.bgm_type, p.bgm_file, p.video_language, p.paragraph_number,
  ]);
}
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 2 passed。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/store/vgComposer.ts chayuan-client/packages/app/src/features/video-generation/store/vgComposer.test.ts
git commit -m "feat(client/vg): scriptHashOf 纳入 video_subject(ai 生成靠主题判失效)+ 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: ScriptGenDialog 生成脚本表单 + 编辑器接入(自包含)

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/ScriptGenDialog.tsx`
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

参考(已有):BatchModePage 模型下拉(`models.list()` → 按 `platform_display_name||platform_name` 分组 → 编码 `platform_name ? \`${platform_name}::${id}\` : id`);`useVgComposer` patchParams/resetDraft;编辑器 `startDraftGen`/`canGen`(本 task 改);`VG_LANGUAGE`?(无则用内联选项)。

- [ ] **Step 1: ScriptGenDialog.tsx**

```tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Sparkles } from 'lucide-react';
import { models, type RawModelItem } from '@chayuan/api';

const LANGS: Array<[string, string]> = [['', '自动'], ['zh-CN', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어']];

export const ScriptGenDialog: React.FC<{
  initial: { subject: string; model: string | null; paragraph: number; language: string };
  onSubmit: (v: { subject: string; model: string | null; paragraph: number; language: string }) => void;
  onClose: () => void;
}> = ({ initial, onSubmit, onClose }) => {
  const [subject, setSubject] = React.useState(initial.subject);
  const [model, setModel] = React.useState<string | null>(initial.model);
  const [paragraph, setParagraph] = React.useState(initial.paragraph || 1);
  const [language, setLanguage] = React.useState(initial.language || '');

  const modelsQ = useQuery({ queryKey: ['v1.models'], queryFn: () => models.list(), staleTime: 5 * 60 * 1000 });
  const llm: RawModelItem[] = (modelsQ.data ?? []).filter((m) => !m.model_type || m.model_type === 'llm');
  const groups = React.useMemo<Array<[string, RawModelItem[]]>>(() => {
    const map = new Map<string, RawModelItem[]>();
    for (const m of llm) { const k = m.platform_display_name || m.platform_name || '其它'; (map.get(k) ?? map.set(k, []).get(k)!).push(m); }
    return [...map.entries()];
  }, [llm]);

  const sel = 'h-8 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs';
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="w-[min(480px,92vw)] rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">生成脚本</h3>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]"><X className="h-4 w-4" /></button>
        </div>
        <label className="mb-1 block text-xs text-[var(--cy-text-tertiary)]">主题</label>
        <textarea value={subject} onChange={(e) => setSubject(e.target.value)} rows={3}
          placeholder="描述要生成的视频主题…"
          className="mb-3 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 text-xs" />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">脚本模型
            <select value={model ?? ''} onChange={(e) => setModel(e.target.value || null)} className={`${sel} min-w-[12em]`}>
              {llm.length === 0 && <option value="">{modelsQ.isLoading ? '加载中…' : '无可用模型'}</option>}
              {groups.map(([plat, ms]) => (
                <optgroup key={plat} label={plat}>
                  {ms.map((m) => { const enc = m.platform_name ? `${m.platform_name}::${m.id}` : m.id; return <option key={enc} value={enc}>{m.id}</option>; })}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">段落
            <select value={paragraph} onChange={(e) => setParagraph(Number(e.target.value))} className={`${sel} w-[4em]`}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">语言
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={`${sel} w-[7em]`}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <button type="button" disabled={!subject.trim()}
          onClick={() => onSubmit({ subject: subject.trim(), model, paragraph, language })}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
          <Sparkles className="h-3.5 w-3.5" /> 生成
        </button>
      </div>
    </div>
  );
};
```
> `models.list()` / `RawModelItem` 来自 `@chayuan/api`(BatchModePage 已用)。`map.get(k) ?? map.set(k, []).get(k)!` 是分组惯用法,与 BatchModePage 一致即可(若该写法 lint 不过,改成显式 if)。

- [ ] **Step 2: 编辑器放宽 canGen + 接 ScriptGenDialog**

`VgTimelineEditorPage.tsx`:
- import:`import { ScriptGenDialog } from './timeline/ScriptGenDialog';`
- 把 `const hasScript = (params.video_script || '').trim().length > 0;` 改为:
  ```ts
  const canGen = (params.video_script || '').trim().length > 0
    || (params.script_source === 'ai' && (params.video_subject || '').trim().length > 0);
  ```
  并把后续所有用 `hasScript` 处替换为 `canGen`(自动生成 effect 的 `if (!hasScript) return`、状态条 `{!hasScript && ...}`、`{hasScript && draft.state==='idle' ...}`)。
- 加状态 + 提交:
  ```tsx
  const [scriptGenOpen, setScriptGenOpen] = React.useState(false);
  const submitScriptGen = (v: { subject: string; model: string | null; paragraph: number; language: string }) => {
    patchParams({ video_subject: v.subject, model: v.model ?? undefined, paragraph_number: v.paragraph, video_language: v.language, script_source: 'ai', video_script: '' });
    useVgComposer.getState().resetDraft();
    setScriptGenOpen(false);
  };
  ```
  > 设 `video_script: ''` 让 ai 模式走 LLM 生成(不被旧手动脚本占用);`script_source='ai'` + subject 让 `canGen` 为真,effect 触发 `startDraftGen`。
- 时间轴标题栏(`<Film/> 时间轴` 那行)在「提交合成」前加按钮:
  ```tsx
  <button type="button" onClick={() => setScriptGenOpen(true)}
    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
    <Sparkles className="h-3.5 w-3.5" /> 生成脚本
  </button>
  ```
  (确保 lucide 已 import `Sparkles` —— 编辑器已用。)
- 页尾渲染:
  ```tsx
  {scriptGenOpen && (
    <ScriptGenDialog
      initial={{ subject: params.video_subject || '', model: params.model ?? null, paragraph: params.paragraph_number || 1, language: params.video_language || '' }}
      onSubmit={submitScriptGen} onClose={() => setScriptGenOpen(false)} />
  )}
  ```
- 空态文案改:`{!canGen && <... 点「生成脚本」开始,或从对话「去编辑合成」进入 ...>}`。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/ScriptGenDialog.tsx chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): 编辑页「生成脚本」表单(自包含 ai 生成旁白+字幕)+ canGen 放宽

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: SubtitleBulkEditor 字幕整体编辑 + 重新生成音频

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/SubtitleBulkEditor.tsx`
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

参考(已有):`rebuildCuesFromLines(cues, lines, totalMs)`、`SrtCue`(srtParse);编辑器 `cues`/`setCues`/`contentMs`;`TimelineTracks` 的 `onEditSubtitle` prop(已埋,编辑器未传);`useVgComposer` setScriptSlot/setScriptSource/resetDraft。

- [ ] **Step 1: SubtitleBulkEditor.tsx**

```tsx
import * as React from 'react';
import { X, Save, RefreshCw } from 'lucide-react';
import type { SrtCue } from './srtParse';

export const SubtitleBulkEditor: React.FC<{
  cues: SrtCue[];
  onSave: (lines: string[]) => void;
  onRegenAudio: (text: string) => void;
  onClose: () => void;
}> = ({ cues, onSave, onRegenAudio, onClose }) => {
  const [text, setText] = React.useState(cues.map((c) => c.text).join('\n'));
  const empty = text.trim().length === 0;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--cy-text-primary)]">整体编辑字幕(每行一句)</h3>
          <button type="button" onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]"><X className="h-4 w-4" /></button>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
          className="min-h-0 flex-1 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-2 text-xs leading-relaxed" />
        <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">行数与原字幕相同则保留各自时间,变了则在总时长内均匀分配。</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" disabled={empty} onClick={() => onSave(text.split('\n'))}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> 保存
          </button>
          <button type="button" disabled={empty} onClick={() => onRegenAudio(text)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] px-3 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" /> 重新生成音频
          </button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: 编辑器接入**

`VgTimelineEditorPage.tsx`:
- import:`import { SubtitleBulkEditor } from './timeline/SubtitleBulkEditor';`、`import { rebuildCuesFromLines } from './timeline/subtitleEdit';`
- 状态:`const [subtitleEditorOpen, setSubtitleEditorOpen] = React.useState(false);`
- 给 `<TimelineTracks>` 传 `onEditSubtitle={() => setSubtitleEditorOpen(true)}`。
- 页尾渲染:
  ```tsx
  {subtitleEditorOpen && (
    <SubtitleBulkEditor cues={cues}
      onSave={(lines) => { setCues(rebuildCuesFromLines(cues, lines, contentMs)); setSubtitleEditorOpen(false); }}
      onRegenAudio={(t) => {
        const st = useVgComposer.getState();
        st.setScriptSlot('manual', t); st.setScriptSource('manual'); st.resetDraft();
        setSubtitleEditorOpen(false);
      }}
      onClose={() => setSubtitleEditorOpen(false)} />
  )}
  ```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/SubtitleBulkEditor.tsx chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): 字幕整体编辑框 + 重新生成音频(字幕轨头编辑按钮)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: 右键删除扩展到字幕 cue

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/SubtitleCueTrack.tsx`
- Modify: `packages/app/src/features/video-generation/timeline/TrackContextMenu.tsx`
- Modify: `packages/app/src/features/video-generation/timeline/TimelineTracks.tsx`
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

参考(已有):`TrackContextMenu`(props onUploadLocal/onAddFromLibrary/onPreview/onDeleteClip/onClose,`ctx.track:'video'|'audio'`);`SubtitleCueTrack` cue 块;编辑器 menuCtx 状态。

- [ ] **Step 1: TrackMenuCtx 增 'subtitle' + 菜单仅删除形态**

`TrackContextMenu.tsx`:
- `TrackMenuCtx.track` 类型改为 `'video' | 'audio' | 'subtitle'`。
- 渲染:`track === 'subtitle'` 时只显「删除此字幕」项(隐藏 上传/库/试听);其它轨保持原四项。把上传/库/试听三项包一层 `{ctx.track !== 'subtitle' && (<>...</>)}`,删除项文案随 track 变(subtitle → 「删除此字幕」,否则 「删除此片段」):
  ```tsx
  {ctx.track !== 'subtitle' && (
    <>
      <button ...>从本地上传</button>
      <button ...>从素材库添加</button>
      <button ...>试听本轨</button>
    </>
  )}
  {ctx.clipId && (
    <button type="button" className={`${item} text-rose-600 hover:bg-rose-50`} onClick={() => { onDeleteClip(ctx.clipId!); onClose(); }}>
      <Trash2 className="h-3.5 w-3.5" /> {ctx.track === 'subtitle' ? '删除此字幕' : '删除此片段'}
    </button>
  )}
  ```

- [ ] **Step 2: SubtitleCueTrack cue 右键**

`SubtitleCueTrack.tsx` props 加 `onCueContextMenu?: (e: React.MouseEvent, index: number) => void;`;cue 块加:
```tsx
          onContextMenu={(e) => { if (onCueContextMenu) { e.preventDefault(); onCueContextMenu(e, i); } }}
```
(加在现有 cue `<div>` 的属性上,与 `onDoubleClick` 并列。)

- [ ] **Step 3: TimelineTracks 透传**

`TimelineTracks.tsx`:`SubtitleCueTrack` 加 `onCueContextMenu={(e, idx) => onLaneContextMenu?.(e, 'subtitle', String(idx))}`(用 clipId 字段携带 cue 下标字符串)。`onLaneContextMenu` 的 track 类型已是联合,扩到含 'subtitle':把 prop 类型 `track: 'video' | 'audio'` 改为 `'video' | 'audio' | 'subtitle'`。

- [ ] **Step 4: 编辑器删 cue**

`VgTimelineEditorPage.tsx`:`onLaneContextMenu` 的类型同步改为含 `'subtitle'`;`TrackContextMenu` 的 `onDeleteClip` 回调改为按 track 分发:
```tsx
        <TrackContextMenu ctx={menuCtx}
          onUploadLocal={() => doUploadLocal(menuCtx.track === 'audio' ? 'audio' : 'video')}
          onAddFromLibrary={() => setLibPickTrack(menuCtx.track === 'audio' ? 'audio' : 'video')}
          onPreview={() => (menuCtx.track === 'audio' ? doPreviewAudioTrack() : doPreviewNarration())}
          onDeleteClip={(id) => {
            if (menuCtx.track === 'subtitle') {
              const idx = Number(id);
              setCues((prev) => prev.filter((_, i) => i !== idx));
            } else {
              onTimelineChange(deleteAnyClip(timeline, id));
            }
          }}
          onClose={() => setMenuCtx(null)} />
```
> `menuCtx.track` 现含 'subtitle';`doUploadLocal`/`setLibPickTrack` 仅接受 'video'|'audio',故上面三元收窄(subtitle 不会触发上传/库,菜单已隐藏这些项)。

- [ ] **Step 5: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 6: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/SubtitleCueTrack.tsx chayuan-client/packages/app/src/features/video-generation/timeline/TrackContextMenu.tsx chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): 右键删除扩展到字幕 cue(subtitle 仅删除形态)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: 素材库可拖调宽分隔条

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/MediaPoolPanel.tsx`
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

参考(已有):`MediaPoolPanel`(可折叠,`w-72` 固定);编辑器上半区 `<div className="flex min-h-0 flex-1"><MediaPoolPanel /><div ...预览/></div>`。

- [ ] **Step 1: MediaPoolPanel 宽度受控**

把固定 `w-72` 改为受控 `width` prop(展开时用 width,折叠时 36px):
```tsx
export const MediaPoolPanel: React.FC<{ width?: number }> = ({ width = 288 }) => {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="flex shrink-0 flex-col border-r border-[var(--cy-border-subtle)]" style={{ width: open ? width : 36 }}>
      ... (其余不变)
```

- [ ] **Step 2: 编辑器加拖拽分隔条**

`VgTimelineEditorPage.tsx`:
- 状态:`const [poolW, setPoolW] = React.useState<number>(() => Number(localStorage.getItem('cy.vg.mediapool.w')) || 288);`
- 上半区结构改为 `<MediaPoolPanel width={poolW} />` + 一条分隔条 + 预览:
  ```tsx
  <div className="flex min-h-0 flex-1">
    <MediaPoolPanel width={poolW} />
    <div
      onPointerDown={(e) => {
        const startX = e.clientX; const startW = poolW;
        const move = (ev: PointerEvent) => {
          const w = Math.max(160, Math.min(560, startW + (ev.clientX - startX)));
          setPoolW(w);
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); localStorage.setItem('cy.vg.mediapool.w', String(poolW)); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }}
      className="w-1 shrink-0 cursor-ew-resize bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]"
    />
    <div className="min-h-0 flex-1 p-3"> ... PreviewPlayer ... </div>
  </div>
  ```
  > 注意:`up` 里存 `poolW` 是闭包旧值;改为在 move 末尾或用 ref 存最新值再写 localStorage。简化:`up` 里改为读取一个 `latestRef`。实现者用 ref:`const latestW = React.useRef(poolW); ...move 里 latestW.current = w; setPoolW(w); ...up 里 localStorage.setItem(..., String(latestW.current))`。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/MediaPoolPanel.tsx chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): 素材库与预览之间可拖拽调宽(存 localStorage)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: 素材库卡片/列表视图切换

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/MediaPoolPanel.tsx`
- Modify: `packages/app/src/features/video-generation/steps/MaterialsStep.tsx`

参考(已有):`MaterialsStep`(tab=mine/online/link/upload;MineTab/OnlineTab 渲染卡片网格,卡片 `draggable` + `setDragData` 已加);卡片含 `m.material_id/name/mime/duration_ms/size`(MineTab)、`item.url/duration/provider/image`(OnlineTab)。

- [ ] **Step 1: MediaPoolPanel 视图切换按钮 + 透传**

`MediaPoolPanel.tsx`:加 `view` 状态(存 localStorage)+ 顶部切换按钮,透传给 MaterialsStep:
```tsx
import { LayoutGrid, List as ListIcon } from 'lucide-react';
// ...
const [view, setView] = React.useState<'card' | 'list'>(() => (localStorage.getItem('cy.vg.pool.view') === 'list' ? 'list' : 'card'));
const setV = (v: 'card' | 'list') => { setView(v); localStorage.setItem('cy.vg.pool.view', v); };
// 顶部按钮行(open 时显示,折叠按钮旁):
{open && (
  <div className="flex items-center gap-1 border-b border-[var(--cy-border-subtle)] px-2 py-1">
    <button type="button" onClick={() => setV('card')} className={view === 'card' ? 'text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)]'} title="卡片"><LayoutGrid className="h-3.5 w-3.5" /></button>
    <button type="button" onClick={() => setV('list')} className={view === 'list' ? 'text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)]'} title="列表"><ListIcon className="h-3.5 w-3.5" /></button>
  </div>
)}
// MaterialsStep 调用传 view:
{open && <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-2"><MaterialsStep view={view} /></div>}
```

- [ ] **Step 2: MaterialsStep 接 view + 透传 MineTab/OnlineTab**

`MaterialsStep.tsx`:组件 props 加 `view?: 'card' | 'list'`(默认 'card');传给 `<MineTab ... view={view} />` `<OnlineTab ... view={view} />`。MineTab/OnlineTab props 加 `view`。

- [ ] **Step 3: MineTab/OnlineTab 卡片/列表双渲染**

MineTab 的卡片 `<li>`:`view==='card'` 用现有网格卡片,但默认隐藏名(名改为 `group-hover` 浮层);`view==='list'` 用紧凑行。把渲染拆成:
```tsx
// 外层 ul className 随 view:
<ul className={view === 'list' ? 'flex flex-col gap-1' : 'grid grid-cols-2 gap-3'}>
```
卡片视图(card):缩略图 + hover 浮名(把现有 `<div className="p-2.5"><p>{m.name}</p>...` 改为绝对定位、`opacity-0 group-hover:opacity-100` 覆盖在缩略图底部):
```tsx
{view === 'card' ? (
  <button ... className="block w-full text-left group">
    <div className="relative aspect-video ...缩略图...">
      {/* 缩略图 */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">{m.name}</span>
    </div>
  </button>
) : (
  <button ... className="flex w-full items-center gap-2 rounded-lg border border-[var(--cy-border-subtle)] p-1 text-left hover:border-[var(--cy-border-strong)]">
    <div className="h-9 w-14 shrink-0 overflow-hidden rounded bg-[var(--cy-surface-2)]">{/* 小缩略图 */}</div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs text-[var(--cy-text-primary)]">{m.name}</p>
      <p className="text-[10px] text-[var(--cy-text-tertiary)]">{Math.round((m.duration_ms||0)/1000)}s · {(m.mime||'').split('/').pop() || '—'} · {fmtSize(m.size)}</p>
    </div>
  </button>
)}
```
两种 `<li>` 都保留 `draggable` + `onDragStart`(在 `<li>` 上,不变)。OnlineTab 同理(用 `item.duration`/`item.url` 扩展名当格式)。
> 实现要点:`draggable`/`onDragStart` 留在 `<li>`;卡片内 img/video 已 `draggable={false}`(P5c 修拖拽时加的);list 视图的小缩略图 img 也加 `draggable={false}`。保留 hover 的预览/删除按钮(MineTab 现有)在 card 视图;list 视图可省略或保留在行尾。

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/MediaPoolPanel.tsx chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx
git commit -m "feat(client/vg): 素材库卡片/列表视图切换(卡片悬停显名,列表显缩略图/名/时长/格式)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 7: 联调验证

- [ ] **Step 1: 全量 typecheck + 单测 + 构建**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck
pnpm exec vitest run packages/app/src/features/video-generation
pnpm run build:web 2>&1 | tail -3
```
Expected: typecheck 0;vitest 全 PASS(含 vgComposer scriptHash 新 2 条 + 既有 timeline 测);web build `✓ built`。

- [ ] **Step 2: 手动验收清单(重建前端 + 重启 sidecar 后)**

- 进编辑器(无脚本)→ 点「生成脚本」→ 填主题/模型/段落/语言 → 生成 → 旁白轨波形 + 字幕轨 cue 自动填充(无需从对话进)。
- 字幕轨头「编辑」→ 整体文本框改字幕 → 保存(轨道 cue 更新)/ 重新生成音频(旁白按新文重生)。
- 素材库与预览之间拖分隔条调宽(刷新后保持);卡片/列表切换:卡片悬停显名、列表显缩略图+名+时长+格式;两种都能拖到轨道。
- 右键字幕 cue → 「删除此字幕」生效;右键视频/音频轨空白 → 上传/库添加/试听;右键 clip → 删除。

- [ ] **Step 3: 最终推送(若联调微调)**

```bash
cd /work/chayuan-desktop
git add -A && git commit -m "fix(vg): P5c-1 联调微调" && git push origin main
```

---

## Self-Review

**Spec coverage:**
- ① 生成脚本表单自包含 → Task 1(scriptHash 含 subject)、Task 2(ScriptGenDialog + canGen 放宽 + 触发)。✓
- ② 字幕整体编辑 + 重新生成音频 → Task 3(SubtitleBulkEditor + 保存 rebuildCuesFromLines + regen)。✓
- ③ 素材库调宽 + 卡片/列表视图 → Task 5(分隔条)、Task 6(视图切换)。✓
- ④ 右键删除扩展到字幕 cue → Task 4。✓

**Placeholder scan:** 无 TBD。Task 5 闭包旧值问题已显式给 ref 解法(非占位);Task 6 给了双视图渲染骨架 + 要点。

**Type consistency:** `scriptHashOf` 含 video_subject(Task1)被编辑器 canGen/effect 用;`ScriptGenDialog` onSubmit 形参 `{subject,model,paragraph,language}`(Task2)与编辑器 submitScriptGen 一致;`SubtitleBulkEditor` onSave(lines)/onRegenAudio(text)(Task3)与编辑器 rebuildCuesFromLines/setScriptSlot 一致;`TrackMenuCtx.track` 扩 'subtitle'(Task4)被 SubtitleCueTrack→TimelineTracks→编辑器 menuCtx 一致;`MediaPoolPanel` width/view(Task5/6)与编辑器/MaterialsStep 一致;`MaterialsStep` view prop(Task6)透传 MineTab/OnlineTab 一致。

**依赖顺序:** Task1(hash)→Task2(生成表单,依赖 hash 含 subject 才能触发重生);Task3/4/5/6 相互独立(都改编辑器 + 各自组件,串行实现避免编辑器并发冲突);Task7 联调。无循环依赖。Task4/Task6 都改 MaterialsStep/TrackContextMenu 等不同文件,按编号串行即可。

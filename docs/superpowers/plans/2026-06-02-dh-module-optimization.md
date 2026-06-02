# 数字人模块优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知识库收敛为 preset 单一真源(删角色级 KB)、编辑/生成布局重排、卡片「生成」入工作台,并修"选音色未生效"bug。

**Architecture:** 前端 React/TS(`chayuan-client`)为主:删 `AvatarSlot.ku_ids` 字段 + 编辑页/生成面板布局重排 + 路由一行改;后端 `chayuan-server` 仅删 `AvatarSlotSchema.ku_ids` 冗余字段(检索本就用 preset 单一 ku_ids,无逻辑改)。#2 走系统化排查。

**Tech Stack:** React + TypeScript + pnpm(typecheck);Python + FastAPI + pytest。

**环境前提(执行者必读):**
- 仓库 `/work/chayuan-desktop` **root 所有**,写文件/`git add`/`commit` 需 `sudo`(Edit 工具 EACCES 时改用 sudo 补丁脚本)。
- 前端验证:`cd /work/chayuan-desktop/chayuan-client && pnpm -w typecheck`(或 `npm run typecheck`)。
- 后端验证:`PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q <file>`。
- 固定分支 `main → origin/main`;**仅用户明确要求时** commit/push。
- 真机外观/合成验证标 `[VERIFY]`。

**重要修正(对 spec §5.1/§6)**:后端 `multirole.py` 不读角色级 `ku_ids`,检索已用 preset 单一 `ku_ids`(`digital_human_routes.py:242-297`)。故"去角色级 KB"后端=删冗余字段,无检索逻辑重写。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `chayuan-client/packages/api/src/digitalHuman.ts` | DH 类型 + API | 删 `AvatarSlot.ku_ids` |
| `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py` | 后端 DH schema | 删 `AvatarSlotSchema.ku_ids`(:18) |
| `chayuan-client/.../digital-human/PresetEditor.tsx` | 编辑预设 UI | 删"该角色知识库"+ 布局重排(合成模式上移、三项一行) |
| `chayuan-client/.../digital-human/GeneratePanel.tsx` | 生成面板 | KB/模型 override 门控统一、单一 KB |
| `chayuan-client/.../digital-human/DigitalHumanPage.tsx` | DH 主页 tab | 卡片生成 → studio |
| `chayuan-server/.../tests/unit_tests/test_digital_human_*.py` | 后端单测 | schema 无 ku_ids 回归 + #2 音色回归 |

---

## Task 1: 删除角色级知识库字段(#1/#5 数据模型)

**Files:**
- Modify: `chayuan-client/packages/api/src/digitalHuman.ts:31`
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py:18`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py`(追加)

- [ ] **Step 1: 写失败测试(后端 schema 不再有 role ku_ids)**

追加到 `test_digital_human_store.py`:

```python
def test_avatar_slot_schema_has_no_role_ku_ids():
    from chayuan.server.video_generation.digital_human.schemas import AvatarSlotSchema
    assert "ku_ids" not in AvatarSlotSchema.model_fields, "角色级 ku_ids 应已彻底移除(知识库收敛为 preset 单一真源)"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -k no_role_ku_ids -v`
Expected: FAIL(字段仍在)

- [ ] **Step 3: 删后端 schema 字段**

`schemas.py:18` 删除整行:
```python
    ku_ids: List[str] = Field(default_factory=list)  # 该角色专属知识源;空=用预设级 ku_ids
```
(保留 :57 的 preset 级 `ku_ids`,那是单一真源。)

- [ ] **Step 4: 删前端类型字段**

`digitalHuman.ts:31` 删除整行:
```typescript
  ku_ids?: string[];      // 该角色专属知识源;空=用预设级 ku_ids
```

- [ ] **Step 5: 全量 grep 清残留引用**

Run: `grep -rn "\.ku_ids" /work/chayuan-desktop/chayuan-client/packages/app/src/features/digital-human/ | grep -iv "curPreset\|preset\.\|scriptKuIds"`
对每个命中:若是 `slot.ku_ids` / `fSlot.ku_ids` / `setSlotField(...ku_ids...)` 一律删除(下个 Task 删 UI 时一并处理)。记录命中清单。

- [ ] **Step 6: 跑测试 + typecheck 确认通过**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -k no_role_ku_ids -v`
Expected: PASS
Run: `cd /work/chayuan-desktop/chayuan-client && pnpm -w typecheck`
Expected: 若有 `slot.ku_ids` 残留引用会报错 → Task 2 删 UI 后复跑应过

- [ ] **Step 7: commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-client/packages/api/src/digitalHuman.ts \
  chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
sudo git commit -m "refactor(dh): 移除角色级 ku_ids,知识库收敛为 preset 单一真源"
```

---

## Task 2: PresetEditor 布局重排 + 删"该角色知识库"(#3/#4/#5)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx`

> 这是 JSX 块移动 + 删除,按锚点操作。当前关键锚点(探索确认):合成模式 `:327-344`;模型/KB/两个 override 散落 `:380-400`;聚焦角色音色 `:519-538`;**该角色知识库 `:549-555`**。

- [ ] **Step 1: 删"该角色知识库"块(#5)**

删除 `PresetEditor.tsx:549-555` 整块(标签「该角色知识库」+ `<KnowledgePickerPill value={fSlot.ku_ids ...} onChange={(ids)=>setSlotField(fSlot.ref,{ku_ids:ids})}/>` + 「留空=用预设知识库」span)。同时删除任何 `fSlot.ku_ids` / `setSlotField(..., {ku_ids})` 引用(对齐 Task 1 Step 5 清单)。

- [ ] **Step 2: 合成模式上移到名字下(#3)**

把合成模式三按钮块(当前 `:327-344`)移动到"名字"输入框之后、紧邻其下。目标顺序:`形象选择 → 名字输入 → 合成模式按钮组 → (Step 3 的三项一行)`。仅移动 JSX 位置,不改其 state/onClick 逻辑。

- [ ] **Step 3: KB/模型/两个 override 收成一行(#4)**

把现有「对话模型选择」「知识库选择」「允许模型更改 checkbox」「允许KB更改 checkbox」重排进**一个 flex row**,顺序固定:

```tsx
{/* 知识 / 模型 / 允许更改 — 一行 */}
<div className="flex flex-wrap items-center gap-3">
  {/* 1) 知识库(在模型前) */}
  <div className="flex items-center gap-1">
    <span className="text-xs text-[var(--cy-text-tertiary)]">知识库</span>
    <KnowledgePickerPill value={kuIds} onChange={setKuIds} />
  </div>
  {/* 2) 对话模型 */}
  <div className="flex items-center gap-1">
    <span className="text-xs text-[var(--cy-text-tertiary)]">对话模型</span>
    {/* 现有 model DropdownMenu/选择器,原样搬入 */}
  </div>
  {/* 3) 允许更改(两个独立开关,放模型后) */}
  <label className="flex items-center gap-1 text-xs">
    <input type="checkbox" checked={allowModelOverride} onChange={...} />允许生成时改模型
  </label>
  <label className="flex items-center gap-1 text-xs">
    <input type="checkbox" checked={allowKbOverride} onChange={...} />允许生成时改知识库
  </label>
</div>
```

绑定沿用现有 state(`allowModelOverride`/`allowKbOverride` 及 KB/model 值),只重排 DOM 与文案,不改保存请求体字段。

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm -w typecheck`
Expected: PASS(无 `fSlot.ku_ids` 残留报错)

- [ ] **Step 5: [VERIFY] 手动看编辑页**

启动前端,打开"编辑数字人":确认顺序 形象→名字→合成模式→[知识库|对话模型|允许改模型|允许改KB] 一行→角色区(无"该角色知识库")。

- [ ] **Step 6: commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx
sudo git commit -m "feat(dh): 编辑页布局重排(合成模式上移+知识/模型/开关一行)+删该角色知识库"
```

---

## Task 3: GeneratePanel 统一(#4 生成面板侧)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx`(KB/模型区 `:587-632`)

- [ ] **Step 1: KB/模型选择器 override 门控**

确保生成面板的「对话模型」「知识库」选择器**仅当对应 override 开启**时可编辑/显示,否则只读展示预设绑定来源(复用 `usePresetBinding`/`dhBinding` 的显隐逻辑 `showModelPicker`/`showKbPicker`)。KB 值统一来自 preset `ku_ids`(或 override 开启时的临时 `scriptKuIds`),不引用任何角色级 KB。

- [ ] **Step 2: 顺序对齐编辑页(知识库→模型→允许更改)**

把生成面板该区控件顺序与编辑页一致(知识库在模型前)。仅重排 DOM。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm -w typecheck`
Expected: PASS

- [ ] **Step 4: [VERIFY] override 开/关**

手动:preset 关闭"允许生成时改知识库/模型"→ 生成面板对应选择器锁定只读;开启→ 可改且生效。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx
sudo git commit -m "feat(dh): 生成面板 KB/模型与编辑页统一(override 门控+单一KB)"
```

---

## Task 4: 卡片「生成」进工作台(#6)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/digital-human/DigitalHumanPage.tsx:22-24`

- [ ] **Step 1: 改 goGenerate 目标 tab**

`DigitalHumanPage.tsx:24` 把:
```tsx
    setTab('generate');
```
改为:
```tsx
    setTab('studio');
```
(`goGenerate` 已 `setGenPresetId(presetId)`;`DhStudio` 已接 `initialPresetId={genPresetId}`,line 62。)

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm -w typecheck`
Expected: PASS

- [ ] **Step 3: [VERIFY] 卡片生成跳转**

手动:"我的数字人"卡片点「生成」→ 进入"工作台"tab,左预览 + 右生成面板均预选该数字人。

- [ ] **Step 4: commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-client/packages/app/src/features/digital-human/DigitalHumanPage.tsx
sudo git commit -m "feat(dh): 我的数字人卡片「生成」进入工作台并预选"
```

---

## Task 5: #2 选音色未生效 — 系统化排查 + 修复

> 这是 bug,**不预设修法**。执行此 Task 必须先用 `superpowers:systematic-debugging` 走完 Phase 1(根因)再改。

**Files(待根因确定):**
- 候选:`chayuan-server/.../digital_human/compose_multi.py` / `jobs.py`(合成逐段 TTS 是否按 slot 音色)、`api_server/digital_human_routes.py`(生成入口是否丢音色)、`PresetEditor.tsx:45-48`(单形象 slots[0] 音色是否镜像到 preset 顶层 voice_provider/name)。

- [ ] **Step 1: 收集现场证据(systematic-debugging Phase 1)**

按链路埋点/查日志,确认断点:选定音色 → 存哪(preset 顶层 vs slots[0] vs 各 slot)→ 生成请求体是否带 → 后端合成 TTS 实际用的 voice_provider/name 是什么。记录 RCA 模板(用户操作 / endpoint / 数据状态 / 假设 + 反证)。

- [ ] **Step 2: 写失败回归测试(复现真因)**

根因定位后,在 `test_digital_human_*.py` 写一个最小复现:给定 preset 选定音色 X,断言生成任务/合成参数实际使用音色 X(而非默认)。先确认 FAIL。

- [ ] **Step 3: 最小修复**

针对根因改一处(不"顺手"重构)。

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q <相关测试> -v`
Expected: PASS;现有 DH 测试不回归

- [ ] **Step 5: [VERIFY] 真机合成**

手动:选非默认音色生成,产物语音为该音色。

- [ ] **Step 6: commit**

```bash
cd /work/chayuan-desktop
sudo git add <根因相关文件> <测试>
sudo git commit -m "fix(dh): 选定音色未生效(根因: <填实际根因>)"
```

---

## 收尾验证(全部任务后)

- [ ] `cd /work/chayuan-desktop/chayuan-client && pnpm -w typecheck` 全绿(无 `AvatarSlot.ku_ids` 残留)
- [ ] `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py`(含新回归)
- [ ] `grep -rn "AvatarSlot" chayuan-client chayuan-server` 确认无残留角色级 ku_ids 引用
- [ ] [VERIFY] 真机:编辑页布局、生成面板一致、卡片入工作台、音色生效
- [ ] `git status` 只动计划内文件

# 数字人形象管理 + 多形象合成 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让数字人形象可缩略图预览/删除/替换,并把预设扩展为「多形象 + 合成模式(单/同框/分段)」,复用现有 render_from_edl 合成。

**Architecture:** 方案 B——扩展 `DigitalHumanPreset` 持有 `avatars`+`compose_mode`+`layout`(向后兼容旧单形象预设);前端 `PresetEditor` 渲染真缩略图并加删除/替换;后端 `jobs._run_pipeline` 按 `compose_mode` 分派,coframe/sequential 复用 `render_from_edl` 多轨/顺序拼接,不新增引擎。多照合一受单图引擎约束,退化为「挑最佳单帧」。

**Tech Stack:** chayuan-server(FastAPI/Pydantic v2/pytest) + chayuan-client(React/TS/vitest)。spec: docs/superpowers/specs/2026-05-31-digital-human-avatar-multimode-design.md

> 提交约定(本仓特有):仓库 root 所有,编辑用 sudo;`sudo git add <精确文件>` 只 stage 改动文件(勿 `-A`,工作树有大量 mode-bit 噪音);分支 main → origin/main;commit 末尾加 Co-Authored-By。py 语法自检:`grep -v 'from __future__ import annotations' <f> > /tmp/x.py && python3 -m py_compile /tmp/x.py`(本机 python3 是 3.6,带 future/walrus 的整文件编不过,属正常)。

---

## 文件结构

- `chayuan-server/.../digital_human/schemas.py` — 加 `AvatarSlot`、预设新字段 + 向后兼容 model_validator。
- `chayuan-server/.../digital_human/store.py` — `create_preset` 增参;load/save 经 validator 自动镜像。
- `chayuan-server/.../api_server/digital_human_routes.py` — create 路由透传新字段。
- `chayuan-client/packages/api/src/digitalHuman.ts` — TS 类型加 `AvatarSlot`/新字段。
- `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx` — 缩略图 + 删除 + 替换 UI。
- 测试 `chayuan-server/.../tests/unit_tests/test_digital_human_store.py`(扩)。

本计划覆盖 **M1(前端形象 UX)+ M2(数据模型向后兼容)**。M3 同框 / M4 分段 / M5 多照合一 / M6 时间轴桥接在 M2 落地后各出独立计划(它们依赖 M2 的具体类型,届时代码才确定,现在写会是占位)。

---

## M2: 后端数据模型向后兼容扩展(先做——M1 前端类型依赖它)

### Task 1: schemas 加 AvatarSlot + 预设新字段 + 兼容 validator

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py`

- [ ] **Step 1: 写失败测试**(追加到 test 文件末尾)

```python
from chayuan.server.video_generation.digital_human.schemas import (
    DigitalHumanPreset as _P, AvatarSlot as _Slot,
)

def test_preset_backfills_avatars_from_legacy_ref():
    # 旧 presets.json 行没有 avatars/compose_mode → 应回填且默认 single
    p = _P(id="p1", name="A", avatar_ref="user:f.mp4", avatar_kind="video", created=1.0)
    assert p.compose_mode == "single"
    assert len(p.avatars) == 1
    assert p.avatars[0].ref == "user:f.mp4" and p.avatars[0].kind == "video"

def test_preset_mirrors_first_avatar_to_legacy_ref():
    # 给了 avatars → avatar_ref/kind 应镜像首槽(旧单形象消费方不破)
    p = _P(id="p2", name="B", avatar_ref="", avatar_kind="image",
           avatars=[_Slot(ref="user:a.png", kind="image", lines="台词1"),
                    _Slot(ref="user:b.mp4", kind="video")],
           compose_mode="coframe", layout="pip")
    assert p.avatar_ref == "user:a.png" and p.avatar_kind == "image"
    assert p.avatars[1].lines == ""
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -q`
Expected: FAIL(`ImportError: cannot import name 'AvatarSlot'` 或字段不存在)

- [ ] **Step 3: 改 schemas.py**

把 import 行改为含 `List` 与 `model_validator`,并在 `DigitalHumanPreset` 上加字段/校验器。
顶部 import:
```python
from typing import List, Literal, Optional
from pydantic import BaseModel, Field, model_validator
```
在 `AvatarKind = Literal[...]` 之后新增:
```python
class AvatarSlot(BaseModel):
    ref: str
    kind: AvatarKind = "image"
    label: str = ""
    lines: str = ""          # 该形象台词(同框/分段用);空=回退全局 text
```
`DigitalHumanPreset` 类:把 `avatar_ref` 默认改为 `""`(供仅传 avatars 的新调用),并在 `created` 字段后新增:
```python
    avatars: List[AvatarSlot] = Field(default_factory=list)
    compose_mode: Literal["single", "coframe", "sequential"] = "single"
    layout: Literal["side", "pip", "main_minor"] = "side"

    @model_validator(mode="after")
    def _sync_avatars(self) -> "DigitalHumanPreset":
        # 旧行(无 avatars)→ 用 avatar_ref 回填;有 avatars → 首槽镜像回旧字段,
        # 保证 jobs 单形象路径(读 preset.avatar_ref)对老/新数据都成立。
        if not self.avatars and self.avatar_ref:
            self.avatars = [AvatarSlot(ref=self.avatar_ref, kind=self.avatar_kind)]
        if self.avatars:
            self.avatar_ref = self.avatars[0].ref
            self.avatar_kind = self.avatars[0].kind
        return self
```
具体把 `avatar_ref: str` 改成 `avatar_ref: str = ""`。

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS(含原有 `test_dh_schemas_roundtrip` 仍过)

- [ ] **Step 5: 提交**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
sudo git commit -m "feat(dh): 预设加 AvatarSlot/compose_mode/layout + 向后兼容回填

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2: store.create_preset 接收新字段

**Files:**
- Modify: `chayuan-server/.../digital_human/store.py` (create_preset)
- Test: 同 test_digital_human_store.py

- [ ] **Step 1: 写失败测试**

```python
def test_create_preset_with_avatars(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(
        name="多形象", avatar_ref="user:a.png", avatar_kind="image",
        avatars=[{"ref": "user:a.png", "kind": "image"},
                 {"ref": "user:b.mp4", "kind": "video", "lines": "你好"}],
        compose_mode="sequential", layout="side",
    )
    assert p.compose_mode == "sequential" and len(p.avatars) == 2
    got = dh_store.get_preset(p.id)
    assert got is not None and got.avatars[1].lines == "你好"
```
(`_helpers`/`dh_store` 已在该文件 import。)

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py::test_create_preset_with_avatars -q`
Expected: FAIL(`create_preset() got an unexpected keyword argument 'avatars'`)

- [ ] **Step 3: 改 store.create_preset**

把签名与构造改为:
```python
def create_preset(*, name: str, avatar_ref: str = "", avatar_kind: str = "image",
                  voice_provider: str = "piper", voice_name: str = "",
                  is_greenscreen: bool = False,
                  avatars: Optional[List[Dict[str, Any]]] = None,
                  compose_mode: str = "single", layout: str = "side") -> DigitalHumanPreset:
    p = DigitalHumanPreset(
        id=uuid.uuid4().hex[:12], name=name, avatar_ref=avatar_ref,
        avatar_kind=avatar_kind, is_greenscreen=is_greenscreen,
        voice_provider=voice_provider, voice_name=voice_name, created=time.time(),
        avatars=avatars or [], compose_mode=compose_mode, layout=layout,
    )
    rows = _load_raw(); rows.append(p.model_dump()); _save_raw(rows)
    return p
```
(`update_preset` 无需改:它 `r.update(safe)` 后 `DigitalHumanPreset(**hit)`,validator 会把 list[dict] 的 avatars 强转成 AvatarSlot 并镜像。)

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -q`
Expected: PASS(全文件)

- [ ] **Step 5: 提交**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/store.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
sudo git commit -m "feat(dh): store.create_preset 接收 avatars/compose_mode/layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 3: create 路由透传新字段

**Files:**
- Modify: `chayuan-server/.../api_server/digital_human_routes.py` (create_preset)
- Test: `chayuan-server/.../tests/unit_tests/test_digital_human_routes.py`

- [ ] **Step 1: 写失败测试**(追加;参照该文件现有 TestClient 用法)

```python
def test_create_preset_route_accepts_avatars(client):
    # client: 现有 fixture(若无,仿照文件里已有路由测试构造 TestClient + 临时 root)
    body = {"name": "X", "avatar_ref": "user:a.png", "avatar_kind": "image",
            "avatars": [{"ref": "user:a.png", "kind": "image"}],
            "compose_mode": "coframe", "layout": "pip"}
    r = client.post("/api/v1/digital-human/presets", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["compose_mode"] == "coframe" and len(data["avatars"]) == 1
```
(若该测试文件没有现成 `client` fixture,先看文件顶部已有怎么建 TestClient,照搬;不要新造一套。)

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -q -k avatars`
Expected: FAIL(`compose_mode` 不在返回里 / KeyError)

- [ ] **Step 3: 改 create_preset 路由**

`store.create_preset(...)` 调用里补三个透传:
```python
        p = store.create_preset(
            name=body["name"], avatar_ref=body.get("avatar_ref", ""),
            avatar_kind=body.get("avatar_kind", "image"),
            voice_provider=body.get("voice_provider", "piper"),
            voice_name=body.get("voice_name", ""),
            is_greenscreen=bool(body.get("is_greenscreen", False)),
            avatars=body.get("avatars"),
            compose_mode=body.get("compose_mode", "single"),
            layout=body.get("layout", "side"),
        )
```
(把原来 `body["avatar_ref"]`/`body["avatar_kind"]` 改成 `.get(...)`,因为现在可只传 avatars。)

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 5: 提交**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py
sudo git commit -m "feat(dh): create 预设路由透传 avatars/compose_mode/layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4: 前端 TS 类型补齐

**Files:**
- Modify: `chayuan-client/packages/api/src/digitalHuman.ts`

- [ ] **Step 1: 加类型**(在 `DhAvatarKind` 定义后)

```typescript
export interface AvatarSlot {
  ref: string;
  kind: DhAvatarKind;
  label?: string;
  lines?: string;
}
export type DhComposeMode = 'single' | 'coframe' | 'sequential';
export type DhLayout = 'side' | 'pip' | 'main_minor';
```
并在 `DigitalHumanPreset` interface 末尾(`created` 后)加:
```typescript
  avatars?: AvatarSlot[];
  compose_mode?: DhComposeMode;
  layout?: DhLayout;
```

- [ ] **Step 2: 类型检查**

Run: `cd chayuan-client && npm run typecheck`
Expected: 通过(无新错误)

- [ ] **Step 3: 提交**

```bash
sudo git add chayuan-client/packages/api/src/digitalHuman.ts
sudo git commit -m "feat(dh): 前端预设类型加 AvatarSlot/compose_mode/layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## M1: 前端形象 tile 缩略图 + 删除 + 替换

> 说明:`PresetEditor.tsx` 是渲染组件,本仓 app 包未必有该组件的 vitest 套件。M1 用「实现 + `npm run typecheck` + 手动验证」收尾(起 web `pnpm dev`,打开新建数字人,看到缩略图/删除/替换)。若发现同目录已有 *.test.tsx,则按其风格补渲染测试。

### Task 5: 形象 tile 渲染真缩略图(替代文件名文字)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx` (形象选择器 116-132 行附近)

- [ ] **Step 1: 替换 tile 内容**

把现有 `<button>...{a.name}...{a.kind}...</button>` 的内层从纯文字改为缩略图。tile 用相对定位容器,内部按 kind 渲染:
```tsx
{avatars.map((a) => (
  <div key={a.ref} className="relative">
    <button
      type="button"
      onClick={() => setAvatarRef(a.ref)}
      title={a.name}
      className={cn(
        'h-16 w-16 overflow-hidden rounded-lg border transition-colors',
        avatarRef === a.ref
          ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-400)]'
          : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-300)]',
      )}
    >
      {a.kind === 'video' ? (
        <video
          src={digitalHuman.avatarFileUrl(a.ref)}
          muted preload="metadata" playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <img
          src={digitalHuman.avatarFileUrl(a.ref)}
          alt={a.name}
          className="h-full w-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
        />
      )}
    </button>
  </div>
))}
```
(`digitalHuman.avatarFileUrl` 已存在于 digitalHuman.ts 导出。)

- [ ] **Step 2: 类型检查**

Run: `cd chayuan-client && npm run typecheck`
Expected: 通过

- [ ] **Step 3: 手动验证**

起 web(`pnpm dev`,见 apps/web),打开「新建数字人」。
Expected: 形象格子显示图片/视频缩略图,不再是文件名文字;选中有高亮边框。

- [ ] **Step 4: 提交**

```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx
sudo git commit -m "feat(dh): 形象 tile 渲染缩略图替代文件名文字

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 6: tile 加删除按钮(仅 user 来源)

**Files:**
- Modify: `PresetEditor.tsx`(Task 5 的 tile 容器内 + 顶部加 confirmDialog import)

- [ ] **Step 1: 顶部确保引入项目弹框**(本仓约定不用 window.confirm)

文件已可能从某处导出 confirmDialog;若没有,按本仓其它组件用法 import(grep `confirmDialog` 找来源)。加状态:
```tsx
const [deleting, setDeleting] = React.useState<string | null>(null);
const onDeleteAvatar = async (a: DhAvatar) => {
  const ok = await confirmDialog({ title: '删除形象', message: `确定删除「${a.name}」?` });
  if (!ok) return;
  setDeleting(a.ref);
  try {
    await digitalHuman.deleteAvatar(a.name);
    if (avatarRef === a.ref) setAvatarRef('');
    await qc.invalidateQueries({ queryKey: ['dh.avatars'] });
  } catch (err) {
    reportError(err as Error, '删除形象失败');
  } finally {
    setDeleting(null);
  }
};
```
(`digitalHuman.deleteAvatar` 已存在;`dhDeleteAvatar` 走 `DELETE /avatars/{name}`,故传 `a.name`。)

- [ ] **Step 2: 在 tile 容器内加删除角标**(Task 5 的 `<div className="relative">` 内、`</button>` 后)

```tsx
{a.source === 'user' && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onDeleteAvatar(a); }}
    disabled={deleting === a.ref}
    title="删除"
    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--cy-danger-500)] text-white opacity-0 group-hover:opacity-100"
  >
    <X className="h-2.5 w-2.5" />
  </button>
)}
```
并给 Task 5 的 `<div className="relative">` 加 `group` 类(`className="group relative"`)。`X` 从 lucide-react import(文件已用 lucide 的 Plus/Loader2,追加 `X`)。

- [ ] **Step 3: 类型检查 + 手动验证**

Run: `cd chayuan-client && npm run typecheck`;再 `pnpm dev` 验证:鼠标移到自定义形象上出现红色 ×,点击弹确认框,确认后该形象消失。bundled 形象无 ×。

- [ ] **Step 4: 提交**

```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx
sudo git commit -m "feat(dh): 形象 tile 加删除(仅 user 来源 + 二次确认)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7: 替换形象(删旧 + 传新)

**Files:**
- Modify: `PresetEditor.tsx`

- [ ] **Step 1: 加替换逻辑**(复用已有 avatarFileRef + onUploadAvatar 思路)

加一个「替换选中形象」按钮(仅当选中项为 user 来源时显示),点它先记下待删 ref 再触发文件选择:
```tsx
const [replacing, setReplacing] = React.useState<string | null>(null);
const onReplaceClick = (a: DhAvatar) => { setReplacing(a.ref); avatarFileRef.current?.click(); };
```
改 `onUploadAvatar` 末尾:上传成功后,若 `replacing` 非空则删旧:
```tsx
const a = await digitalHuman.uploadAvatar(f);
if (replacing) {
  const old = avatars.find((x) => x.ref === replacing);
  if (old && old.source === 'user') {
    try { await digitalHuman.deleteAvatar(old.name); } catch { /* 删旧失败不阻断 */ }
  }
  setReplacing(null);
}
await qc.invalidateQueries({ queryKey: ['dh.avatars'] });
setAvatarRef(a.ref);
```

- [ ] **Step 2: 加替换按钮 UI**(选中且 user 来源时)

在形象选择器下方加:
```tsx
{selectedAvatar?.source === 'user' && (
  <button type="button" onClick={() => onReplaceClick(selectedAvatar)}
          className="self-start text-[11px] text-[var(--cy-brand-600)] hover:underline">
    替换当前形象
  </button>
)}
```

- [ ] **Step 3: 类型检查 + 手动验证**

`npm run typecheck`;`pnpm dev`:选中一个自定义形象 → 点「替换当前形象」→ 选新文件 → 新形象出现且自动选中、旧的被删。

- [ ] **Step 4: 提交**

```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx
sudo git commit -m "feat(dh): 支持替换选中形象(传新+删旧)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 后续独立计划(M2 落地后各自细化)

这些依赖 M2 的具体类型与 jobs 改造,届时再各出一份本式样的 TDD 计划:

- **M3 同框(coframe):** `compose.py` 把 `build_presenter_edl` 泛化为多 presenter 轨(按 `layout` 定位 PIP);`jobs._run_pipeline` 加 coframe 分支(每槽各合成音频+生片段→多轨 render_from_edl,多路音频混音);`DhGenerateRequest` 可选 `compose_mode` 覆盖;`PresetEditor` 加同框模式 UI(多选+layout+每槽台词)。
- **M4 分段(sequential):** jobs 加 sequential 分支(按 (槽,lines/段) 顺序生片段→顺序 track_start_ms 拼接,音频顺序拼接);UI 可排序 (形象+段文本) 列表。
- **M5 多照合一:** 新增 `build_reference_image(paths)->path`(人脸检测挑最佳单帧,无脸回退第一张);上传 UI 多选+「合成参考图」开关;真·多参考身份建模本期不做。
- **M6 时间轴桥接:** 「高级」按钮把当前形象/片段 `ingest_material`(video_generation_routes:708)进素材库并跳转时间轴。

---

## 自检结论

- **Spec 覆盖:** 本计划覆盖 spec §2(数据模型)、§3 的缩略图/删除/替换、§7 的 M1+M2;§3 的多形象模式 UI、§4 后端分派、§5 多照合一、§6 时间轴 = M3-M6 后续计划(已在上节列明,无遗漏)。
- **占位扫描:** 无 TBD;每个 code step 给了确切代码/命令/预期。
- **类型一致:** `AvatarSlot{ref,kind,label,lines}`、`compose_mode`、`layout` 在 schemas/store/routes/前端类型四处命名一致;前端用已存在的 `digitalHuman.avatarFileUrl/deleteAvatar/uploadAvatar`。
- **风险点:** 路由测试若无现成 `client` fixture,Task 3 Step 1 要先照搬文件内既有 TestClient 构造,不新造;`confirmDialog` import 来源需 grep 确认(本仓约定见记忆「Tauri 禁用 window.prompt/confirm」)。

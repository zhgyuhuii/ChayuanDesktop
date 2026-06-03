# 数字人工作台重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 executing-plans。Steps 用 checkbox。

**Goal:** DhStudio 改三区(左设置/右预览/可拖拽分隔 + 底部全宽任务列表),画布数字人+商品图可拖拽缩放并持久化,任务可删除/乐观插入,商品图后端按坐标摆位。

**Architecture:** 前端 DhStudio 重排 + 复用 `useLaneResizer` 拖拽分隔 + 抽 `DhTaskList`;CanvasStage 解锁编辑 + 加商品图层;后端加 DELETE 任务路由(镜像 VG)+ compose 改三层坐标摆位。

**Tech Stack:** React+TS+pnpm typecheck;FastAPI+pytest。

**环境前提:** 仓库 root 所有(写文件/git 走 sudo);沙箱无 node/py312 → ast 静态校验 + 用户机器跑 typecheck/pytest;后端改动需 pull+重启 sidecar,前端 dev 热更。固定分支 main,仅用户要求时 commit。

**复用/锚点(已探索):**
- `DhStudio.tsx`:左 CanvasStage(`readOnly`)+ 右 GeneratePanel(`w-[380px]`)。
- 任务列表在 `GeneratePanel:800-808`(`useQuery(['dh.tasks'],refetchInterval:3000)` → `DhProgressCard`,含下载 `taskFileUrl` + `taskToTimeline`)。
- 删除参照 VG:前端 `videoGeneration.ts:473 vgDeleteTask`(DELETE,query drop_file);后端 `video_generation_routes.py:424 delete_task` → `vg_service.delete_task(task_id, drop_files=)`。DH 任务态在 `jobs.py:_STATUS`(dict),产物在 `<root>/video_generation/storage/tasks/dh-<tid>/`。
- 拖拽分隔:`model-arena/useLaneDnD.ts:useLaneResizer`(纯 pointer)。
- 商品图摆位:`jobs.py:335-348`(product_ref+template → `compose.build_presenter_edl`);`compose.py:18 TEMPLATES{corner/bg/side: x/y/scale}` —— **商品图=全屏底层、presenter=按 template 定位的 PIP**。
- CanvasStage:`{width,height,roles,onChange,readOnly}`;AvatarSlot 有 x/y/scale。

---

## File Structure

| 文件 | 动作 |
|---|---|
| `chayuan-client/.../digital-human/DhStudio.tsx` | 重排三区 + 拖拽分隔 + 渲染 DhTaskList + CanvasStage 可编辑 |
| `chayuan-client/.../digital-human/DhTaskList.tsx` | 建:底部全宽任务列表(复用 DhProgressCard + 删除按钮) |
| `chayuan-client/.../digital-human/DhProgressCard.tsx` | 加删除按钮(可选,或在 DhTaskList 包) |
| `chayuan-client/.../digital-human/GeneratePanel.tsx` | 加 `embedded` prop(embedded 时不渲染自带任务列表)+ 乐观插入 |
| `chayuan-client/.../digital-human/CanvasStage.tsx` | 加商品图层渲染 + 拖拽缩放;studio 可编辑 |
| `chayuan-client/packages/api/src/digitalHuman.ts` | 加 `dhDeleteTask` + AvatarSlot/preset product_x/y/scale 类型 |
| `chayuan-server/.../api_server/digital_human_routes.py` | 加 `DELETE /tasks/{tid}` |
| `chayuan-server/.../digital_human/jobs.py` | `_STATUS` 加 delete;compose 调用传 product 坐标 |
| `chayuan-server/.../digital_human/compose.py` | EDL 改三层(背景→商品定位→presenter定位) |
| `chayuan-server/.../digital_human/schemas.py` | 加 product_x/y/scale |

---

## Task 1: 后端 DH 删除任务路由(镜像 VG)

**Files:** Modify `digital_human_routes.py`、`jobs.py`;Test `test_digital_human_jobs.py`(或新建)

- [ ] **Step 1: jobs.py 加 delete_task**

在 `jobs.py` 的 manager(操作 `_STATUS` 的类/模块函数)加:
```python
def delete_task(tid: str, *, drop_files: bool = True) -> bool:
    st = _STATUS.pop(tid, None)
    if st is None:
        return False
    if drop_files:
        import shutil, os
        from chayuan.server.video_generation import _helpers
        d = os.path.join(_helpers.video_tasks_dir() if hasattr(_helpers, "video_tasks_dir") else
                         str(_helpers._chayuan_root()), "video_generation", "storage", "tasks", f"dh-{tid}")
        try:
            if os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass
    return True
```
> 执行前:看 `jobs.py` 里成片目录真实拼法(`dh-<tid>` 在哪个根),用真实的目录解析函数替换上面 best-effort。

- [ ] **Step 2: 路由 DELETE /tasks/{tid}**

`digital_human_routes.py` 加(镜像 VG `:424`):
```python
@digital_human_router.delete("/tasks/{tid}")
def delete_task(tid: str, drop_file: bool = Query(True),
                user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    from chayuan.server.video_generation.digital_human import jobs
    ok = jobs.delete_task(tid, drop_files=drop_file)
    return {"ok": ok}
```
(`Query` 已 import 则复用;否则从 fastapi 导入。)

- [ ] **Step 3: 测试**

```python
def test_dh_delete_task():
    from chayuan.server.video_generation.digital_human import jobs
    jobs._STATUS["t_del"] = jobs.DhTaskStatus(task_id="t_del", state="complete")
    assert jobs.delete_task("t_del", drop_files=False) is True
    assert "t_del" not in jobs._STATUS
    assert jobs.delete_task("nope", drop_files=False) is False
```
Run: `PYTHONPATH=".../libs/chayuan-server" pytest -q .../test_digital_human_jobs.py -k delete_task -v` → 先 FAIL 后 PASS。

- [ ] **Step 4: commit** `sudo git add ... && sudo git commit -m "feat(dh): 任务删除路由 + jobs.delete_task(镜像 VG)"`

---

## Task 2: 前端 dhDeleteTask + product 字段类型

**Files:** Modify `packages/api/src/digitalHuman.ts`

- [ ] **Step 1: 加 deleteTask + 类型字段**

```typescript
export async function dhDeleteTask(tid: string, opts: { drop_file?: boolean } = {}): Promise<{ ok: boolean }> {
  return rd(`/api/v1/digital-human/tasks/${encodeURIComponent(tid)}`, {
    method: 'DELETE', query: { drop_file: opts.drop_file ?? true },
  });
}
```
(对齐 `vgDeleteTask` 的 rd 写法;加入 `digitalHuman` 命名空间导出 `deleteTask: dhDeleteTask`。)

`DigitalHumanPreset` 接口加(镜像 video_width 旁):
```typescript
  product_x?: number; product_y?: number; product_scale?: number;
```

- [ ] **Step 2: typecheck** `pnpm -w typecheck` → PASS
- [ ] **Step 3: commit**

---

## Task 3: DhStudio 三区布局 + 拖拽分隔 + DhTaskList

**Files:** Create `DhTaskList.tsx`;Modify `DhStudio.tsx`、`GeneratePanel.tsx`

- [ ] **Step 1: 抽 DhTaskList.tsx**(从 GeneratePanel 任务列表搬出 + 删除)

```tsx
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { digitalHuman } from '@chayuan/api';
import { DhProgressCard } from './DhProgressCard';

export const DhTaskList: React.FC = () => {
  const qc = useQueryClient();
  const tasksQ = useQuery({ queryKey: ['dh.tasks'], queryFn: () => digitalHuman.listTasks(), refetchInterval: 3000 });
  const tasks = (tasksQ.data?.items ?? []).slice().reverse();
  const del = async (tid: string) => {
    try { await digitalHuman.deleteTask(tid); } finally { void qc.invalidateQueries({ queryKey: ['dh.tasks'] }); }
  };
  return (
    <div className="flex gap-3 overflow-x-auto p-2">
      {tasks.length === 0 && <div className="text-xs text-[var(--cy-text-tertiary)]">暂无生成任务</div>}
      {tasks.map((t) => (
        <div key={t.task_id} className="relative w-48 shrink-0">
          <DhProgressCard taskId={t.task_id} />
          <button type="button" onClick={() => void del(t.task_id)}
            title="删除" className="absolute right-1 top-1 rounded bg-black/50 px-1 text-[10px] text-white hover:bg-black/70">删除</button>
        </div>
      ))}
    </div>
  );
};
```
> 执行前:核对 `digitalHuman.listTasks` 返回结构(`{items:[{task_id,...}]}`)与 GeneratePanel 现用一致。

- [ ] **Step 2: GeneratePanel 加 `embedded` prop,embedded 时不渲染自带任务列表**

GeneratePanel props 加 `embedded?: boolean`;把现有任务列表块(`:800-808`)包成 `{!embedded && (<...现有任务列表...>)}`。

- [ ] **Step 3: DhStudio 三区重排**

`DhStudio.tsx` return 改为(左设置/右预览/拖拽分隔/底部全宽列表):
```tsx
  const [leftW, setLeftW] = React.useState<number>(() => {
    const v = Number(localStorage.getItem('dh.studio.leftW')); return v >= 320 && v <= 720 ? v : 400;
  });
  const dragRef = React.useRef<{ x: number; w: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, w: leftW };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const nw = Math.max(320, Math.min(720, d.w + (ev.clientX - d.x)));
      setLeftW(nw);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      localStorage.setItem('dh.studio.leftW', String(leftW)); dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex min-h-0 flex-1 gap-0">
        <div className="shrink-0 overflow-y-auto pr-1" style={{ width: leftW }}>
          <GeneratePanel presets={presets} initialPresetId={pid} onPresetChange={setPid} embedded />
        </div>
        <div onPointerDown={onResizeDown} title="拖拽调整宽度"
          className="w-1.5 shrink-0 cursor-col-resize bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]" />
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-[var(--cy-surface-2)] p-4">
          {/* 预览黑框(沿用已修的 contain + ring),CanvasStage readOnly={false} */}
          {/* ...保留现有 preset 预览渲染,把 CanvasStage 的 readOnly 改 false 并接 onChange/onProductChange(Task 4)... */}
        </div>
      </div>
      <div className="h-44 shrink-0 overflow-y-auto rounded-xl border border-[var(--cy-border-subtle)]">
        <DhTaskList />
      </div>
    </div>
  );
```
> 执行前:把现有 DhStudio 里 preset 预览那段(img/video/CanvasStage 分支)整段搬进右侧容器,仅 CanvasStage `readOnly` 改 false + 接 onChange(Task 4 接线)。

- [ ] **Step 4: typecheck + [VERIFY]** 手动:左设置/右预览/中间可拖、底部全宽列表、删除可用。
- [ ] **Step 5: commit**

---

## Task 4: CanvasStage 商品图层 + studio 可编辑数字人/商品(持久化 preset)

**Files:** Modify `CanvasStage.tsx`、`DhStudio.tsx`

- [ ] **Step 1: CanvasStage 加 product 层 + onProductChange**

`CanvasStageProps` 加 `product?: {ref:string; kind:'image'|'video'; x:number; y:number; scale:number}` 和 `onProductChange?: (pos:{x:number;y:number;scale:number}) => void`。在 roles 渲染后追加一个商品图层(复用与角色相同的 move/resize 手柄逻辑,只是数据源是 product、回调 onProductChange)。`readOnly` 时不挂手柄。

- [ ] **Step 2: DhStudio 接线 + 持久化**

右侧 CanvasStage 传 `readOnly={false}`、`roles={preset.avatars}`、`onChange={(ref,pos)=>persist(ref,pos)}`、`product={preset.product_ref?{...}}`、`onProductChange={(pos)=>persistProduct(pos)}`;`persist`/`persistProduct` 松手(debounce 或 pointerup)调 `digitalHuman.updatePreset(pid, {avatars, product_x, product_y, product_scale})` 并 invalidate `['dh.presets']`。

- [ ] **Step 3: typecheck + [VERIFY]** 拖数字人/商品 → 刷新后位置记住(写进 preset)。
- [ ] **Step 4: commit**

---

## Task 5: 后端商品图按坐标摆位(compose 三层)

> ⚠️ **最重一项**。现 `compose.build_presenter_edl`:商品图=全屏底、presenter=按 template(corner/bg/side)的 x/y/scale 定位。要支持「商品图也自由摆位」需把 EDL 改成三层:**背景(纯色/模糊)→ 商品图(product_x/y/scale 定位)→ presenter(其 avatar x/y/scale 定位)**。

**Files:** Modify `schemas.py`、`jobs.py:335-348`、`compose.py`;Test `test_digital_human_compose_position.py`

- [ ] **Step 1: schemas 加 product_x/y/scale**(默认 None=回退 template)。
- [ ] **Step 2: 读 compose.py `build_presenter_edl` 全文**,新增「product 坐标摆位」路径:有 product_x/y/scale 时按归一×画幅摆商品图层(非全屏);presenter 用其 avatar 坐标;无坐标时回退原 TEMPLATES(兼容)。
- [ ] **Step 3: jobs.py:335-348** 传 product 坐标 + avatar 坐标进 compose(从 preset 读)。
- [ ] **Step 4: 单测**:给定 product_x/y/scale + 画幅,断言 EDL 里商品图层 clip 的像素位置 = 归一×画幅(纯函数测,不渲染)。
- [ ] **Step 5: commit**

---

## 收尾验证
- [ ] `pnpm -w typecheck` 全绿;`pytest -q .../test_digital_human_jobs.py .../test_digital_human_compose_position.py` 全绿
- [ ] [VERIFY] 用户机器:三区布局/拖拽/删除/乐观插入/画布拖数字人+商品持久化/成片商品图按拖拽位置
- [ ] `git status` 只动计划内文件
- [ ] (独立)长文案嘴不动 bug 另起 systematic-debugging

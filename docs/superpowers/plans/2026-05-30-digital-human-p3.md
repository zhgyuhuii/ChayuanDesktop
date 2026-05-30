# 数字人 P3(绿幕抠像背景 B)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 数字人(绿幕底形象)生成讲解视频时,开启「绿幕抠像」→ 把人像绿背景抠掉,贴到商品图背景上,更像真人带货。

**Architecture:** 复用现有 moviepy(2.x)直接合成:商品图全屏底 + presenter 经 `vfx.MaskColor` 抠绿后按版式叠加。新增 `digital_human/compose.render_with_product_matte`(自包含,不碰共享时间轴 compose)。jobs 在 `matte=True` 且有商品图时走抠像合成,否则走 P2(不透明 PIP)或 P1(无商品)。

**Tech Stack:** moviepy 2.x(`vfx.MaskColor`/`CompositeVideoClip`)、FastAPI、React。承接 P1/P2。

---

## 背景(读懂再动手)

- moviepy 2.x 用法(`_video_effects.py`/`steps/compose.py` 实证):`from moviepy import CompositeVideoClip, VideoFileClip, ImageClip, AudioFileClip, vfx`;特效走 `clip.with_effects([vfx.X(...)])`;定位 `clip.with_position((x,y), relative=True)`;缩放 `clip.resized(width=...)`。
- 抠绿:`vfx.MaskColor(color=(0,255,0), threshold=100, stiffness=5)` 给 clip 生成 mask,使接近绿的像素透明。叠在 CompositeVideoClip 时绿背景被底层(商品图)透出。
- P2 已有:`digital_human/compose.py` 的 `TEMPLATES`(corner/bg/side 的 x/y/scale)、`build_presenter_edl`、`render_with_product`(走 EDL,不透明)。`jobs._run_pipeline` 在有商品+版式时调 `render_with_product`。`DhGenerateRequest.matte: bool`(P1 占位,默认 False)。preset.`is_greenscreen`(P1 已有)。
- 约束:抠像对**绿幕底素材**最佳;非绿幕底开抠像效果差(UI 注明)。matte 只在**有商品图**(有背景可贴)时有意义。

---

## 文件结构

- `video_generation/digital_human/compose.py`(改):加 `MATTE_GREEN` 常量 + `render_with_product_matte()`。
- `video_generation/digital_human/jobs.py`(改):`submit`/`_run_pipeline` 接 `matte: bool`,合成分支三选一。
- `api_server/digital_human_routes.py`(改):`generate` 透传 `matte=body.matte`。
- 前端:`packages/api/src/digitalHuman.ts`(改 generate opts 加 `matte`)、`GeneratePanel.tsx`(加「绿幕抠像」开关)。

测试:扩 `test_digital_human_compose.py`、`test_digital_human_jobs.py`、`test_digital_human_routes.py`。

---

## Task 1: compose 加 render_with_product_matte(绿幕抠像合成)

**Files:** `digital_human/compose.py`, test `test_digital_human_compose.py`

- [ ] **Step 1: 写测试**(moviepy 不可在本机跑,只验函数存在 + 常量;真合成留运行时)
```python
from chayuan.server.video_generation.digital_human import compose as dh_compose

def test_matte_api_present():
    assert hasattr(dh_compose, "render_with_product_matte")
    assert isinstance(dh_compose.MATTE_GREEN, tuple) and len(dh_compose.MATTE_GREEN) == 3
```

- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose.py -v`
Expected: FAIL(无 render_with_product_matte / MATTE_GREEN)

- [ ] **Step 3: 实现** — 在 `compose.py` 末尾加(所有 moviepy import 放函数内,模块仍可无 moviepy 导入):
```python
MATTE_GREEN = (0, 255, 0)  # 标准绿幕色;非绿底素材抠像效果有限(UI 注明)


def render_with_product_matte(*, presenter_path: str, product_path: str, template: str,
                              audio_path: str, out_path: str, width: int, height: int,
                              dur_ms: int, green=MATTE_GREEN, threshold: int = 100,
                              stiffness: int = 5) -> str:
    """绿幕抠像合成:presenter 抠掉绿背景 → 按版式叠在商品图全屏底上。
    直接走 moviepy(不经 render_from_edl),自包含。失败抛异常由 caller 兜底。
    """
    from moviepy import (  # noqa: WPS433 — 延迟到调用期,避免无 moviepy 时 import 失败
        AudioFileClip, CompositeVideoClip, ImageClip, VideoFileClip, vfx,
    )

    tpl = TEMPLATES.get(template) or TEMPLATES["corner"]
    dur_s = max(0.1, dur_ms / 1000.0)

    base = ImageClip(product_path).resized(new_size=(width, height)).with_duration(dur_s)
    presenter = VideoFileClip(presenter_path, audio=False)
    presenter = presenter.with_effects([
        vfx.MaskColor(color=list(green), threshold=threshold, stiffness=stiffness),
    ])
    pip_w = max(1, int(width * float(tpl["scale"])))
    presenter = presenter.resized(width=pip_w).with_position(
        (float(tpl["x"]), float(tpl["y"])), relative=True,
    )
    audio = AudioFileClip(audio_path)
    comp = CompositeVideoClip([base, presenter], size=(width, height)).with_duration(dur_s)
    comp = comp.with_audio(audio)
    try:
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac",
                             fps=25, threads=2, logger=None)
    finally:
        for c in (audio, presenter, base, comp):
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
    return out_path
```
> 核对:`vfx.MaskColor` 参数名(moviepy 2.x 为 `color/threshold/stiffness`);`resized(new_size=)` 与 `resized(width=)` 项目里都在用(compose.py 实证);`with_position(relative=True)`。`write_videofile(logger=None)` 静默。若 MaskColor 实际签名不符,按安装版本调整(运行时验)。

- [ ] **Step 4: 跑测试确认通过**(只验 API 存在,不触发 moviepy import)
Run: 同 Step 2。Expected: 之前 2 条 + 本条 passed

- [ ] **Step 5: py_compile + 提交**
```bash
python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/compose.py
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/compose.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose.py
git commit -m "feat(dh): 绿幕抠像合成 render_with_product_matte(presenter 抠绿叠商品背景)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: jobs 接 matte(抠像分支)

**Files:** `digital_human/jobs.py`, test `test_digital_human_jobs.py`

- [ ] **Step 1: 写失败测试**(stub matte 合成,验证 matte=True+商品 时走抠像)
```python
def test_job_pipeline_matte(monkeypatch, tmp_path):
    import uuid as _uuid
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", lambda t, p, a: (open(a, "wb").write(b"w"), a)[1])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda: _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    monkeypatch.setattr(dh_jobs, "resolve_product_path", lambda ref: str(tmp_path / "p.png"))
    (tmp_path / "p.png").write_bytes(b"x")
    monkeypatch.setattr(dh_jobs, "_probe_duration_ms", lambda p: 4000)
    seen = {"matte": 0, "plain": 0}
    def fake_matte(**kw):
        seen["matte"] += 1; open(kw["out_path"], "wb").write(b"m"); return kw["out_path"]
    def fake_plain(**kw):
        seen["plain"] += 1; open(kw["out_path"], "wb").write(b"p"); return kw["out_path"]
    monkeypatch.setattr(dh_jobs, "render_with_product_matte", fake_matte)
    monkeypatch.setattr(dh_jobs, "render_with_product", fake_plain)

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = _uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "hi", "width": 720, "height": 1280,
                             "product_ref": "product:p.png", "template": "bg", "matte": True}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "complete"
    assert seen["matte"] == 1 and seen["plain"] == 0  # 抠像走 matte 分支
```

- [ ] **Step 2: 跑测试确认失败**(render_with_product_matte 不是 dh_jobs 属性)

- [ ] **Step 3: 实现** — `jobs.py`:
import 行扩展:
```python
from chayuan.server.video_generation.digital_human.compose import render_with_product, render_with_product_matte
```
`submit` 加参数 `matte: bool = False`,写入 `_PENDING[tid]["matte"] = matte`。
`_run_pipeline` 商品分支里(`if product_ref and template != "none":` 内,算出 `dur_ms` 后),把单一的 `render_with_product(...)` 调用换成按 matte 二选一:
```python
            renderer = render_with_product_matte if args.get("matte") else render_with_product
            renderer(
                presenter_path=presenter_keep, product_path=product_path, template=template,
                audio_path=audio_path, out_path=final_path, width=args["width"], height=args["height"],
                dur_ms=dur_ms,
            )
```
(两个函数签名一致,直接换函数引用。)

- [ ] **Step 4: 跑测试确认通过**(全 jobs 测试:P1 success / missing / with_product(matte=False 走 plain)/ 本条 matte)
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -v`
> 注:P2 的 `test_job_pipeline_with_product` 没传 matte → `args.get("matte")` 为 None → 走 `render_with_product`(plain),仍过。

- [ ] **Step 5: py_compile + 提交**
```bash
python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): pipeline 接 matte — 绿幕抠像走 matte 合成分支

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 路由透传 matte + 前端开关

**Files:** `api_server/digital_human_routes.py`, `packages/api/src/digitalHuman.ts`, `GeneratePanel.tsx`, test `test_digital_human_routes.py`

- [ ] **Step 1: 写失败测试**(追加;验 matte 透传)
```python
def test_generate_passes_matte(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tidM")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "product_image": "product:p.png",
                     "template": "bg", "matte": True})
    assert r.status_code == 200 and seen.get("matte") is True
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现后端** — `digital_human_routes.py` 的 `generate` 加透传 `matte=body.matte`:
```python
    tid = dh_jobs.submit(preset_id=body.preset_id, text=body.text,
                         width=width, height=height,
                         product_ref=body.product_image, template=body.template,
                         matte=body.matte)
```
(`DhGenerateRequest.matte` P1 已有,默认 False。)

- [ ] **Step 4: 实现前端** — `digitalHuman.ts` 的 `dhGenerate` opts 加 `matte?: boolean`,放进 body:
```typescript
export async function dhGenerate(
  preset_id: string, text: string,
  opts?: { product_image?: string; template?: 'none' | 'corner' | 'bg' | 'side'; matte?: boolean; width?: number; height?: number },
): Promise<{ task_id: string }> {
  return rd<{ task_id: string }>('/api/v1/digital-human/generate', {
    method: 'POST',
    query: { width: opts?.width ?? 720, height: opts?.height ?? 1280 },
    body: { preset_id, text, product_image: opts?.product_image, template: opts?.template ?? 'none', matte: opts?.matte ?? false },
  });
}
```
`GeneratePanel.tsx`:在版式选择下方(仍 gated on `productRef`)加「绿幕抠像」复选/开关 state `matte`(默认 false),旁注小字「人像需绿幕底最佳」。`gen()` 改成传 `matte`:
```typescript
        productRef ? { product_image: productRef, template, matte } : undefined,
```

- [ ] **Step 5: 跑后端测试 + 前端 typecheck**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -v`(全 passed)
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|app) typecheck"`(两个 Done)

- [ ] **Step 6: py_compile + 提交**
```bash
python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py chayuan-client/packages/api/src/digitalHuman.ts chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx
git commit -m "feat(dh): generate 透传 matte + 生成面板绿幕抠像开关

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 全链路自检 + 推送

- [ ] **Step 1:** `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -q`(全 passed)
- [ ] **Step 2:** `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|transport|app) typecheck"`(三个 Done)
- [ ] **Step 3:** `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/*.py`
- [ ] **Step 4:** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(design §0.2 B + §6 P3):绿幕抠像 moviepy chromakey(T1)、matte 走独立合成分支(T2)、matte 透传+UI 开关(T3)。
- **占位扫描**:无 TBD。
- **类型一致**:`matte`(bool)全链路同名(schema/route/jobs/api/UI);`render_with_product_matte` 与 `render_with_product` 签名一致(jobs 直接换函数引用)。
- **风险**:① `vfx.MaskColor` 真实合成本机无 moviepy 跑不了 → 测试只验 API 存在 + jobs 分支选择(stub),**真抠像质量需用户环境验 + 调 threshold/stiffness**;② matte 仅在有商品图时有意义,无商品时 matte 被忽略(走 P1);③ 非绿底素材抠像差 —— UI 注明、MATTE_GREEN 注释说明;④ moviepy 2.x MaskColor 参数名若与安装版本不符,需运行时按版本微调(已在 compose 注释提示)。

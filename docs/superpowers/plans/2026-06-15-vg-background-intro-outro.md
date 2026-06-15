# VG 背景色 + 片头/片尾 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VG 可调背景色(人人可用,全局默认+项目覆盖)+ 付费会员可设片头/片尾(全局默认+项目覆盖,服务端门控),非付费沿用强制 video_end。

**Architecture:** 背景色作为 `VideoParams.background_color` 替换 compose 写死黑色 + 预览底色。片头/片尾走方案A(成片级 ffmpeg prepend/append,扩 outro.py),文件经新端点上传到用户目录;全局默认存 `vg_output_defaults.json`;渲染入口解析 effective(非付费置空 intro/outro)。

**Tech Stack:** Python+MoviePy/ffmpeg(后端);React+TS(前端)。后端 pytest 本机跑不了→ast 自检+单测真跑构建机;前端 tsc+vitest。root 仓:sudo 改 + bump-version + 只 stage 改动 + push main。

---

## 阶段 1:背景色(独立、人人可用)

### Task 1:后端背景色

**Files:** Modify `chayuan/server/video_generation/schemas.py`、`chayuan/server/video_generation/steps/compose.py`;Test `tests/unit_tests/test_vg_background.py`(新建)

- [ ] **Step 1: schema 加字段** —— `VideoParams` 加 `background_color: str = "#000000"`。
- [ ] **Step 2: 写失败测试**
```python
# tests/unit_tests/test_vg_background.py
from chayuan.server.video_generation.steps.compose import _bg_rgb
class P: pass
def test_bg_rgb_hex():
    p = P(); p.background_color = "#ff8800"
    assert _bg_rgb(p) == (255, 136, 0)
def test_bg_rgb_default_black():
    p = P(); p.background_color = "bad"
    assert _bg_rgb(p) == (0, 0, 0)
def test_bg_rgb_missing_attr():
    assert _bg_rgb(P()) == (0, 0, 0)
```
- [ ] **Step 3: 实现 `_bg_rgb`(compose.py,放近顶部 helper 区)**
```python
def _bg_rgb(params) -> tuple:
    """params.background_color (#rrggbb) -> (r,g,b);缺失/非法回退黑。"""
    s = str(getattr(params, "background_color", "") or "").strip().lstrip("#")
    if len(s) == 6:
        try:
            return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
        except ValueError:
            pass
    return (0, 0, 0)
```
- [ ] **Step 4: 替换三处写死黑色** —— `_render_main_segment`(`base = ColorClip(size=(W,H), color=(0,0,0))`)、片段间隙 gap(约 638 `black = ColorClip(... color=(0,0,0))`)、letterbox 合成(约 914 `background = ColorClip(... color=(0,0,0))`)。三处的 `color=(0, 0, 0)` 改 `color=_bg_rgb(params)`。
  - 注:`_render_main_segment` 当前签名 `(clip, item, W, H)` 无 params → 改为 `(clip, item, W, H, bg)`,调用处传 `_bg_rgb(params)`;item 已在主轨循环内,params 可达。
- [ ] **Step 5: 语法自检** —— `/usr/bin/python3.11 -c "import ast; ast.parse(open('.../compose.py').read(),'x'); ast.parse(open('.../test_vg_background.py').read(),'y'); print('OK')"`(真 pytest 构建机)。
- [ ] **Step 6: Commit**(bump + schema + compose + test + 5 bump 文件 + push)。

### Task 2:前端背景色

**Files:** Modify `packages/api/src/videoGeneration.ts`、输出设置 UI(`sections/BgmSection.tsx` 同级新增或 `BgmOutputStep`)、`timeline/PreviewPlayer.tsx`、`timeline/LivePreviewCanvas.tsx`、`VgTimelineEditorPage.tsx`

- [ ] **Step 1: 类型** —— `VgVideoParams` 加 `background_color: string;` + 默认 `background_color: '#000000'`(`DEFAULT_VG_PARAMS` 同处)。
- [ ] **Step 2: 背景色选择器** —— 在画幅设置处加 `<input type="color" value={params.background_color} onChange={e=>patch({background_color:e.target.value})}/>` + 几个预设块(黑/白/灰/品牌色)。
- [ ] **Step 3: 预览底色** —— `PreviewPlayer` 加 prop `backgroundColor: string` 透传 `LivePreviewCanvas`;canvas 外层 `bg-black` 改 `style={{ background: backgroundColor }}`(去掉 `bg-black` class)。`VgTimelineEditorPage` 传 `backgroundColor={params.background_color}`。
- [ ] **Step 4: typecheck** —— `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json` → 0;`packages/api` tsc → 0。
- [ ] **Step 5: Commit**。

---

## 阶段 2:全局默认 + 片头/片尾后端

### Task 3:全局默认存储 + 端点

**Files:** Create `chayuan/server/video_generation/steps/vg_output_defaults.py`;Modify `api_server/video_generation_routes.py`;Test `tests/unit_tests/test_vg_output_defaults.py`

- [ ] **Step 1: 失败测试**
```python
import json, os
from chayuan.server.video_generation.steps.vg_output_defaults import load_defaults, save_defaults
def test_defaults_roundtrip(tmp_path):
    root = str(tmp_path)
    assert load_defaults(root) == {"background_color": "#000000", "intro_clip": None, "outro_clip": None}
    save_defaults(root, {"background_color": "#112233", "intro_clip": "a.mp4", "outro_clip": None})
    assert load_defaults(root)["background_color"] == "#112233"
    assert load_defaults(root)["intro_clip"] == "a.mp4"
```
- [ ] **Step 2: 实现 vg_output_defaults.py**
```python
import json, os
_DEFAULT = {"background_color": "#000000", "intro_clip": None, "outro_clip": None}
def _path(root: str) -> str:
    return os.path.join(root, "data", "vg_output_defaults.json")
def load_defaults(root: str) -> dict:
    try:
        with open(_path(root), encoding="utf-8") as f:
            d = json.load(f)
        return {**_DEFAULT, **{k: d.get(k, _DEFAULT[k]) for k in _DEFAULT}}
    except Exception:
        return dict(_DEFAULT)
def save_defaults(root: str, d: dict) -> dict:
    cur = load_defaults(root)
    for k in _DEFAULT:
        if k in d:
            cur[k] = d[k]
    p = _path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return cur
```
- [ ] **Step 3: 端点** —— `video_generation_routes.py` 加 `GET /output-defaults`(返 load_defaults(root))与 `PUT /output-defaults`(body {background_color?,intro_clip?,outro_clip?} → save_defaults)。root 取法同文件内其它端点(`get_chayuan_root()` / 现有依赖,照抄邻近端点拿 root 的写法)。
- [ ] **Step 4: 语法自检 + Commit**。

### Task 4:片头/片尾上传/列举/流式端点

**Files:** Modify `chayuan/server/video_generation/_helpers.py`(加 `intro_outro_dir`)、`api_server/video_generation_routes.py`

- [ ] **Step 1: 目录 helper** —— `_helpers.py` 仿 `song_dir` 加 `def intro_outro_dir() -> str:`(`<root>/data/video_generation/intro_outro/`,mkdir),返回路径。
- [ ] **Step 2: 端点(仿 /bgm)**:
  - `POST /intro-outro`(`UploadFile`,校验 ext ∈ mp4/mov/webm/jpg/jpeg/png/webp;存 intro_outro_dir;返 {name,path,size})。
  - `GET /intro-outro`(列 intro_outro_dir 文件 → {items:[{name,path,kind}]},kind 按 ext 判 video/image)。
  - `GET /intro-outro/{name}/file`(流式,仿 serve_bgm_file)。
- [ ] **Step 3: 语法自检 + Commit**。

### Task 5:schema 字段 + outro.py 扩展 + 渲染门控

**Files:** Modify `schemas.py`、`steps/outro.py`、`runner.py`(`_persist_vg_videos`)、`digital_human/jobs.py`(`_set`);Test `tests/unit_tests/test_intro_outro_gating.py`

- [ ] **Step 1: schema** —— `VideoParams` 加 `intro_clip: Optional[str] = None`、`outro_clip: Optional[str] = None`。
- [ ] **Step 2: 失败测试(effective 解析 + 门控)**
```python
from chayuan.server.video_generation.steps.outro import resolve_intro_outro
def test_paid_uses_clips():
    eff = resolve_intro_outro(params_intro="p.mp4", params_outro=None,
                              global_intro="g.mp4", global_outro="go.mp4", paid=True)
    assert eff == ("p.mp4", "go.mp4")  # 项目优先,缺则全局
def test_nonpaid_blocks():
    eff = resolve_intro_outro(params_intro="p.mp4", params_outro="o.mp4",
                              global_intro="g.mp4", global_outro="go.mp4", paid=False)
    assert eff == (None, None)
```
- [ ] **Step 3: outro.py 加 `resolve_intro_outro` + 拼接函数**
```python
def resolve_intro_outro(*, params_intro, params_outro, global_intro, global_outro, paid):
    if not paid:
        return (None, None)
    return (params_intro or global_intro or None, params_outro or global_outro or None)
```
  + `maybe_prepend_intro(main_path, intro_path, work_dir, *, bg=(0,0,0), threads=2)` 和 `append_user_outro(main_path, outro_path, work_dir, *, bg=(0,0,0), threads=2)`:复用现有 `_probe`/`_build_cmd` 的缩放补边逻辑,把补边色参数化为 `bg`(现 `_build_cmd` 若写死 black 边则加 `pad=...:color=` 用 bg 的 hex);幂等标记 `.intro.done` / `.useroutro.done`;图片输入用 `-loop 1 -t 3`(默认 3s)。位置 head=intro 在前 concat,tail=outro 在后。失败 warning 返回原。
- [ ] **Step 4: 渲染入口接线(runner `_persist_vg_videos` + DH `jobs._set`)**:
  - 取 `paid = is_paid_member(root, cfg, ["video","video_edit"])`(沿用 outro 现有取法)。
  - `g = load_defaults(root)`;`intro, outro = resolve_intro_outro(params_intro=getattr(params,"intro_clip",None), params_outro=getattr(params,"outro_clip",None), global_intro=g["intro_clip"], global_outro=g["outro_clip"], paid=paid)`。
  - 解析文件全路径(intro_outro_dir 下 name)。`bg=_bg_rgb(params)`(从 compose import,或复制小函数到 outro)。
  - 顺序:`if intro: main=maybe_prepend_intro(main, intro_path, wd, bg=bg)`;`if paid and outro: main=append_user_outro(main, outro_path, wd, bg=bg)`;`maybe_append_outro(main, wd)`(内部对付费跳过 video_end,不变)。
- [ ] **Step 5: 语法自检 + Commit**。

---

## 阶段 3:前端片头/片尾 UI + 门控

### Task 6:前端 API

**Files:** Modify `packages/api/src/videoGeneration.ts`

- [ ] **Step 1:** `VgVideoParams` 加 `intro_clip?: string | null; outro_clip?: string | null;`。
- [ ] **Step 2:** 加 `uploadIntroOutro(file)`、`listIntroOutro()`(返 {items:[{name,path,kind}]})、`introOutroFileUrl(name)`、`getVgOutputDefaults()`、`setVgOutputDefaults(d)`(对接 Task3/4 端点)。
- [ ] **Step 3:** typecheck `packages/api` → 0;Commit。

### Task 7:前端 UI + 付费门控

**Files:** Create `packages/app/src/features/video-generation/sections/OutputFramingSection.tsx`;Modify `VgComposerToolbar.tsx`(挂入展开区)

- [ ] **Step 1: 付费态读取** —— 复用 license store 判定付费(对应后端 is_paid_member:时间制有效或 counts>0,**不可用含每日免费的 licensed**;查 license store 现有字段,取等价判定)。`const paid = ...`。
- [ ] **Step 2: OutputFramingSection 组件** —— 背景色(已在 Task2,可整合到此处)+ 片头选择器 + 片尾选择器(已上传列表下拉 + 上传按钮 + 清除);非付费时片头/片尾整组 `disabled + opacity-50`,旁注「会员可用」+ 点击走升级入口;顶部「设为默认(记住)」按钮调 `setVgOutputDefaults({background_color,intro_clip,outro_clip})`;项目值空=跟随全局默认(UI 标注)。
- [ ] **Step 3: 挂入** —— `VgComposerToolbar` 的 `Panel` 加一项(图标 + 展开 OutputFramingSection),或并入现有输出设置展开区。
- [ ] **Step 4: typecheck + 手动** —— tsc 0;非付费置灰、付费可设+设为默认持久、背景色实时预览。Commit。

---

## 自审
- 背景色:Task1(后端三处+_bg_rgb)+Task2(类型+选择器+预览底色)全覆盖;人人可用,无门控。
- 全局默认+项目覆盖:Task3 存储+端点、Task5 resolve_intro_outro(项目优先缺则全局)、Task6/7 前端读写。
- 付费门控:resolve_intro_outro paid=False→(None,None)(Task5 服务端强制);前端 Task7 仅 UX 置灰。video_end 现状不动(maybe_append_outro 内部跳过付费)。
- 顺序:intro prepend → user outro(付费)→ maybe_append_outro(非付费才 video_end)。Task5 Step4 明确。
- 类型一致:resolve_intro_outro 关键字参数命名 Task5 内自洽;_render_main_segment 新增 bg 参数 Task1 Step4 同步调用处。
- ⚠ 后端 pytest 本机跑不了:全部后端任务 ast 自检 + 单测真跑构建机;真机成片验在重建后。

# 音色克隆 P2 + P3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 补齐音色克隆 design 的 P2(重命名 + 样本质量校验)与 P3(CosyVoice2 零样本高质量 clone + 跨语种,可验证骨架)。P1 已交付 list/create(ffmpeg 24k 转码)/delete/浏览器录音。

**Architecture:** 后端克隆样本存 `<root>/video_generation/storage/voice_clones/<cid>.{wav,json}`(json={name,ref_text,created})。P2 加 rename 端点 + create 时探时长给质量提示。P3 给 `cosyvoice_server` 加零样本 clone 路由(`inference_zero_shot`/`inference_cross_lingual`),clone 合成可选 voxcpm(默认,in-proc)或 cosyvoice(sidecar 高质量),json 存 `engine` 字段。

**Tech Stack:** FastAPI/`video_generation_routes.py`/`cosyvoice_server.py`(`_runtime_server_base`)/`steps/audio.py` AudioPipeline;前端 `VoicePicker.tsx` + `packages/api/videoGeneration.ts`。承接音色克隆 P1。

---

## ⚠ 本机不可验证边界

- ✅ 可验:rename 端点、质量探测逻辑(stub ffprobe/media_probe)、cosyvoice clone 路由形状 + import 干净、audio pipeline 路由分支、前端 typecheck。
- ❌ 只能用户环境验(标 `[VERIFY]`):VoxCPM/CosyVoice2 真零样本合成音质、cosyvoice sidecar `inference_zero_shot`/`inference_cross_lingual` 真输出、跨语种实际效果。CosyVoice2 模型需 ModelScope 下载(`iic/CosyVoice2-0.5B`)。

---

## 文件结构

- `api_server/video_generation_routes.py`(改):`PATCH /voices/clone/{cid}` rename;`create_clone_voice` 加质量探测返 `quality`;create 接 `engine` 表单存 json。
- `cosyvoice_server.py`(改):加 `/v1/audio/clone`(zero_shot + cross_lingual)。
- `steps/audio.py`(改):`cosyvoice:` clone 路由分支(转发 sidecar)。
- `packages/api/src/videoGeneration.ts`(改):`renameCloneVoice` + uploadClone 加 `engine`。
- `packages/app/.../VoicePicker.tsx`(改):重命名按钮 + 质量提示 + 高质量(CosyVoice2)开关。

测试:扩 `tests/unit_tests/test_vg_voice_clone.py`(无则建);`test_cosyvoice_clone.py`(建)。

---

## Task 1: 后端克隆音色重命名端点

**Files:** `api_server/video_generation_routes.py`,test `tests/unit_tests/test_vg_voice_clone.py`(建/扩)

> READ `video_generation_routes.py:1076-1162`(已在 context):`_list_clone_voices`、`create_clone_voice`、`delete_clone_voice`;json 是 `{name, ref_text, created}`;`voice_clones_dir(create=)` from `_helpers`;auth=`Depends(require_auth_enabled())`;`HTTPException(code, msg)` 位置参风格;路径参 `FPath`。READ 现有 `tests/unit_tests/` 里克隆相关测试的 client fixture(若无则仿 `test_digital_human_routes.py` 的 `_client`)。

- [ ] **Step 1: 写失败测试**
```python
def test_rename_clone_voice(monkeypatch, tmp_path):
    import json, os
    from chayuan.server.video_generation import _helpers
    d = str(tmp_path / "voice_clones"); os.makedirs(d, exist_ok=True)
    monkeypatch.setattr(_helpers, "voice_clones_dir", lambda *, create=False: d)
    open(os.path.join(d, "abc.wav"), "wb").close()
    json.dump({"name": "旧名", "created": 1.0}, open(os.path.join(d, "abc.json"), "w"))
    c = _client(monkeypatch, tmp_path)
    r = c.patch("/api/v1/video-generation/voices/clone/abc", json={"name": "新名"})
    assert r.status_code == 200 and r.json()["label"] == "新名"
    assert json.load(open(os.path.join(d, "abc.json")))["name"] == "新名"
```

- [ ] **Step 2: 跑确认失败**
`PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py -k rename -v`

- [ ] **Step 3: 实现**(加在 `delete_clone_voice` 后)
```python
@video_generation_router.patch(
    "/voices/clone/{cid}", summary="重命名克隆音色",
)
def rename_clone_voice(
    cid: str = FPath(..., max_length=64),
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    import json as _json
    from chayuan.server.video_generation._helpers import voice_clones_dir
    name = str((body or {}).get("name", "")).strip()
    if not name:
        raise HTTPException(422, "name 不能为空")
    if len(name) > 40:
        raise HTTPException(422, "name 过长(<=40)")
    d = voice_clones_dir(create=False)
    base = os.path.basename(cid)
    jp = os.path.join(d, f"{base}.json")
    if not os.path.isfile(os.path.join(d, f"{base}.wav")):
        raise HTTPException(404, "克隆音色不存在")
    meta: Dict[str, Any] = {}
    if os.path.isfile(jp):
        try:
            with open(jp, "r", encoding="utf-8") as f:
                meta = _json.load(f) or {}
        except Exception:  # noqa: BLE001
            meta = {}
    meta["name"] = name
    with open(jp, "w", encoding="utf-8") as f:
        _json.dump(meta, f, ensure_ascii=False)
    return {"id": base, "name": f"clone:{base}", "label": name}
```
确保 `Body` 已 import(文件顶部 fastapi import — 若没有则加)。

- [ ] **Step 4: 跑通 + py_compile**
`PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py -k rename -v`
`python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py
git commit -m "feat(voice-clone): PATCH /voices/clone/{cid} 重命名端点(P2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: create 时样本质量探测

**Files:** `api_server/video_generation_routes.py`,test `test_vg_voice_clone.py`

> 目标:转码出 wav 后探时长,给 `quality={duration, warnings[]}`。warnings 规则:时长 <2s「样本过短,建议 3-10s」、>30s「样本过长,建议截取 3-10s 干净人声」。探时长用 `imageio_ffmpeg` 的 ffprobe-less 方式:复用已 import 的 `subprocess`+`ffmpeg -i` stderr 解析容易脆,改用 wave 模块读 wav 帧数/采样率算时长(转码后是标准 24k mono wav,wave 可读)。

- [ ] **Step 1: 写测试**(纯函数更好测 → 抽 `_probe_wav_duration` + `_quality_warnings`)
```python
def test_quality_warnings_short_and_long():
    from chayuan.server.api_server.video_generation_routes import _quality_warnings
    assert any("过短" in w for w in _quality_warnings(1.0))
    assert any("过长" in w for w in _quality_warnings(45.0))
    assert _quality_warnings(5.0) == []

def test_probe_wav_duration(tmp_path):
    import wave, os
    from chayuan.server.api_server.video_generation_routes import _probe_wav_duration
    p = os.path.join(str(tmp_path), "t.wav")
    w = wave.open(p, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
    w.writeframes(b"\x00\x00" * 24000 * 3); w.close()  # 3s
    assert abs(_probe_wav_duration(p) - 3.0) < 0.1
```

- [ ] **Step 2: 跑确认失败**
`PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py -k "quality or probe" -v`

- [ ] **Step 3: 实现**
加模块级 helper(放近 `_list_clone_voices`):
```python
def _probe_wav_duration(wav_path: str) -> float:
    """读标准 wav 算时长(秒)。非 wav/读失败返 0。"""
    import wave
    try:
        with wave.open(wav_path, "rb") as w:
            fr = w.getframerate() or 0
            return (w.getnframes() / fr) if fr else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


def _quality_warnings(duration: float) -> List[str]:
    out: List[str] = []
    if duration and duration < 2.0:
        out.append("样本过短,建议 3-10s 干净人声")
    if duration and duration > 30.0:
        out.append("样本过长,建议截取 3-10s 干净人声")
    return out
```
在 `create_clone_voice` 的 `return {...}` 前加:
```python
    dur = _probe_wav_duration(wav_path)
    quality = {"duration": round(dur, 2), "warnings": _quality_warnings(dur)}
```
并把返回改成 `return {"id": cid, "name": f"clone:{cid}", "label": name.strip(), "quality": quality}`。

- [ ] **Step 4: 跑通 + py_compile**
`PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py -v`
`python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py
git commit -m "feat(voice-clone): 样本质量探测(时长+过短/过长提示)(P2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 前端重命名 + 质量提示

**Files:** `packages/api/src/videoGeneration.ts`,`packages/app/src/features/video-generation/VoicePicker.tsx`

> READ `videoGeneration.ts:724-748`(uploadCloneVoice/deleteCloneVoice + 聚合对象 ~916)与 `VoicePicker.tsx`(clone 区:`uploadCloneVoice` 调用 ~163、删除 ~208、录音、`startsWith('clone:')`、用 lucide `Mic`/`Square`/`Loader2`、`reportError`/toast)。匹配既有 request helper(`rd`/`request`)与按钮 className。

- [ ] **Step 1: api 加 renameCloneVoice**
```typescript
/** 重命名克隆音色。cid = voice_name 去掉 'clone:' 前缀。 */
export async function vgRenameCloneVoice(cid: string, name: string): Promise<{ id: string; name: string; label: string }> {
  return request(`/api/v1/video-generation/voices/clone/${encodeURIComponent(cid)}`, { method: 'PATCH', body: { name } });
}
```
(匹配 deleteCloneVoice 的 request 写法)+ 聚合对象加 `renameCloneVoice: vgRenameCloneVoice`。`uploadCloneVoice` 返回类型加可选 `quality?: { duration: number; warnings: string[] }`。

- [ ] **Step 2: VoicePicker 重命名按钮**
在删除按钮旁(`value.voice_name.startsWith('clone:')` gated 区)加「重命名」按钮:用 `promptDialog`(项目既有,见 [[feedback_tauri_no_window_prompt]],from `'../../store/promptDialog'`)取新名 → `videoGeneration.renameCloneVoice(cid, newName)` → `qc.invalidateQueries({queryKey:['vg.voices','clone']})`。样式同删除按钮。

- [ ] **Step 3: 上传后质量提示**
`uploadCloneVoice` 返回的 `r.quality?.warnings` 非空时,用文件既有提示渠道(toast/reportError 信息态;若只有 reportError 则用一个轻量 `window.alert` 替代不可——用 `promptDialog` 同源的提示或现有 toast)。简单做法:warnings 非空时 `reportError(new Error(r.quality.warnings.join('；')), '样本质量提示')`(复用既有错误弹窗当提示;若文件有 toast util 优先 toast)。

- [ ] **Step 4: typecheck**
`cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"`(空)
`cd chayuan-client/packages/api && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS"`(空)

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/api/src/videoGeneration.ts chayuan-client/packages/app/src/features/video-generation/VoicePicker.tsx
git commit -m "feat(voice-clone): 克隆音色重命名 + 上传样本质量提示(P2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: cosyvoice_server 零样本 clone 路由(P3·[VERIFY])

**Files:** `modality/cosyvoice_server.py`,test `tests/unit_tests/test_cosyvoice_clone.py`(建)

> READ `cosyvoice_server.py` 全文:现有 `_register_routes(app, cfg)` + `_ensure_loaded()` + `/v1/audio/speech`(`inference_sft(text, voice)`)+ `make_runtime_app`/`serve`/`parse_serve_args` 用法。CosyVoice2 模型有 `inference_zero_shot(tts_text, prompt_text, prompt_speech_16k)` 与 `inference_cross_lingual(tts_text, prompt_speech_16k)`。模型/torchaudio 全 lazy import。

- [ ] **Step 1: 写测试(import 干净)**
```python
def test_cosyvoice_server_has_clone_route():
    import importlib
    m = importlib.import_module("chayuan.server.modality.cosyvoice_server")
    assert hasattr(m, "_register_routes") and hasattr(m, "main")
```

- [ ] **Step 2: 跑确认失败/通过**
`PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_cosyvoice_clone.py -v`

- [ ] **Step 3: 实现 `/v1/audio/clone`**(加进 `_register_routes`,仿 `/v1/audio/speech` 流式返回)
```python
    @app.post("/v1/audio/clone")
    async def clone(request: Request) -> StreamingResponse:
        """零样本 clone:prompt_wav(参考人声)+ text → 合成。
        cross_lingual=True 时走跨语种(prompt 与目标语言不同)。
        [VERIFY] 真合成需 CosyVoice2 模型 + torchaudio,用户环境验。"""
        import io
        payload = await request.json()
        text = (payload.get("text") or "").strip()
        prompt_wav = payload.get("prompt_wav") or ""   # 服务端可达的 wav 路径
        prompt_text = (payload.get("prompt_text") or "").strip()
        cross_lingual = bool(payload.get("cross_lingual", False))
        if not text or not prompt_wav:
            raise HTTPException(status_code=400, detail="text/prompt_wav 必填")
        handle = _ensure_loaded()
        try:
            import torchaudio  # type: ignore
            prompt_16k = handle.load_wav(prompt_wav, 16000) if hasattr(handle, "load_wav") else None
            if prompt_16k is None:
                wav, sr = torchaudio.load(prompt_wav)
                prompt_16k = torchaudio.transforms.Resample(sr, 16000)(wav)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"prompt 加载失败(torchaudio?): {e}") from e

        def _gen():
            import torch  # type: ignore
            if cross_lingual:
                it = handle.inference_cross_lingual(text, prompt_16k)
            else:
                it = handle.inference_zero_shot(text, prompt_text, prompt_16k)
            for out in it:
                tensor = out["tts_speech"] if isinstance(out, dict) else out
                buf = io.BytesIO()
                import torchaudio  # type: ignore
                torchaudio.save(buf, tensor, 24000, format="wav")
                yield buf.getvalue()

        return StreamingResponse(_gen(), media_type="audio/wav")
```
> `Request`/`StreamingResponse`/`HTTPException` 若 `/v1/audio/speech` 已 import 则复用;否则在函数内或顶部按其风格 import。CosyVoice handle 的真实方法名/返回 dict 键(`tts_speech`)以模型实际为准 —— **标 [VERIFY],用户环境对齐**。

- [ ] **Step 4: 跑测试 + py_compile**
`PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_cosyvoice_clone.py -v`
`python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/modality/cosyvoice_server.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/modality/cosyvoice_server.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_cosyvoice_clone.py
git commit -m "feat(voice-clone): cosyvoice_server 零样本 clone + 跨语种路由(P3 骨架)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: AudioPipeline cosyvoice clone 路由 + create 接 engine

**Files:** `video_generation/steps/audio.py`,`api_server/video_generation_routes.py`,test `test_vg_voice_clone.py`

> READ `steps/audio.py`:`_synthesize_via_voxcpm` / `voxcpm:` 路由 / clone 分支;cosyvoice sidecar 端口 18280(CLAUDE.md)。目标:支持 `cosyvoice-clone:<wav>` 路由(转发 sidecar `/v1/audio/clone`,httpx);clone 样本 json 存 `engine`(voxcpm|cosyvoice),jobs/合成按 engine 选路由。本 task 最小化:create 端点接 `engine` 表单存 json + audio.py 加 `cosyvoice-clone:` 分支(httpx 转发,sidecar 未起则回退 voxcpm 或报错)。

- [ ] **Step 1: 写测试**(create 存 engine)
```python
def test_create_clone_stores_engine(monkeypatch, tmp_path):
    import os, json
    from chayuan.server.video_generation import _helpers
    d = str(tmp_path / "vc"); os.makedirs(d, exist_ok=True)
    monkeypatch.setattr(_helpers, "voice_clones_dir", lambda *, create=False: d)
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/video-generation/voices/clone",
               files={"file": ("a.wav", b"RIFF0000WAVE", "audio/wav")},
               data={"name": "测试", "engine": "cosyvoice"})
    assert r.status_code == 201
    cid = r.json()["id"]
    meta = json.load(open(os.path.join(d, f"{cid}.json")))
    assert meta.get("engine") == "cosyvoice"
```
> 若 monkeypatch voice_clones_dir 在 routes 内部是局部 import,需 patch `_helpers.voice_clones_dir`(create_clone_voice 里 `from ..._helpers import voice_clones_dir` 是函数内 import,patch 源模块属性即可生效)。

- [ ] **Step 2: 跑确认失败**

- [ ] **Step 3: 实现**
(a) `create_clone_voice` 签名加 `engine: str = Form("voxcpm")`;json dump 加 `"engine": engine if engine in ("voxcpm", "cosyvoice") else "voxcpm"`。
(b) `steps/audio.py` 加 `cosyvoice-clone:` 路由分支(在 voxcpm 分支旁):
```python
        if voice.startswith("cosyvoice-clone:"):
            wav = voice[len("cosyvoice-clone:"):]
            audio = self._synthesize_via_cosyvoice_clone(text, wav)
            if audio:
                return audio
            # sidecar 不可用 → 回退 voxcpm(同样本)
            voice = f"voxcpm:{wav}"
```
加方法:
```python
    def _synthesize_via_cosyvoice_clone(self, text: str, prompt_wav: str) -> bytes:
        """转发 cosyvoice sidecar /v1/audio/clone。失败返 b''(调用方回退)。"""
        import httpx
        try:
            with httpx.Client(timeout=60) as client:
                r = client.post("http://127.0.0.1:18280/v1/audio/clone",
                                json={"text": text, "prompt_wav": prompt_wav})
                if r.status_code == 200:
                    return r.content
        except Exception:  # noqa: BLE001
            pass
        return b""
```
(c) jobs/合成选路由:`digital_human/jobs.py` 现 `voice = f"voxcpm:{wav}"`,改成读 json engine:
```python
    if preset.voice_provider == "clone" and voice.startswith("clone:"):
        cid = voice[len("clone:"):]
        wav = os.path.join(_helpers.voice_clones_dir(), f"{cid}.wav")
        engine = "voxcpm"
        try:
            import json as _json
            meta = _json.load(open(os.path.join(_helpers.voice_clones_dir(), f"{cid}.json")))
            engine = meta.get("engine") or "voxcpm"
        except Exception:  # noqa: BLE001
            pass
        voice = f"cosyvoice-clone:{wav}" if engine == "cosyvoice" else f"voxcpm:{wav}"
```
> READ jobs.py:42-48 确认变量/import 上下文再改。

- [ ] **Step 4: 跑通 + py_compile**
`PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py -v`
`python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/audio.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/audio.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py
git commit -m "feat(voice-clone): clone 样本带 engine + cosyvoice-clone 合成路由(P3 骨架)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 前端高质量(CosyVoice2)开关

**Files:** `packages/api/src/videoGeneration.ts`,`packages/app/.../VoicePicker.tsx`

- [ ] **Step 1:** `uploadCloneVoice` 参数加可选 `engine?: 'voxcpm' | 'cosyvoice'`,FormData append `engine`(默认不传=后端默认 voxcpm)。
- [ ] **Step 2:** VoicePicker clone 区上传前加一个小开关/chip「高质量(CosyVoice2)」,state `cloneEngine` 默认 `'voxcpm'`,上传时传 `engine: cloneEngine`。开关旁注「需 CosyVoice 运行时」。样式同既有 chip。
- [ ] **Step 3: typecheck**
`cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"`(空)
- [ ] **Step 4: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/api/src/videoGeneration.ts chayuan-client/packages/app/src/features/video-generation/VoicePicker.tsx
git commit -m "feat(voice-clone): 克隆上传可选高质量 CosyVoice2 引擎(P3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 自检 + 推送

- [ ] `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_voice_clone.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_cosyvoice_clone.py -q`(全 pass)
- [ ] `cd chayuan-client/packages/app && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" | grep -v "features/license"`(空)
- [ ] `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(design 1.4):P2 重命名(T1)+ 样本质量校验(T2/T3 提示);浏览器录音/删除 P1 已交付。P3 CosyVoice2 高质量(T4 sidecar clone 路由 + T5 路由 + T6 开关)+ 跨语种(T4 `cross_lingual` 参数,UI 暂走默认 zero-shot,跨语种留后端能力)。
- **真复用**:P2 重命名用既有 `promptDialog`;质量提示用既有错误弹窗渠道;P3 复用既有 cosyvoice sidecar + httpx 转发 pattern(同 SadTalker/MuseTalk)。
- **占位扫描**:无 TBD。`[VERIFY]` 标的是真合成需模型,非 plan 占位。
- **类型一致**:`renameCloneVoice(cid, name)`;`uploadCloneVoice` 返 `quality?`;`engine: 'voxcpm'|'cosyvoice'`;clone 路由前缀 `cosyvoice-clone:` vs `voxcpm:` 一致。
- **不回归**:engine 缺省 voxcpm(P1 行为不变);cosyvoice sidecar 未起 → 回退 voxcpm;rename 不动 wav。
- **风险/[VERIFY]**:① CosyVoice handle 真实方法名/返回键(`inference_zero_shot`/`tts_speech`)需用户模型对齐 ② CosyVoice2 模型 ModelScope 下载 + sidecar 起 ③ 跨语种实际质量 ④ 24k vs 16k 采样率对齐 —— 用户环境验。

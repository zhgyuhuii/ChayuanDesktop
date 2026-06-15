# 语音合成对话模式整合 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans。Steps 用 `- [ ]`。

**Goal:** 让 chat 的「语音合成」模式同时支持厂商 TTS 模型与本地引擎(piper/edge/sherpa/clone),参数条复用 VG 的 VoicePicker + 语速/音量/语言。

**Architecture:** 本地引擎用伪模型 `local-tts:<engine>`。后端 classify→tts + 新 (TTS,"local") 连接器调 tts.synthesize→save_bytes→file_part;前端 transport 把 local-tts:* 归为 tts,TtsVoiceParamBar 升级成统一引擎下拉(厂商真模型+4 本地伪条目)+ 本地复用 VoicePicker。

**Tech Stack:** Python/FastAPI(modality router connectors)+ React/TS(transport/app)。root-owned 用 sudo 编辑;每 commit bump 版本;本机 py3.6 仅 ast 自检。

---

## File Structure
- Modify `modality/router/protocol.py` — _PREFIX_TO_CAP 加 local-tts:→TTS;_PREFIX_TO_VENDOR 加 local-tts:→"local"。
- Create `modality/router/connectors/tts/local.py` — (TTS,"local") 连接器调 tts.synthesize。
- Modify `modality/router/connectors/tts/__init__.py` — import local。
- Modify `packages/transport/src/...`(classifyModalityCapability)— local-tts:*→'tts'。
- Modify `packages/app/src/features/composer/TtsVoiceParamBar.tsx` — 统一引擎下拉 + 本地复用 VoicePicker + 语速/音量/语言。
- (按需)Modify ChatComposer/ConversationView — 引擎下拉切换选中模型 id。

## Task 1(P1 后端):classify + 本地连接器
- [ ] Step1: protocol.py `_PREFIX_TO_CAP` 顶部加 `("local-tts:", Capability.TTS),`;`_PREFIX_TO_VENDOR` 顶部加 `("local-tts:", "local"),`。
- [ ] Step2: 新建 connectors/tts/local.py:
```python
import os, tempfile
from typing import AsyncIterator, Dict
from chayuan.server.modality.router.artifacts import save_bytes
from chayuan.server.modality.router.connectors.base import Connector, register
from chayuan.server.modality.router.protocol import Capability, GenerateReq
from chayuan.server.modality.router.sse_v5 import (
    text_start, text_delta, text_end, data_part, file_part, error_event,
)

_VALID = {"piper", "edge", "sherpa", "clone"}

@register(Capability.TTS, "local")
class LocalTTSConnector(Connector):
    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        text = (req.prompt or "").strip()
        if not text:
            yield error_event("TTS 需要输入要朗读的文本", code="empty_text"); return
        engine = (req.model or "").split(":", 1)[1].lower() if ":" in (req.model or "") else "piper"
        if engine not in _VALID:
            engine = "piper"
        p = req.params or {}
        voice_name = p.get("voice_name") or None
        try:
            rate = float(p.get("voice_rate", 1.0))
        except (TypeError, ValueError):
            rate = 1.0
        try:
            volume = float(p.get("voice_volume", 1.0))
        except (TypeError, ValueError):
            volume = 1.0
        tid = "tts"
        yield text_start(tid)
        yield text_delta(tid, f"本地合成中(引擎={engine}, 音色={voice_name or '默认'})…")
        yield text_end(tid)
        yield data_part("task-progress", {"percent": 10, "message": "提交本地合成"})
        from chayuan.server.video_generation.steps.tts import synthesize
        tmp = os.path.join(tempfile.gettempdir(), f"modality_tts_{os.getpid()}_{abs(hash(text)) % 100000}.wav")
        try:
            result = synthesize(text, tmp, voice_provider=engine, voice_name=voice_name,
                                voice_rate=rate, voice_volume=volume)
        except Exception as e:  # noqa: BLE001
            yield error_event(f"本地 TTS 失败:{e}", code="local_tts_error"); return
        if not result or not os.path.isfile(result.audio_file):
            yield error_event("本地 TTS 未产出音频", code="empty_audio"); return
        yield data_part("task-progress", {"percent": 90, "message": "保存音频"})
        with open(result.audio_file, "rb") as f:
            audio = f.read()
        saved = save_bytes(audio, "audio/wav", ext="wav")
        yield file_part(saved["url"], "audio/wav", {"engine": engine, "voice": voice_name,
                                                     "duration_ms": result.duration_ms, "model": req.model})
        yield data_part("task-progress", {"percent": 100, "message": "完成"})
        try:
            os.remove(tmp)
        except OSError:
            pass
```
(注:file_part / save_bytes 的确切签名按 openai_compat.py 现用法对齐 —— 实现时打开该文件复制同款调用,save_bytes 返回对象/字典字段以现网为准。)
- [ ] Step3: __init__.py 加 `from chayuan.server.modality.router.connectors.tts import local  # noqa: F401`。
- [ ] Step4: `python3 -c "import ast; ast.parse(open('connectors/tts/local.py').read())"`(去 future 行)+ 真机 pytest 待用户。
- [ ] Step5: commit(bump)。

## Task 2(P2 前端):transport + 参数条
- [ ] Step1: transport classifyModalityCapability:model 以 `local-tts:` 开头 → 'tts'。
- [ ] Step2: TtsVoiceParamBar 升级:
  - 顶部「合成引擎」select:厂商组(models.list 过滤 capability 含 tts,value=真 id)+ 本地组(local-tts:piper/edge/sherpa/clone)。onChange → 设 composer 选中模型。
  - 选中为 local-tts:* → 渲染 `<VoicePicker value={{voice_provider:engine, voice_name}} onChange language=.../>` + 语速滑条 + 音量滑条 + 语言下拉;写 modalityParams {voice_provider,voice_name,voice_rate,voice_volume,language}。
  - 选中为厂商 → 沿用现有 vendor 音色下拉 + 语速(+格式);写 {voice,speed,format}。
- [ ] Step3: 抽纯函数 buildEngineOptions(models)+ parseLocalTtsEngine(id) + vitest。
- [ ] Step4: `cd packages/app && npx tsc --noEmit -p tsconfig.json` EXIT=0。
- [ ] Step5: commit(bump)。

## Task 3(P3 联调)
- [ ] Step1: 本地引擎试听走 VoicePicker 内置(audio/preview);确认厂商路径未回归。
- [ ] Step2: typecheck + vitest 全绿。
- [ ] Step3: commit + push;提醒真机重建 desktop + 重启 sidecar 验本地引擎合成与厂商合成两路。

## Self-Review
- 覆盖:伪模型(T1)、后端打通(T1)、统一下拉(T2)、本地复用 VoicePicker+语速/音量/语言(T2)、厂商沿用(T2)、试听(T3)。
- 风险:厂商 TTS 模型 capability=tts 标记 P2 确认;save_bytes/file_part 签名以 openai_compat.py 现用法为准(实现时复制);py3.6 仅 ast。

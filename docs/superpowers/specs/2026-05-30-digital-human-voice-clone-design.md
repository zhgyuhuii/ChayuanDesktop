# 数字人 + 音色克隆 技术方案与详细需求说明

> 状态:设计稿(brainstorming 阶段产物)。落地前需用户逐节确认 + 选型决策。
> 约束总纲:full 版**完全自包含**(装完零下载,任何环境一次跑通);模型链接进代码前**实测**
> (国内 ModelScope 可达 / HF 不可达 / hf-mirror 可达);frozen(PyInstaller)打包坑多。

---

## 0. 背景与现状盘点

| 能力 | 现状 | 结论 |
|---|---|---|
| 语音克隆基建 | `modality/voxcpm2_server.py` **已支持 voice clone**(`handle.generate(text, prompt_speech_path=参考wav)`),有 `voice_clones_dir` 配置位;`cosyvoice_server.py` 走 `inference_sft`(预置说话人,可扩 zero-shot) | **基本已在**,主要是接线 + UI + 打包 |
| TTS 主链 | `tts.synthesize` 分档 piper/edge/sherpa → `AudioPipeline.synthesize`;provider 可扩 | 加一档 `clone` 即可 |
| Runtime server 模式 | `_runtime_server_base.make_runtime_app`(framework yaml 配置 + /health fail-soft + mp child)| 数字人也照此起独立 sidecar |
| capability_router | `resolve_model("tts")` 统一挑后端 | 克隆音色注册成一个 voice id |
| 数字人 | **零基础**(无 avatar/wav2lip/sadtalker 痕迹) | 全新立项 |
| 时间轴/合成 | EDL(video/audio/subtitle 轨)+ `render_from_edl` + `source_resolver`(material_id/path/url → 本地路径) | 数字人视频作为「主轨 clip / 单独视频源」接入,复用现有 EDL/PIP 体系 |

---

## 一、音色克隆(上传/拾取音色)

### 1.1 详细需求说明

**功能需求**
1. **上传音色**:用户上传 3–10s 干净人声 wav/mp3(可带可选「参考文本」提升零样本质量)。
2. **拾取音色(录音)**:浏览器 `MediaRecorder` 当场录 3–10s,直接作参考样本。
3. **命名 + 管理**:克隆音色出现在语音设置「我的音色」分组;可重命名、删除、试听。
4. **合成旁白**:选「我的音色」→ 生成旁白时用克隆音色;与现有 piper/edge/sherpa 并列。
5. **跨语种**(可选,取决于模型):中文样本也能读英文文案。

**非功能需求**
- 自包含:克隆模型随包内置,装完即用;GPU 可选,CPU 慢但能跑。
- 隐私:参考样本只存本机 `voice_clones_dir`,不外传。
- 质量门槛:样本噪声大 / 过短时给提示(不强行合成出垃圾)。
- 兼容:不破坏现有 voice_provider 三档;克隆失败可回退默认音色。

### 1.2 技术方案

**模型选型(对比)**

| 模型 | 克隆方式 | 中文 | 体积 | ModelScope | 适配度 |
|---|---|---|---|---|---|
| **VoxCPM**(已集成) | zero/few-shot,prompt wav | 好 | 中 | 可达 | ⭐ 首选(基建已在) |
| **CosyVoice / CosyVoice2**(已有 server) | zero-shot(需参考文本) | 很好,支持跨语种 | 中大 | 可达 | ⭐ 备选(质量更高) |
| GPT-SoVITS | few-shot(~5s) | 很好 | 中 | 可达 | 质量高但工程化更重 |
| F5-TTS / Fish-Speech | zero-shot | 好 | 中 | 部分可达 | 备选 |
| XTTS v2 / OpenVoice | zero-shot | 一般 | 中 | HF 为主 | 国内不便 |

**推荐**:**以已集成的 VoxCPM 为主**(改动最小、风险最低);CosyVoice2 作「高质量模式」可选升级。

**架构与数据流**
```
前端 上传/录音 wav ──POST /voices/clone──► 后端存 voice_clones_dir/<id>.wav (+ <id>.txt 参考文本)
                                            └─ 注册成 voice id: "clone:<id>"
旁白生成: params.voice_provider="clone", voice_name="clone:<id>"
  → tts.synthesize 新增 clone 分支
  → AudioPipeline 解析 "clone:<id>" → 取 voice_clones_dir/<id>.wav
  → 转发 VoxCPM2 server: handle.generate(text, prompt_speech_path=<wav>)
  → 旁白 audio.wav
```

**后端改动**
- `schemas.py`:`VgVoiceProvider`/`voice_provider` 增 `clone`(前端类型同步)。
- 新端点:
  - `POST /api/v1/video-generation/voices/clone`(multipart:file + name + 可选 ref_text)→ 存样本 + 返回 voice id。
  - `GET /voices?provider=clone` → 扫 `voice_clones_dir` 列「我的音色」。
  - `DELETE /voices/clone/{id}`、`POST /voices/clone/{id}/preview`(试听一句固定文案)。
- `tts.py`:`provider=="clone"` 分支 → 解析 voice id → 调 VoxCPM2;失败 fallback piper。
- `modality/audio.py`:`synthesize(voice="clone:...")` 路由到 voxcpm2_server(已有 voice clone 接口)。
- `voice_clones_dir` 走 `<CHAYUAN_ROOT>/data/voice_clones/`(随用户数据,跨重建保留)。

**前端改动**(复用现有 `VgSpeechSettings`)
- provider chip 增「克隆」;选中后显「我的音色」下拉(查 `/voices?provider=clone`)。
- 「上传音色」按钮 + 「录音」按钮(MediaRecorder,录完上传)+ 命名弹框。
- 每个克隆音色:试听 ▶ / 删除。
- 旁白生成沿用现有 `runDraftGen`(voice_provider/voice_name 进 params)。

**打包**
- VoxCPM 模型走 ModelScope seed 到 `bundled_models`;PyInstaller spec 加 `collect_submodules("voxcpm")` 等动态包。
- `ffmpeg`(已有)用于参考样本重采样到模型要求采样率。

### 1.3 风险与缓解
- **模型体积/CPU 速度**:CPU 合成慢 → 进度提示 + 后台任务;GPU 自动加速。
- **样本质量**:前端录音加电平提示 + 时长校验;后端 VAD 去静音(可选)。
- **frozen 打包**:VoxCPM 依赖(torch/torchaudio)按「torch 配对」纪律实测;runtime hook 顺序坑。
- **采样率/格式**:统一用 ffmpeg 转 16k/24k mono wav 再喂模型。

### 1.4 实施分期
- **P1**:后端 clone 端点 + tts clone 分支(接 VoxCPM)+ 前端上传 + 下拉选用 + 试听。**(MVP)**
- **P2**:浏览器录音「拾取音色」+ 删除/重命名 + 样本质量校验。
- **P3**:CosyVoice2 高质量模式可选 + 跨语种。

---

## 二、数字人(talking-head 口型视频)

### 2.1 详细需求说明

**功能需求**
1. **选形象**:预置数字人形象库(几个内置图/短视频)+ 用户上传自己的正脸图。
2. **驱动**:用已生成的旁白音频驱动口型,生成「数字人讲话」视频。
3. **入轨**:生成的数字人视频自动落主视频轨(或单独视频轨),复用时间轴 EDL/PIP。
4. **画幅适配**:按当前 video_aspect/分辨率输出;可作全屏主体或 PIP 小窗。
5. **开关**:「数字人」开关;关闭则走普通素材流程。

**非功能需求**
- 自包含:模型内置;**GPU 强烈建议**,CPU 仅 Wav2Lip 可勉强跑(慢)。
- 时长 = 旁白时长;失败有兜底(回退普通视频,不崩)。
- 隐私:上传形象图只存本机。

### 2.2 技术方案

**模型选型(自包含桌面 + 可能无 GPU + ModelScope)**

| 模型 | 能力 | GPU 依赖 | 体积 | 适配度 |
|---|---|---|---|---|
| **Wav2Lip** | 在底图/底视频上做口型同步 | CPU 可跑(慢) | ~几百MB | ⭐ 自包含 CPU 首选 |
| SadTalker | 单图→带头部动作 talking head | 偏 GPU | 中 | 中 |
| MuseTalk / Hallo / EchoMimic / Sonic | 扩散,高质量 | GPU 重 | 大 | ✗ 桌面 CPU 不现实 |
| Duix/Heygem(硅基)/Linly-Talker/Fay | 完整数字人栈 | GPU 重 | 很大 | 后续可选 |

**推荐**:**Wav2Lip 做自包含 CPU 版 MVP**(底图静帧 + 口型);GPU 高质量(SadTalker/MuseTalk)作可选升级档。

**架构与数据流**
```
形象图(预置/上传) + 旁白 audio.wav
  → 新 sidecar digital_human_server(仿 cosyvoice_server,_runtime_server_base 起)
      Wav2Lip: 人脸检测(s3fd/retinaface) → 口型推理 → mp4
  → 数字人视频落 task_dir/digital_human.mp4
  → 作为主视频轨 clip(source.path)进 EDL → render_from_edl 复用
```

**后端改动**
- 新模块 `video_generation/digital_human/`:
  - `digital_human_server.py`(runtime sidecar,framework=`digital_human`,/health fail-soft)。
  - `steps/digital_human.py`:`generate(avatar_path, audio_path, w, h) → mp4`。
- runner:新 stop 段或开关 —— 旁白生成后,若开数字人则跑 digital_human 步骤,产物作主轨视频源。
- 形象库:`bundled/digital_human/avatars/` 预置 + 用户上传存 `data/avatars/`。
- 端点:`GET /digital-human/avatars`、`POST /digital-human/avatars`(上传)、生成进度走现有任务 SSE。

**前端改动**
- 编辑器/对话框加「数字人」开关 + 形象选择器(预置网格 + 上传)。
- 生成的数字人视频自动进主视频轨;可像普通视频一样调 PIP/转场/时长。

**打包**
- Wav2Lip + 人脸检测权重走 ModelScope seed;spec 显式列动态子模块。
- torch/torchvision **严格配对**(踩过 `torchvision::nms`);frozen runtime hook 顺序。
- 人脸检测模型(s3fd)单独 seed。

### 2.3 风险与缓解(高)
- **体积大 + CPU 慢**:Wav2Lip CPU 出片慢 → 后台任务 + 进度;GPU 自动加速。建议默认「图+口型」,不做全身。
- **frozen 打包复杂**:torch 系 + 人脸检测 + 模型路径,坑最多 → 先 dev 跑通再打包,逐子模块显式列。
- **画质期望管理**:CPU Wav2Lip 画质有限,UI 标注「高清需 GPU」。
- **形象版权**:上传形象用户自负;预置用 CC0 形象。

### 2.4 实施分期
- **P1**:digital_human_server(Wav2Lip)+ 形象库(预置)+ 旁白驱动 → 视频落主轨。**(MVP,GPU 优先)**
- **P2**:上传自定义形象 + CPU 兜底 + 进度/失败回退。
- **P3**:SadTalker/MuseTalk 高质量 GPU 档 + PIP 数字人小窗。

---

## 三、推进建议与决策点

**顺序**:先 **音色克隆**(基建已在 VoxCPM,风险低、价值高,主要接线+UI)→ 再 **数字人**(从零、重依赖、打包坑多,单独立项)。

**需用户拍板的决策点**
1. 音色克隆模型:**VoxCPM(首选,已集成)** vs CosyVoice2(质量更高、更重)?
2. 数字人模型:**Wav2Lip(自包含 CPU)** vs SadTalker/MuseTalk(GPU 高质量)?是否接受「高清需 GPU」?
3. 「拾取音色」是否必须浏览器录音(P2)还是仅上传文件(P1)即可?
4. 数字人产物默认进主轨(全屏)还是可选 PIP 小窗?
5. 自包含红线下,两者模型体积上限可接受到多少(影响安装包大小)?

> 确认决策后,按「音色克隆 P1」先写 implementation plan 落地。

# 数字人 GPU 高质量引擎（可插拔注册表）技术方案

> 状态:设计稿(brainstorming 产物,用户已逐节确认)。承接 `2026-05-30-digital-human-page-design.md`
> (P1–P3:CPU Wav2Lip 自包含 + 商品同屏 + 抠像)。本文聚焦"未来档"的第一步:
> **GPU 高质量 talking-head 作为可插拔的按需安装引擎**。
>
> 用户拍板的两个前提:
> 1. **交付模型 = 按需安装 GPU 运行时**(基础包不变,仍 CPU Wav2Lip 自包含;GPU 用户手动装高质量档)。
> 2. **方案 C = 可插拔引擎注册表**(SadTalker + MuseTalk 都接,用户选;注册表先落,引擎逐个填)。

---

## 0. 背景与红线

- 现状(已交付):`video_generation/digital_human/engine.py` 有 `DigitalHumanEngine` 协议 +
  `Wav2LipEngine`(in-proc CPU,基础包自带)+ `get_engine()` 写死返 Wav2Lip。jobs 调
  `get_engine().generate(avatar_path,audio_path,out_path,width,height,on_progress)`。
- **红线**:full 版自包含 + 装完零下载 + 安装包别太大 + 跨平台(含无 GPU 国产桌面)。
  → GPU 高质量(SadTalker/MuseTalk)需 GPU + 多 GB 模型,**与红线硬冲突**,故走"按需安装运行时",
  **不进基础包**;无 GPU 用户完全不受影响。
- **实测(2026-05-30)**:`wwd123/sadtalker`(ModelScope 33.9w 下载)、`AI-ModelScope/MuseTalk` 均存在;
  确切 checkpoint 拉取方式(根目录只见 `download_models.sh`,权重在子目录/LFS)**实现期实测**。

---

## 一、引擎注册表 + provider 选择

`get_engine()` 从"写死 Wav2Lip"改为**注册表**:

```python
ENGINES = {
  "wav2lip":  EngineSpec(impl=Wav2LipEngine,  kind="cpu", input="both",  builtin=True),
  "sadtalker":EngineSpec(impl=SadTalkerEngine, kind="gpu", input="image", builtin=False),
  "musetalk": EngineSpec(impl=MuseTalkEngine,  kind="gpu", input="video", builtin=False),
}
def get_engine(engine_id: str = "wav2lip") -> DigitalHumanEngine: ...
def list_engines() -> list[dict]:  # [{id,label,kind,input,builtin,installed}]
```

- 三个 impl 都实现现有 `DigitalHumanEngine.generate(...)` 契约 → **上层 jobs 不变**,只多传 `engine_id`。
- `wav2lip` = in-proc(P1 现状);`sadtalker`/`musetalk` = **转发 GPU sidecar**(httpx 调本地 sidecar)。
- 每个引擎 `is_available()`:builtin 恒 True;GPU 引擎查"运行时已装 + sidecar /health ready"。
- **不可用时 generate 抛明确错误**("需先在模型广场安装 SadTalker 运行时"),**不静默回退** Wav2Lip
  (避免用户以为用了高质量档)。

## 二、按需 GPU sidecar（复用现有运行时框架)

GPU 引擎的 torch-cuda/扩散依赖 + checkpoints **不进基础包**,走现有"运行时框架"按需安装:

```
模型广场/运行时框架 → 安装 sadtalker / musetalk 运行时
  (install_recipes: git clone 代码 + pip 依赖 + ModelScope 拉 checkpoints)
        ↓ install_task_manager.start_service(framework=...) 起 sidecar
  modality/sadtalker_server.py / musetalk_server.py
     (_runtime_server_base.make_runtime_app, /health fail-soft,
      POST /infer {avatar_path,audio_path,out_path,w,h} → 写 mp4)
        ↑ 主服务 SadTalkerEngine 经 local_runtime_registry.ensure_ready + httpx 转发
          (复用 audio.py 的 _transcribe_via_sidecar 调用范式)
```

- 新增 install recipes:`sadtalker`(`wwd123/sadtalker`)、`musetalk`(`AI-ModelScope/MuseTalk`)——
  **确切 checkpoint 拉取实现期实测**(同 Wav2Lip 纪律)。
- 新增两个 sidecar server(仿 `cosyvoice_server.py`)。
- 基础包**零变化**:仍 CPU Wav2Lip 自包含;无 GPU/未装运行时用户不受影响。

## 三、引擎档位选择(schema + 端点 + 前端)

- **schema**:`DhGenerateRequest` 加 `engine: Literal["wav2lip","sadtalker","musetalk"] = "wav2lip"`。
  `jobs.submit` 透传 → `get_engine(engine_id)`。不传 = wav2lip(向后兼容,P1/P2/P3 行为不变)。
- **端点**:`GET /digital-human/engines` → `[{id,label,kind,input,builtin,installed}]`。驱动前端选择 + 安装入口。
- **前端**:GeneratePanel 加「画质引擎」选择:
  - `Wav2Lip · 快速(CPU)`(默认,恒可用)
  - `SadTalker · 高清头动(GPU)`、`MuseTalk · 高清口型(GPU)` —— 显示已装/未装;
    **未装 → 「去模型广场安装」**链到现有运行时框架页;选中未装时禁用生成 + 提示。
  - 按当前 preset 的 `avatar_kind` 标注兼容性(见第四节)。
- engine 是"每次生成的画质选择"(类似版式/matte),**不进 preset**(preset 仍只存形象+音色+名字)。

## 四、输入兼容 + 打包红线

- **输入兼容**:SadTalker 要**图**形象(视频则取首帧);MuseTalk 要**视频**底;Wav2Lip **都行**。
  引擎 picker 按 preset 的 avatar_kind 标注兼容性,不兼容时提示"该引擎需图片/视频形象",不硬跑。
- **打包红线(关键)**:GPU 引擎代码(sidecar `.py`)很小,进 chayuan 包没问题;
  **重依赖(torch-cuda/扩散)+ checkpoints 一律不进基础包/PyInstaller**,由 install_recipes 按需
  下载到运行时目录。**基础安装包体积零变化**。无 GPU 的国产桌面:GPU 引擎显示"不可用(需 GPU)"。

## 五、错误处理 + 测试 + 分期

- **错误**:引擎未安装 → 明确"去安装"提示;sidecar 未就绪 → `ensure_ready` 超时报错;
  GPU OOM → 捕获 + 提示降档;输入类型不匹配 → 早拒。GPU 引擎失败**不静默回退** Wav2Lip。
- **测试**:注册表选择(`get_engine` 返对 impl、`is_available` stub)、generate engine 透传、
  `/engines` 形状、sidecar 转发(stub httpx)。真 GPU 推理本机跑不了 → stub,真验在用户 GPU 环境。
- **分期**(pluggable 注册表先落,引擎逐个填):
  - **GPU-P1**:引擎注册表 + `engine` 字段贯通 + `GET /engines` + 前端引擎 picker + 可用性 gating
    (GPU 引擎列出但显"未安装")。**无真 GPU 引擎,只搭可插拔骨架**——Wav2Lip 仍默认可用。
  - **GPU-P2**:SadTalker 运行时(install recipe + sidecar server + 转发 impl)——第一个真 GPU 引擎。
  - **GPU-P3**:MuseTalk 运行时(注册表已支持,照搬)。

---

## 六、实测 model id 速查(2026-05-30)

| 用途 | model id | 来源 | 实测 |
|---|---|---|---|
| SadTalker(图驱动头动) | `wwd123/sadtalker` | ModelScope | 存在,33.9w 下载;权重在子目录(实现期实测拉取) |
| MuseTalk(视频高清口型) | `AI-ModelScope/MuseTalk` | ModelScope | 存在;同上 |

> 确认本 spec 后,按 **GPU-P1(可插拔骨架)** 用 writing-plans 写实施计划落地。其余子系统
> (② 全身肢体 / ③ ONNX 引擎优化)是独立后续项目,各自 spec → plan。

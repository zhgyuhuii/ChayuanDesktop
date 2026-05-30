# 数字人(Digital Human)功能设计

> 状态:设计稿(brainstorming 产物,用户已逐节确认)。本文档承接
> `2026-05-30-digital-human-voice-clone-design.md`(音色克隆 P1 已落地),
> 聚焦**数字人独立页 + 多数字人管理 + 口播生成 + 商品展示**。
>
> 约束总纲(用户拍板):
> - **引擎随 full 版自包含**(装完零下载;lite 版不带数字人)。
> - **数字人 = 形象 + 音色 + 名字 的预设**,可多个,CRUD。
> - 产物**独立出片 + 可进时间轴**(复用现有 EDL/PIP)。
> - 形象支持**预置短视频 + 用户上传图/短视频**。
> - 并发 = **桌面单用户、多任务排队不卡 UI**(模型常驻、任务队列)。
> - 安装包别太大 / 高性能 / 跨平台 / 模块化 / 代码复用。
> - 模型链接进代码前**实测**(本文件内所有 model id 均 2026-05-30 实测)。

---

## 0. 关键决策与实测结论

### 0.1 引擎选型:A(ONNX-first)前置不成立 → 回落 B(PyTorch Wav2Lip),架构不变

talking-head 模型里,真正"自包含 + CPU 可跑 + 跨平台(含无 GPU 国产桌面)+
体积可控"的只有 **Wav2Lip 一系**;SadTalker/MuseTalk/Hallo/Heygem 等 GPU 重、
体积大、CPU 不现实,只能作未来 GPU 高质量插件。

原计划 **A = ONNX-first**(复用已打包 onnxruntime,不拉 torch 进数字人链路)。
**实测结论(2026-05-30)**:

| 资源 | 实测 |
|---|---|
| Wav2Lip PyTorch 权重 | ✅ ModelScope 匿名可达:`silveroxides/ComfyUI_wav2lip-models`(`wav2lip_gan.pth` 436MB + `s3fd-619a316812.pth` 90MB);备选 `GYMaster/Wav2lip`、`Phoenix505026/wav2lip` |
| Wav2Lip ONNX 权重 | ❌ ModelScope 全是 `.pth`;hf-mirror 的 `instant-high/wav2lip-onnx-256` 等需鉴权(HTTP 401),匿名拿不到 |
| 人脸检测 | ✅ s3fd 随上仓附带;retinaface 另有 `damo/cv_resnet50_face-detection_retinaface` |

→ A 的前置(可靠 ONNX 权重)**不成立**,引擎内核走 **B:PyTorch Wav2Lip**
(复用音色克隆已引入的 torch wheel)。**架构其余部分与 A 完全一致**:独立
sidecar + 任务队列 + 引擎 provider 抽象 + EDL 集成 + 首页卡片/页面。引擎抽象成
可替换 provider,未来拿到 ONNX 权重(或自做 `.pth→.onnx` 转换)可无痛换回 A。

体积:推理只需 `wav2lip_gan.pth`(436MB)+ `s3fd`(90MB)≈ **530MB**;训练用
`lipsync_expert/visual_quality_disc`(共 366MB)**不打包**。

### 0.2 「数字人展示商品图」可行性边界(用户选 A + B)

| 含义 | 本质 | 自包含 CPU |
|---|---|---|
| **A. 数字人 + 商品图同屏讲解**(商品作背景/画中画/角落,数字人口播) | 合成(compositing),不碰口型模型 | ✅ 复用已有 PIP/EDL/CompositeVideoClip,零新引擎 |
| **B. 数字人"站在"商品前**(绿幕/抠像贴到含商品背景) | 抠像(chromakey)+ 合成 | ✅ moviepy `mask_color` CPU 零额外模型;预置绿幕形象最干净 |
| **C. 数字人真的手持/操作商品** | 肢体动作驱动(全身扩散大模型) | ❌ 超出自包含本期,标注"需 GPU/在线档(未来)" |

→ 本期做 **A + B**;C 不做,UI 注明未来档。

---

## 一、系统架构 / 模块边界 / 并发

### 1.1 分层(路由无关,逐层职责单一)

```
首页卡片「数字人」→ /digital-human 页
  ├─ 我的数字人(预设 CRUD)
  └─ 生成(选预设 + 文案 [+ 商品图/版式] → 出片 → 下载/进时间轴)
        │  REST /api/v1/digital-human/*   (路由文件只做协议适配 + 鉴权注入)
        ▼
后端 digital_human 服务层
  ├─ store.py     数字人预设 + 形象库 CRUD(持久化)
  ├─ jobs.py      任务队列(单 worker 常驻,进度 SSE)
  ├─ engine.py    引擎 provider 抽象(swap 点)
  │     └─ Wav2LipEngine → 调 sidecar
  └─ modality/digital_human_server.py   常驻 sidecar(模型只加载一次)
        Wav2Lip(torch) + s3fd 人脸检测 → presenter.mp4
        │
        ▼  拼内部 EDL(presenter + 商品图 + 版式 [+ 抠像]) → render_from_edl
        产物 task_dir/digital_human.mp4
        ▼
  作为 EDL clip 源进时间轴(复用 source_resolver / appendClipFromMaterial)
```

### 1.2 模块边界(每文件一职责,可独立测试)

- `modality/digital_human_server.py`:runtime sidecar,复用
  `_runtime_server_base.make_runtime_app`(framework=`digital_human`,
  `/health` fail-soft)。`POST /infer {avatar_path,audio_path,out_path,w,h}`
  → mp4。模型**只在首次加载一次**,常驻。
- `video_generation/digital_human/engine.py`:`DigitalHumanEngine` 协议 +
  `Wav2LipEngine`(转发 sidecar)。**引擎 swap 点** —— 未来 ONNX/GPU 档实现
  同协议即可替换,上层不动。
- `video_generation/digital_human/store.py`:预设 + 形象库 CRUD。
- `video_generation/digital_human/jobs.py`:任务队列 + 进度事件。
- `video_generation/digital_human/compose.py`:拼内部 EDL(版式模板 + 商品图
  + 抠像)交 `render_from_edl`。
- `api_server/digital_human_routes.py`:薄路由(协议 + 鉴权)。

### 1.3 并发(桌面单用户多任务排队)

- sidecar 模型常驻 → 第 2 个任务起**不再重复加载模型**(最大性能点)。
- 主服务 `asyncio` 队列:CPU 模式**默认顺序**处理(CPU 并行只会互相争抢更慢);
  GPU 在场可调并行度 >1。用户连续提交多个,UI 不卡,进度实时回显。
- 队列 + 进度 + 失败回退全复用现有任务 SSE 基建。

### 1.4 跨平台

torch CPU 覆盖 Win/Linux(含统信/麒麟 x86)/macOS;Apple Silicon 可选 MPS。
引擎 provider 抽象让"换更轻内核"成为局部改动。

---

## 二、前端页面(最大化复用现有组件)

### 2.1 入口三件套(与视频生成卡片同一套模式)

- `features/home/HomePage.tsx` 的 `CAPS` 数组加一张卡:
  `{ id:'digital-human', icon:<人形>, title:'数字人',
     subtitle:'选形象 + 绑音色 → 文案口播 → 讲解商品 → mp4', to:'/digital-human' }`。
- `router/index.tsx` 的 `workspaceRoutes` 加 `{ path:'/digital-human',
  id:'digital-human' }`(及按需 `/digital-human/$id`)。
- 页面经 Chrome/page-registry 渲染。

### 2.2 `features/digital-human/` 页面结构(两分区)

- **我的数字人**:预设网格 `DigitalHumanCard`(缩略图 + 名字 + 绑定音色徽标),
  新建/编辑/删除。
  - `DigitalHumanEditor`:① 形象选择器(预置短视频网格 + 上传图/短视频,复用
    `MaterialsStep` 网格+上传范式;上传绿幕底标记 `is_greenscreen`)② 音色绑定
    (**直接复用 `VgSpeechSettings`** 的克隆音色下拉 + 试听)③ 命名。
- **生成**:选一个数字人 + 输入文案(可选复用脚本生成)+ [可选]上传商品图 + 选版式
  (`corner`/`side`/`bg`)+ [B]抠像开关 → 生成按钮 → **复用 `RenderProgressCard`**
  进度 → 结果区:下载 mp4 / 「发送到时间轴」(ingest 成素材 → `appendClipFromMaterial`)。

### 2.3 新增 / 复用

- 新增 API:`packages/api/src/digitalHuman.ts`(presets / avatars / generate);
  类型进 transport。
- 复用:VgSpeechSettings(音色绑定)、RenderProgressCard + 任务 SSE、EDL/timeline
  入轨、previewAudio、MaterialsStep 网格上传、HomePage/router/page-registry。
  新写仅数字人特有的预设管理与生成编排。

---

## 三、数据模型 / 存储

### 3.1 数字人预设(`形象+音色+名字`,商品图不进预设)

```
DigitalHumanPreset = {
  id, name,
  avatar_ref,            # 预置形象 id 或用户上传文件名
  avatar_kind,           # image | video
  is_greenscreen: bool,  # B 抠像用
  voice_provider, voice_name,   # 复用克隆/piper/edge;可 clone:<id>
  created
}
```

### 3.2 生成请求(每次临时输入,不持久化进预设)

```
{ preset_id, text, product_image?(上传/素材), template: corner|side|bg, matte: bool }
```

### 3.3 存储路径

- 预设:`<CHAYUAN_ROOT>/data/digital_human/presets.json`
- 用户形象:`<CHAYUAN_ROOT>/data/digital_human/avatars/<id>.<ext>`(只存本机)
- 预置形象:`vendor/bundled_assets/digital_human/avatars/`(CC0 短视频,部分绿幕)
- 模型:`vendor/bundled_models/digital_human/{wav2lip_gan.pth, s3fd.pth}`
- 产物:`task_dir/digital_human.mp4`

---

## 四、后端 API + 任务流

### 4.1 REST `/api/v1/digital-human/`(路由薄,逻辑在 store/jobs/engine/compose)

- `GET/POST/PUT/DELETE /presets[/{id}]` — 数字人 CRUD
- `GET /avatars`(预置 ∪ 用户)、`POST /avatars`(上传)、`DELETE /avatars/{id}`
- `POST /generate`(preset_id, text, product_image?, template, matte)→ 入队返
  `task_id`;进度走**现有任务 SSE**;结果 mp4 走 task file

### 4.2 一次生成的任务流(全程复用已有能力)

```
text ──tts.synthesize(预设绑定音色,含克隆)──► audio.wav
audio + avatar ──digital_human_server /infer(Wav2Lip)──► presenter.mp4
[B] presenter 抠像(is_greenscreen → moviepy mask_color,CPU 零额外模型)
拼内部 EDL(presenter + 商品图 + 版式模板) ──render_from_edl──► digital_human.mp4
结果 → 下载 / 「发送到时间轴」(ingest 成素材,后续再调 PIP/转场)
```

> 设计要点:合成阶段**构造内部 EDL 交 `render_from_edl`** —— 商品同屏/抠像/版式
> 全是已有 PIP 能力,且"进时间轴"天然(产物本就是 EDL clip)。

### 4.3 版式模板(初版 3 个)

- `corner`:数字人小窗(角落)+ 商品大图主体。
- `side`:数字人 / 商品 左右并排。
- `bg`:商品作背景、数字人居中(配 B 抠像最佳)。

---

## 五、打包分档(自包含红线下压体积)

- `scripts/seed_digital_human.py`:ModelScope **`silveroxides/ComfyUI_wav2lip-models`**
  取 `wav2lip_gan.pth`(436MB)+ `s3fd`(90MB)→ `vendor/bundled_models/digital_human/`;
  训练用 ckpt **不打**(省 366MB)。实测该仓匿名可达。
- 预置绿幕形象 seed 到 `vendor/bundled_assets/digital_human/avatars/`。
- **full 版自包含**(随 Tauri resources 装机);**lite 版不带数字人** —— 首页卡片
  对 lite 显示"需完整版"或隐藏。
- spec:torch 已在(克隆引入);显式列 Wav2Lip / 人脸检测动态子模块;遵守
  **torch/torchvision 配对纪律**(`torchvision::nms` 坑)。ffmpeg 复用(重采样 + 编码)。

> 风险:**预置绿幕形象素材需自行采集/授权**(CC0 真人口播短视频不易找)。缓解:
> P1 可先只内置 1–2 个普通(非绿幕)正脸短视频保证口播跑通,绿幕底随 P3 再补;
> 抠像(B)对非绿幕底效果有限,UI 注明"绿幕底最佳"。

---

## 六、错误处理 / 测试

### 6.1 错误处理

- 模型未就绪 → sidecar `/health` `ready=False` + UI"数字人引擎未就绪"。
- 未检到人脸 → 明确提示"换正脸形象/光线",不强行出垃圾。
- 生成失败 → 回退不崩,保留已生成 audio;UI 给可诊断错误。
- CPU 慢 → 进度条 + 预计时间;不阻塞 UI(队列)。

### 6.2 测试(本机无 torch/moviepy → stub,真跑在用户 py312 环境)

- store CRUD 单测;engine provider 接口(stub sidecar);路由 schema + 鉴权;
  版式/抠像合成(stub moviepy,仿 `tests/.../test_vg_p5a_render.py`);队列顺序。

---

## 七、实施分期

- **P1(MVP)**:首页卡片 + /digital-human 页 + 预设 CRUD + 形象库(预置+上传)+
  口播生成(digital_human_server Wav2Lip + 绑定音色含克隆)+ 任务队列 + 进度 +
  下载 / 进时间轴。
- **P2**:A 商品图同屏 + 版式模板(corner/side/bg)。
- **P3**:B 绿幕抠像背景(moviepy chromakey;预置绿幕形象)。
- **未来**:C 肢体/GPU 高质量(SadTalker/MuseTalk/在线 API);拿到 ONNX 权重则
  引擎回落方案 A 内核(provider 替换,上层不动)。

---

## 八、实测 model id 速查(2026-05-30)

| 用途 | model id | 来源 | 实测 |
|---|---|---|---|
| Wav2Lip 推理权重 | `silveroxides/ComfyUI_wav2lip-models`(取 `wav2lip_gan.pth` + `s3fd-619a316812.pth`) | ModelScope | HTTP 200,匿名可下 |
| Wav2Lip 备选 | `GYMaster/Wav2lip` / `Phoenix505026/wav2lip`(`wav2lip.pth`) | ModelScope | HTTP 200 |
| 人脸检测备选 | `damo/cv_resnet50_face-detection_retinaface` | ModelScope | HTTP 200 |
| 音色克隆(已落地) | `OpenBMB/VoxCPM-0.5B` | ModelScope | HTTP 200,含 config.json |

> 确认本 spec 后,按 P1 用 writing-plans 写 implementation plan 落地。

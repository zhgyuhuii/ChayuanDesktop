# 数字人「身份预设」与「生成」模型纠正 + 可视化重设计 — 设计 spec

- 日期：2026-06-01
- 状态：设计已通过，待 spec review → 写 R1 实现计划
- 背景：前序方案把「台词」错放进预设(AvatarSlot.lines)、用固定版式、无昵称标签、无可视化位置。本 spec 纠正核心模型并重构。

## 1. 核心模型(关注点分离)

「数字人」= 身份配置(无台词);「生成/实时」= 只给台词。

```
DigitalHumanPreset（身份,无台词）
  name      数字人名
  type      single | coframe(同框) | sequential(分段轮流)   # = 旧 compose_mode 语义化
  video_width / video_height                                  # 全局画幅
  subtitle  {enabled, position, style}                        # 全局字幕(复用 VG 字幕设置)
  roles: Role[]   单形象=1;同框/分段=N(上传一个形象=一个角色)

Role（一行一个角色）
  ref, kind                              形象(image/video)
  name                                   昵称(小李/小周);命名→视频中标记
  language
  voice_provider, voice_name, voice_rate, voice_volume   # 各角色各自音色/语速/音量
  x, y, scale                            画面位置(归一 0–1),拖拽设;同框/分段用
  # 不含 lines

GenerateRequest（只台词）
  preset_id
  single    : script            一套台词
  coframe   : script            一套(按句轮流分给各 role,各用各自音色;说话者动口型,余待机)
  sequential: role_scripts[]    每角色各自台词(每行不同),各用各自音色,顺序拼接
```

同框语义(已确认):一套台词按句切分 → 轮流分配给各角色 → 每句用该角色音色合成;所有角色按
位置同框,当前说话者 lip-sync、其余用静态形象待机。

## 2. 迁移(从已建的错误模型)

- `AvatarSlot` 复用为 `Role`:**移除预设侧 lines 的语义**(字段可暂留兼容,但创建/编辑 UI 不再写、生成不再读预设 lines),新增 `name / voice_rate / voice_volume / language / x / y / scale`。
- `compose_mode` → 暴露为 `type`(值不变 single/coframe/sequential),向后兼容。
- 固定版式 `layout(side/pip/main_minor)` → 由每角色自由 `x/y/scale` 取代;`layout` 字段保留但不再是主路径(空/缺省时可用旧版式兜底)。
- 生成请求:弃用"预设台词";`DhGenerateRequest` 增 `role_scripts: List[str]`(sequential)、`script`(single/coframe)。
- 所有新增字段带默认值,旧 presets.json / 旧 task 向后兼容。

## 3. 模块化架构

### 后端(DH 内新模块,单一职责,可测)
- `script_router.plan(type, script, role_scripts, roles) -> List[SynthUnit]`
  - SynthUnit = {role_index, text, voice(provider/name/rate/volume)}。
  - single: 1 单元(role0,script)。coframe: 切句→轮流(role i = 句 i % N)。sequential: 每角色一段(role_scripts[i])。
  - 纯函数,单测。
- `synth`:并发(线程池)逐单元 TTS,各用各自音色/语速/音量。复用现 `_voice_string`;语速/音量经 VG `steps/tts`(已支持 voice_rate/volume)或扩 AudioPipeline。
- `lipsync`:逐单元 wav2lip 片段(复用现 engine)。
- `composer`:
  - single/sequential: 顺序 concat(复用 compose_multi.render_sequential)。
  - coframe: 各角色生成"全长待机/分句说话"轨,按 x/y/scale 自由定位合成(compose_multi 泛化:位置由 role 提供,取代固定版式)。
- `overlay`:昵称标签(按 role 位置叠加)+ 字幕(cue;复用 timeline_bridge / VG 字幕)。
- 并发:`synth` 与 `lipsync` 各单元相互独立 → ThreadPoolExecutor(已有 _POOL 串行队列保证 UI 不卡;单任务内并发逐单元)。

### 前端(可复用组件)
- `CanvasStage`(新,可复用):按画幅显示舞台 + 角色缩略图**可拖拽**设 x/y/scale(归一)。**编辑器与生成预览共用**(修"位置预览未实现")。
- 创建/编辑:顶部全局(类型/画幅/字幕) + **角色行列表**(昵称 / 形象 / 语言 / 音色VoicePicker / 语速 / 音量 / 位置);**去台词**。
- 生成:只台词(single/coframe 一套框;sequential 每角色一行) + 预览(CanvasStage 只显示态)。
- 复用:VoicePicker、DhStudio 壳、VG 时间轴(精编跳转)、VG 字幕设置控件。

### 跨平台 / 性能
- 合成/渲染走 moviepy + imageio-ffmpeg(已跨平台);ffmpeg 路径/参数沿用现有(避免 Windows 字幕烧录坑——字幕走 VG 渲染或软轨)。
- 逐单元并发受全局单 worker 队列约束(桌面单机,避免抢占);CanvasStage 纯前端拖拽(无后端往返)。

## 4. 开发计划(R1–R4)

- **R1 模型纠正(数据层 + 两端 UI 重排)**:Role 补字段、预设去 lines、`type` 暴露、`DhGenerateRequest` 加 role_scripts/script;创建编辑改"一行一角色"(昵称/语言/音色/语速/音量,去台词);生成端只输台词(single/coframe 一套、sequential 每角色一行);后端 jobs 用 `role_scripts` 而非预设 lines。**先做,纠正根本**。
- **R2 可视化位置**:`CanvasStage` 拖拽组件 + Role.x/y/scale 落地;composer 用自由位置(泛化 compose_multi,取代固定版式);编辑器与生成预览接入。
- **R3 生成管线重构**:`script_router`(纯函数+单测) + 并发各音色合成(语速/音量打通) + 昵称标签叠加 + 字幕;single/sequential 先通。
- **R4 同框"按句轮流"渲染**:各角色"待机/说话"分轨合成(最难,放最后)。

每期:py_compile 自检 + 单测(纯函数/dispatch);沙箱跑不了 pytest/typecheck → 用户 py312 实测。提交 sudo,分支 main。

## 5. YAGNI / 非目标
- 不做 pitch/停顿控制;不重写 VG 时间轴(精编仍跳 VG);同框待机用静态形象(不做 idle 动画);背景替换留后续。

## 6. 风险
- 同框 R4 的"分句 lip-sync + 待机合成"复杂度最高,需实测对齐音画。
- 语速/音量在 clone/sherpa 支持度不一(piper length_scale / sherpa speed),不支持的 provider 回退默认速并提示。
- 大量改动叠加在前序未验证代码上 → R1 起每期都建议用户 py312 验证后再下一期。

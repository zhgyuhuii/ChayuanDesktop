# 数字人合成提速 P0 设计(自适应编码 + ffmpeg 单趟合成)

日期:2026-06-04 · 模块:chayuan-desktop / digital_human · 阶段:P0(单机合成提速)

## 背景与目标
当前 DH 合成走 moviepy(`render_scene_layered` 图层合成 + `render_coframe_turntaking` 同框 + `overlay` 字幕),逐帧 Python + 多次重编码,长视频慢且"卡 90%";字幕还因字体 None 失败。wav2lip 已自动 cuda 检测(`infer.py` `device = "cuda" if torch.cuda.is_available()`),`device=cpu` 是部署机无 GPU。

**P0 目标(单机即收益,不上队列/多机)**:
- moviepy → **ffmpeg 单趟合成**(图层合成 + 同框时序 + 字幕一趟做完,消重复编码、消"卡 90%"、根治字幕字体)。
- **GPU/CPU 自适应**:有 NVENC 用 `h264_nvenc`,否则 `libx264 -preset veryfast`;wav2lip 有 GPU 加 fp16 + 预热。
- **埋点**:各段真实耗时,用数据指导后续 P1/P2。
- 预期单条提速 5-20x(视硬件)。

## 决策(用户已定)
- 部署硬件:**两者都要(自适应)**。
- ffmpeg 迁移范围:**一次全迁**(①图层合成 ②同框时序 ③字幕,sequential 顺带)。
- 兜底:**保留 moviepy 自动兜底**(ffcompose 失败 → 回退现有 moviepy,出片不失败)。
- 架构:**方案 A**——统一「场景描述 → ffmpeg filter_complex 编译器」。

## 模块边界
| 模块 | 类型 | 职责 |
|---|---|---|
| `video_generation/compute.py` | 新 | 进程内探测一次并缓存:CUDA/显存、ffmpeg `h264_nvenc` 支持、CPU 核数、`ffmpeg_exe`;产出执行计划(编码器选项 + 编码器名 + fp16 提示 + 并行度)。供 ffcompose/engine/jobs 复用。 |
| `video_generation/digital_human/ffcompose.py` | 新 | 场景描述 → 一条 filter_complex + 单次 ffmpeg。`render(scene, out_path) -> path`,失败抛异常。 |
| `video_generation/digital_human/jobs.py` | 改 | 把单形象/多商品/coframe/sequential + 字幕转成 Scene,调 `ffcompose.render`;异常 → 回退现有 moviepy。 |
| `wav2lip/infer.py` | 改 | cuda 时 `model.half()` + 半精度输入。 |
| 现有 `compose.py`/`compose_multi.py`/`overlay.py` | 保留 | 作 ffcompose 失败兜底,不删。`render_from_edl`(VG 共享)不动。 |

## compute.py 接口
```
@dataclass ComputePlan:
    has_cuda: bool; gpu_name: str; vram_mb: int
    cpu_count: int
    ffmpeg_exe: str
    video_encoder: str           # "h264_nvenc" | "libx264"
    encoder_opts: list[str]      # NVENC: -c:v h264_nvenc -preset p4 -cq 23 ; CPU: -c:v libx264 -preset veryfast -crf 23
    infer_fp16: bool             # = has_cuda
def get_compute() -> ComputePlan   # 缓存;探测:torch.cuda.is_available/get_device_properties;
                                   #   subprocess ffmpeg -hide_banner -encoders 查 nvenc;os.cpu_count
```
探测失败一律安全降级到 CPU/libx264(项目红线:无 GPU 必须仍能跑)。

## 场景模型
```
Scene = {width:int, height:int, duration_ms:int, audio_path:str,
         layers:[Layer], subtitle:{cues:[{start_ms,end_ms,text}], style:dict}|None}
Layer = {src:str, kind:"image"|"video", x:float, y:float, scale:float,
         z:int|None, opacity:float|None, loop:bool,
         windows:[{start_ms,end_ms}]|None}   # None=全程;coframe 说话段用时间窗
```
- 单形象/商品:全程 layer,按归一 x/y/scale/z/opacity 摆;视频 loop、图片常显(语义同 `render_scene_layered`/工作台预览)。
- 坐标:overlay 左上角 = (x*W, y*H);宽 = scale*W,高按源比例(`scale=...:-2`)——与 CanvasStage 严格一致。

## ffcompose 编译器
单条 filter_complex:
1. 底:`color=c=black:s=WxH:d=dur_s`(或最低 z 的全屏层)。
2. 每 layer(按 z 升序,后叠者在上):
   - `scale=round(scale*W):-2`
   - 透明度(opacity<1):`format=yuva420p,colorchannelmixer=aa=opacity`
   - 视频 loop:输入加 `-stream_loop -1` 或滤镜 `loop`,裁到 dur。
   - `overlay=x*W:y*H`(时间窗:`:enable='between(t,ts,te)'`)。
3. 字幕(subtitle 非空):同一趟 `subtitles=<生成的 .ass>:fontsdir=<字体目录>`。.ass 由 cues + style(position/font/size/fore/stroke)生成;字体路径用 `overlay._resolve_font_path`(含系统兜底)→ 根治 font None。
4. 音频:`-i audio_path` 映射;coframe 音频 = 各段音频按出场顺序拼接的连续轨(已在 jobs 备好)。
5. 编码:`compute.encoder_opts`;`-progress pipe` 解析帧进度 → on_progress 回报 90→99。
6. 失败抛异常。

## coframe 时间窗映射
同框轮流在 Scene 里表达为:
- 每角色:1 个 idle 底层(该角色 seg frame0 或形象图,全程,按该角色 x/y/scale/z)+ 该角色每个说话段 1 个时间窗 layer(seg 视频,`enable=between(t,段起,段止)`,同位置)。
- 商品图层并入,全部按 z 统一叠。
- 音频:jobs 把各 seg 音频按 unit 顺序拼成一条连续 wav,作 Scene.audio_path。

## wav2lip fp16 + 预热
- `infer.py`:`if device=="cuda": model = model.half()`,推理输入 `.half()`(CPU 路径不变)。
- 启动预热:进程起来后后台 `get_engine("wav2lip")` 预 load(避免首任务冷启动);失败忽略。

## 埋点
管线各段 `time.perf_counter` 包裹,完成时一行日志:
`[dh-timing] tts=..s infer=..s compose=..s total=..s encoder=nvenc|libx264 mode=single|coframe`。

## 兜底 & 一致性
- `ffcompose.render` 抛异常 → jobs 回退现有 moviepy(`render_scene_layered`/`render_coframe_turntaking` + `_apply_overlays`)。出片绝不失败。
- 预览=成片:同一套归一坐标语义,overlay 左上角对齐 x*W/y*H、scale=占宽比。

## 测试
- 单测:`compute` 探测(mock torch/ffmpeg encoders 输出)、Scene→filter_complex 字符串生成(断言已知 Scene 的 filter 图 + 转义正确)、.ass 生成(cue 时间/样式)。
- ffmpeg 实跑为集成验证(用户机器;本机 py312 已不可用)。

## P0 边界(不做)
- 不上任务队列 / 进程池 / 多机 / 对象存储(P1/P2)。
- sequential 本轮顺带转 ffmpeg(比 coframe 简单)。
- 不动 VG 的 `render_from_edl`。

## 风险
- filter_complex(多层 + 透明度 + 时间窗 + 字幕)生成与转义复杂 → 重点单测生成逻辑;moviepy 兜底降回归。
- NVENC 探测需稳;显存/batch 调参留 P1。
- coframe 长脚本仍偏重(全长轨),ffmpeg 比 moviepy 快但非银弹;P1 再做推理服务化/批处理。

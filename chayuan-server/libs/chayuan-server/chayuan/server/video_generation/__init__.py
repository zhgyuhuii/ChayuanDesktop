"""视频生成模块(短视频自动合成)。

集成自上游 chayuan-video-generation(MoneyPrinterTurbo)的核心合成链路,
适配本项目架构:

- LLM 调用走 chayuan.server.utils.get_ChatOpenAI / get_default_llm(不再
  自接 14 家 SDK)
- TTS 复用 chayuan.server.modality.audio 现有 piper-tts(M1)/ sherpa-onnx-
  tts(M4 升级);edge-tts 作为可选在线备选
- 字幕识别走本地 whisper-server sidecar(不再 import faster-whisper)
- 任务态持久化进主 sqlite(vg_tasks / vg_materials / vg_videos),按
  owner_id 隔离
- 外部二进制(ImageMagick / ffmpeg)由 video_generation/binaries.py 启动
  探测 vendor/bundled_binaries/<platform>/ 注入环境变量

子目录:
    schemas.py    pydantic 模型(VideoParams 等,已扩展 script_source 三模式)
    service.py    对外 API 入口(submit/cancel/list/get task)
    runner.py     asyncio.Queue + ThreadPoolExecutor 跑 moviepy(sync CPU)
    binaries.py   外部二进制路径解析 + 环境注入
    steps/        合成流水线 6 步:
                  script.py(LLM 脚本) terms.py(关键词) tts.py(语音)
                  subtitle.py(字幕) materials.py(素材) compose.py(合成)
    store/        sqlite CRUD:tasks/materials/videos
    resources/    fonts/bgm 索引 + 内置素材库
"""

# 导入即给 moviepy 打 ffmpeg 输出解析兼容补丁(新 ffmpeg 的无冒号 side-data 行)。
# 放在包 __init__ 保证主进程与 multiprocessing 子进程(各自重 import 本包)都生效。
from ._moviepy_compat import apply_moviepy_compat_patches as _apply_moviepy_compat_patches

_apply_moviepy_compat_patches()

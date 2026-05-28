"""视频生成模块常量。

从上游 chayuan-video-generation/app/models/const.py 拷贝,删除
TASK_STATE_* 整数常量(改用 schemas.VgTaskState 字符串枚举)。
"""

# 中英文标点 — generate_audio_subtitle 分句用,避免一句拆得太碎
PUNCTUATIONS = [
    "?",
    ",",
    ".",
    "、",
    ";",
    ":",
    "!",
    "…",
    "？",
    "，",
    "。",
    "；",
    "：",
    "！",
    "...",
]

FILE_TYPE_VIDEOS = ["mp4", "mov", "mkv", "webm"]
FILE_TYPE_IMAGES = ["jpg", "jpeg", "png", "bmp"]

"""视频生成内置资源索引。

vendor/bundled_fonts/ 字体 + vendor/bundled_bgm/ 背景音乐 + 可选的
vendor/bundled_video_clips/ 离线素材片段。启动时构建索引返给前端选择器
用,跟 KB 的 local_runtime_registry 一样的"开箱即用"语义。

模块:
    fonts_index.py   列字体,提供给字幕样式选择器
    bgm_index.py     列内置 BGM + 用户上传 BGM 合并视图
    clips_index.py   离线素材片段索引(可选,full 包预装)
"""

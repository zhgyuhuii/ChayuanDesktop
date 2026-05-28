"""视频生成持久化层。

接 chayuan.server.db 主 sqlite,跟 KB / chat 同库,共享 session_scope。
表前缀 vg_ 避免跟其它模块冲突。所有查询按 owner_id 过滤实现多用户隔离。

模块:
    tasks.py      vg_tasks 任务态(state, progress, params_json, result_json)
    materials.py  vg_materials 用户上传/在线下载的素材库
    videos.py     vg_videos 最终合成视频成品索引
"""

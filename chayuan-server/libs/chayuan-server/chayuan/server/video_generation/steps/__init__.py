"""视频生成流水线步骤层。

每个 step 都是无状态可独立调用的 pure function 风格,接收 VideoParams +
task_id,返回中间产物路径或结构化结果。runner 按顺序串联,可在任意 step
提前 stop(对应 wizard 的"仅生成脚本/音频/字幕"等部分流程)。

依赖关系:
    script ──┬─→ tts ──→ subtitle
             └─→ terms ──→ materials ──┐
                                       ├─→ compose ──→ final video
                              tts ─────┘
                              subtitle ┘
"""

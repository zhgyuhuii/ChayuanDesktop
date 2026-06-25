"""服务端「整篇总结某文件」意图识别（移植前端 detectSummarizeIntent.ts）。

规则:① 命中总结类关键词 ② 在文件列表里唯一匹配到一个文件名（整名/主名出现在
query，或核心指代词与主名互为子串）。0/多匹配 → None（交给普通 RAG，绝不瞎猜）。
"""
from __future__ import annotations

import re
from typing import List, Optional

_INTENT_KEYWORDS = [
    "总结", "概括", "归纳", "摘要", "概要", "梗概", "大意", "大致", "主旨", "要点", "重点",
    "主要内容", "核心内容", "整体内容", "主要讲", "主要说",
    "全文", "通篇", "整篇", "整份", "全篇",
    "内容是什么", "内容是啥", "什么内容", "啥内容", "主题是什么", "重点是什么",
    "写的是什么", "写的什么", "写了什么", "写了些什么", "写了啥", "写的啥",
    "讲的是什么", "讲的什么", "讲了什么", "讲了些什么", "讲了啥", "讲的啥", "讲什么",
    "在讲什么", "讲述了什么", "讲述什么",
    "说的是什么", "说的什么", "说了什么", "说了些什么", "说了啥", "说的啥", "说什么", "在说什么",
    "阐述了什么", "介绍了什么", "描述了什么",
    "是关于什么", "关于什么", "关于啥", "是关于啥", "是讲什么", "是说什么",
    "介绍一下", "简述", "简要介绍", "简单介绍", "大概讲", "大概说", "讲讲", "说说这",
    "这份文件是什么", "这个文件是什么",
]
_SCAFFOLD = re.compile(
    "(这个|那个|这份|那份|该|本|文件|文档|内容|一下|帮我|麻烦|请问|请|大概|简单|"
    "的|了|是|吗|呢|啊|把|对|看看|说说|讲讲)"
)


def _strip_ext(name: str) -> str:
    i = name.rfind(".")
    return name[:i] if i > 0 else name


def _core_tokens(query: str) -> List[str]:
    c = query
    for k in _INTENT_KEYWORDS:
        c = c.replace(k, " ")
    c = _SCAFFOLD.sub(" ", c)
    return [t for t in re.split(r"[^0-9a-zA-Z一-龥._-]+", c.lower()) if len(t) >= 2]


def detect_summarize_intent(query: str, file_names: List[str]) -> Optional[str]:
    q = (query or "").strip()
    if not q:
        return None
    if not any(k in q for k in _INTENT_KEYWORDS):
        return None
    ql = q.lower()
    cores = _core_tokens(q)
    matched = []
    for f in (file_names or []):
        if not f:
            continue
        full = f.lower()
        base = _strip_ext(f).lower()
        if len(base) < 2:
            continue
        if full in ql or base in ql:
            matched.append(f); continue
        if any(t in base or base in t for t in cores):
            matched.append(f)
    uniq = list(dict.fromkeys(matched))
    return uniq[0] if len(uniq) == 1 else None

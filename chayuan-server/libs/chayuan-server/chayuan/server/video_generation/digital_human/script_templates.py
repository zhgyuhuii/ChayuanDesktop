"""内置带货/口播结构模板(只读常量)。"""
from __future__ import annotations
from typing import List, Dict, Optional

_TEMPLATES: List[Dict] = [
    {"id": "free", "name": "自由", "sections": []},
    {"id": "sell4", "name": "带货四段", "sections": ["开场吸引", "卖点展示", "促单逼单", "结尾引导"]},
    {"id": "psa", "name": "问题方案", "sections": ["痛点引入", "解决方案", "行动号召"]},
]


def list_templates() -> List[Dict]:
    return [dict(t) for t in _TEMPLATES]


def get_template(tid: str) -> Optional[Dict]:
    for t in _TEMPLATES:
        if t["id"] == tid:
            return dict(t)
    return None

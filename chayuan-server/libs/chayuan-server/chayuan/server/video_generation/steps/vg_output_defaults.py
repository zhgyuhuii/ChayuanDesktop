"""VG 输出全局默认(背景色 / 片头 / 片尾)持久化。

存 `<chayuan_root>/video_generation/output_defaults.json`。背景色人人可用;
片头/片尾是否生效由渲染入口按 is_paid_member 决定(本模块只存读)。
"""
import json
import os

_DEFAULT = {"background_color": "#000000", "intro_clip": None, "outro_clip": None}


def _path(root=None) -> str:
    if root:
        base = str(root)
    else:
        from chayuan.server.video_generation._helpers import _chayuan_root
        base = str(_chayuan_root())
    return os.path.join(base, "video_generation", "output_defaults.json")


def load_defaults(root=None) -> dict:
    try:
        with open(_path(root), encoding="utf-8") as f:
            d = json.load(f)
        return {k: d.get(k, _DEFAULT[k]) for k in _DEFAULT}
    except Exception:  # noqa: BLE001
        return dict(_DEFAULT)


def save_defaults(d: dict, root=None) -> dict:
    cur = load_defaults(root)
    for k in _DEFAULT:
        if k in d:
            cur[k] = d[k]
    p = _path(root)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return cur

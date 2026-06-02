"""多角色脚本生成:prompt 构造 + 输出容错解析(纯函数,无 IO)。"""
from __future__ import annotations
import re
from typing import List, Dict, Optional

def build_multirole_prompt(subject: str, roles: List[Dict], template_sections: List[str], *, paragraph_number: int = 1) -> str:
    lines = ["你是带货/口播脚本编剧。请为以下多个角色写一段【交错对话】口播脚本。"]
    lines.append("角色(每个角色保持各自人设、只用自己的参考资料中的事实):")
    for r in roles:
        nm = (r.get("name") or "").strip() or "角色"
        ps = (r.get("persona") or "").strip()
        lines.append(f"- {nm}" + (f"(人设:{ps})" if ps else ""))
        ctx = (r.get("context") or "").strip()
        if ctx:
            lines.append(f"  【{nm}·参考资料】{ctx}")
    if template_sections:
        lines.append("请按以下结构推进:" + " → ".join(template_sections) + f"(共约 {paragraph_number} 段)")
    lines.append(f"主题:{subject}")
    lines.append("严格输出格式:每行一句,以 `[角色名] 台词` 开头,按真实对话播放顺序排列,不要额外解释。")
    return "\n".join(lines)

_TAG = re.compile(r"^\s*(?:\[(?P<b>[^\]]{1,20})\]|(?P<c>[^：:\n]{1,20})[：:])\s*(?P<text>.+)$")

def parse_multirole_output(text: str, role_names: List[str]) -> List[Dict]:
    names = [(n or "").strip() for n in role_names]
    def match_role(tag: str) -> Optional[int]:
        tag = (tag or "").strip()
        for i, n in enumerate(names):
            if n and (tag == n or n in tag or tag in n):
                return i
        return None
    segs: List[Dict] = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _TAG.match(line)
        if m:
            tag = m.group("b") or m.group("c")
            body = (m.group("text") or "").strip()
            ri = match_role(tag)
            if ri is not None:
                segs.append({"role_index": ri, "text": body})
                continue
            # 未知标签 → 并入上一段(连同标签文本),无上一段则归角色0
            if segs:
                segs[-1]["text"] = (segs[-1]["text"] + " " + line).strip()
            else:
                segs.append({"role_index": 0, "text": line})
            continue
        # 无标签行:并入上一段;无则归角色0
        if segs:
            segs[-1]["text"] = (segs[-1]["text"] + " " + line).strip()
        else:
            segs.append({"role_index": 0, "text": line})
    return [s for s in segs if s["text"].strip()]

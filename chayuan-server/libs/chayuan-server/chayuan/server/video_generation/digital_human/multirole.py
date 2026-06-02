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
        """匹配优先级:精确 > 最长子串。

        先全表找 ``tag == name``(精确);无精确时在所有 ``name in tag`` /
        ``tag in name`` 候选里取**最长 name**(len 最大)那个 —— 避免
        ``[小李哥]`` 被先出现的子串 ``小李`` 误中。都不中返 None。
        """
        tag = (tag or "").strip()
        if not tag:
            return None
        # 1) 精确匹配优先
        for i, n in enumerate(names):
            if n and tag == n:
                return i
        # 2) 子串候选里取最长 name(len 最大)
        best_i: Optional[int] = None
        best_len = -1
        for i, n in enumerate(names):
            if n and (n in tag or tag in n) and len(n) > best_len:
                best_i = i
                best_len = len(n)
        return best_i
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
            # 未知标签 → 剥掉 `[xxx]` / `名:` 前缀,只并入后面的 text(不把
            # 字面标签当台词念出来);无上一段则用剥后的 body 起新段(归角色0)。
            if segs:
                segs[-1]["text"] = (segs[-1]["text"] + " " + body).strip()
            else:
                segs.append({"role_index": 0, "text": body})
            continue
        # 无标签行:并入上一段;无则归角色0
        if segs:
            segs[-1]["text"] = (segs[-1]["text"] + " " + line).strip()
        else:
            segs.append({"role_index": 0, "text": line})
    return [s for s in segs if s["text"].strip()]

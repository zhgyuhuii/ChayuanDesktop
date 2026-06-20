"""技能翻译服务 —— 外部 agent (openclaw / hermes 等) 的技能名/描述/README
用察元本地 LLM 翻成目标语言,并以 SQLite (skill_translation 表) 缓存。

安全红线:权限清单 (permissions) **永不**机翻。机翻可能把 "full disk access"
误译得轻描淡写,诱导用户对恶意技能放行 —— 故 ``_TRANSLATABLE`` 白名单里不含
permissions,``translate_field`` 对非白名单字段直接抛 ``ValueError``。

``_cache_get`` / ``_cache_set`` / ``_llm_translate`` 内部都是惰性 import,因此
``import translation`` 本身只依赖 stdlib;单测把这三个函数 mock 掉即可在不接
真 DB / 真 LLM 的情况下覆盖核心逻辑。
"""
from __future__ import annotations

import hashlib

# 可机翻字段白名单 —— 权限/permissions 永不在内(安全攸关)
_TRANSLATABLE = {"name", "description", "readme"}


def _key(system: str, skill_id: str, version: str, field: str, lang: str, text: str) -> str:
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
    return f"{system}:{skill_id}:{version}:{field}:{lang}:{h}"


async def _llm_translate(text: str, target_lang: str) -> str:
    from chayuan.server.utils import get_OpenAIClient

    client = get_OpenAIClient(platform_name="local", is_async=True)
    resp = await client.chat.completions.create(
        model="local",
        messages=[
            {"role": "system",
             "content": f"Translate to {target_lang}. Output only the translation."},
            {"role": "user", "content": text},
        ],
        max_tokens=400,
    )
    return resp.choices[0].message.content or text


def _cache_get(key: str):
    from chayuan.server.db.models.skill_translation_model import SkillTranslationModel
    from chayuan.server.db.session import session_scope

    with session_scope() as s:
        row = s.query(SkillTranslationModel).filter_by(cache_key=key).first()
        return row.translated_text if row else None


def _cache_set(key: str, val: str) -> None:
    from chayuan.server.db.models.skill_translation_model import SkillTranslationModel
    from chayuan.server.db.session import session_scope

    with session_scope() as s:
        s.add(SkillTranslationModel(cache_key=key, translated_text=val))
        # session_scope 退出时自动 commit


async def translate_field(*, system: str, skill_id: str, version: str,
                          field: str, text: str, target_lang: str = "zh") -> str:
    if field not in _TRANSLATABLE:
        raise ValueError(f"field '{field}' must not be machine-translated")
    if not text.strip():
        return text
    key = _key(system, skill_id, version, field, target_lang, text)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    out = await _llm_translate(text, target_lang)
    _cache_set(key, out)
    return out

import asyncio

import pytest

from chayuan.server.agent_connector import translation as T


def test_permissions_field_is_not_translated():
    with pytest.raises(ValueError):
        asyncio.get_event_loop().run_until_complete(
            T.translate_field(system="openclaw", skill_id="x", version="1",
                              field="permissions", text="net access", target_lang="zh"))


def test_translate_uses_cache(monkeypatch):
    calls = {"n": 0}

    async def fake_llm(text, target_lang):
        calls["n"] += 1
        return "译文:" + text

    monkeypatch.setattr(T, "_llm_translate", fake_llm)
    monkeypatch.setattr(T, "_cache_get", lambda key: None)
    stored = {}
    monkeypatch.setattr(T, "_cache_set", lambda key, val: stored.__setitem__(key, val))

    out = asyncio.get_event_loop().run_until_complete(
        T.translate_field(system="openclaw", skill_id="x", version="1",
                          field="description", text="hello", target_lang="zh"))
    assert out == "译文:hello" and calls["n"] == 1

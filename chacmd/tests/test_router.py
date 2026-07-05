"""#5 统一调度对话框 NL 路由（快慢双路：@昵称直取 / 关键词规则 / LLM 冷启兜底）。

NFR-P2 热路径禁 LLM：@昵称/规则=快路（确定性）；未命中才落 LLM 慢路。
"""

import pytest

from chacmd.orchestrator.router import RouteRule, route


class _FakeLLM:
    """chat_completions 返回预置昵称，记录被调用。"""

    def __init__(self, content: str) -> None:
        self._content = content
        self.called = False

    async def chat_completions(self, model, messages, **kw):
        self.called = True
        return {"choices": [{"message": {"content": self._content}}]}


KNOWN = {"dev", "analyst", "writer"}
RULES = (
    RouteRule(keywords=("代码", "开发", "bug"), nickname="dev"),
    RouteRule(keywords=("分析", "统计", "报表"), nickname="analyst"),
)


@pytest.mark.asyncio
async def test_fast_path_at_nickname():
    r = await route("@dev 把登录修一下", KNOWN, RULES)
    assert r.nickname == "dev"
    assert r.path == "fast"
    assert r.confidence == 1.0


@pytest.mark.asyncio
async def test_fast_path_ignores_unknown_at_nickname():
    # @ghost 不在已知集 → 不走 fast，落规则/LLM
    r = await route("@ghost 帮我分析报表", KNOWN, RULES)
    assert r.path != "fast"
    assert r.nickname == "analyst"  # 命中"分析/报表"规则


@pytest.mark.asyncio
async def test_rule_path_keyword_match():
    r = await route("这段代码有 bug", KNOWN, RULES)
    assert r.nickname == "dev"
    assert r.path == "rule"
    assert r.confidence > 0.5  # 命中越多置信越高


@pytest.mark.asyncio
async def test_rule_path_picks_highest_score():
    # 同时含 dev 与 analyst 关键词，dev 命中 2 个 > analyst 1 个
    r = await route("开发代码顺便做个统计", KNOWN, RULES)
    assert r.nickname == "dev"


@pytest.mark.asyncio
async def test_llm_fallback_when_no_rule_hit():
    llm = _FakeLLM("analyst")
    r = await route("帮我把这批东西弄一下", KNOWN, RULES, chayuan=llm)
    assert llm.called is True
    assert r.nickname == "analyst"
    assert r.path == "llm"


@pytest.mark.asyncio
async def test_llm_result_validated_against_known():
    llm = _FakeLLM("nonexistent")  # LLM 幻觉一个不存在昵称 → 判 none
    r = await route("模糊需求", KNOWN, RULES, chayuan=llm)
    assert r.nickname is None
    assert r.path == "none"


@pytest.mark.asyncio
async def test_no_llm_no_rule_returns_none():
    r = await route("完全无关键词的话", KNOWN, RULES)
    assert r.nickname is None
    assert r.path == "none"

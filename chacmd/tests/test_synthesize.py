"""#7 结果聚合 + 成果共享：中心把多 Task 产物语义汇总回大屏（LLM，mock）。"""

import pytest

from chacmd.orchestrator.synthesize import (
    TaskArtifact,
    build_synthesis_prompt,
    synthesize,
)


class _FakeLLM:
    def __init__(self, content):
        self.content = content
        self.called = False

    async def chat_completions(self, model, messages, **kw):
        self.called = True
        return {"choices": [{"message": {"content": self.content}}]}


ARTIFACTS = [
    TaskArtifact(nickname="dev", outcome="succeeded", summary="实现了登录接口"),
    TaskArtifact(nickname="qa", outcome="succeeded", summary="回归通过 42 用例"),
]


def test_prompt_contains_goal_and_all_artifacts():
    p = build_synthesis_prompt("交付登录功能", ARTIFACTS)
    assert "交付登录功能" in p
    assert "dev" in p and "实现了登录接口" in p
    assert "qa" in p and "回归通过 42 用例" in p


@pytest.mark.asyncio
async def test_synthesize_returns_llm_summary():
    llm = _FakeLLM("登录功能已交付并通过回归。")
    out = await synthesize(llm, "交付登录功能", ARTIFACTS)
    assert llm.called is True
    assert out == "登录功能已交付并通过回归。"


@pytest.mark.asyncio
async def test_synthesize_empty_artifacts_degrades_without_llm():
    llm = _FakeLLM("should-not-be-called")
    out = await synthesize(llm, "空任务", [])
    assert llm.called is False  # 无产物不调 LLM（优雅降级）
    assert "暂无" in out


@pytest.mark.asyncio
async def test_synthesize_empty_llm_content_falls_back():
    llm = _FakeLLM("")  # LLM 返回空 → 回退到确定性拼接
    out = await synthesize(llm, "交付登录功能", ARTIFACTS)
    assert "dev" in out and "qa" in out

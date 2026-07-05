"""#7 结果聚合 + 成果共享：中心语义汇总多 Task 产物回大屏。

产物落卷（workspace done-marker）后，取各员工的结果摘要拼成 prompt，经 chayuan 网关
生成一段自然语言汇总回指挥台。无产物/LLM 空返回时优雅降级为确定性拼接（NFR §133 降级）。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class TaskArtifact:
    nickname: str
    outcome: str
    summary: str


class _LLM(Protocol):
    async def chat_completions(self, model: str, messages: list[dict], **kw: Any) -> dict: ...


def build_synthesis_prompt(goal: str, artifacts: Iterable[TaskArtifact]) -> str:
    lines = [f"任务目标：{goal}", "各数字员工产出如下，请用中文汇总为一段面向指挥官的结论："]
    for a in artifacts:
        lines.append(f"- @{a.nickname}（{a.outcome}）：{a.summary}")
    return "\n".join(lines)


def _deterministic(goal: str, artifacts: Sequence[TaskArtifact]) -> str:
    parts = "；".join(f"@{a.nickname} {a.summary}" for a in artifacts)
    return f"目标「{goal}」汇总：{parts}。"


def _llm_content(resp: dict) -> str:
    try:
        return str(resp["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError):
        return ""


async def synthesize(
    chayuan: _LLM,
    goal: str,
    artifacts: Sequence[TaskArtifact],
    *,
    model: str = "synthesizer",
) -> str:
    """把多产物汇总成回大屏的一段话。无产物 → 降级提示；LLM 空 → 确定性拼接。"""
    if not artifacts:
        return "（暂无产物可汇总）"
    prompt = build_synthesis_prompt(goal, artifacts)
    resp = await chayuan.chat_completions(model=model, messages=[{"role": "user", "content": prompt}])
    content = _llm_content(resp)
    return content or _deterministic(goal, artifacts)


__all__ = ["TaskArtifact", "build_synthesis_prompt", "synthesize"]

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from chacmd.domain.events import Event
from chacmd.interfaces.agent_adapter import AgentAdapter, DispatchSpec


def map_openhands_line(
    line: dict, *, job_id: str, task_id: str, nickname: str, seq: int
) -> Event:
    """OpenHands JSONL 事件 → 统一 Event(§6.6)。未知行归为 progress。

    OpenHands headless 同时用 action(发起) 与 observation(结果) 两类事件；
    这里覆盖 start / run / message / finish(agent_state) / error 主要类型。
    """
    tokens = 0
    metrics = line.get("llm_metrics")
    if isinstance(metrics, dict):
        tokens = metrics.get("total_tokens", 0) or 0

    kind = "progress"
    payload: dict[str, Any] = {}

    if line.get("action") == "start":
        kind = "started"
    elif line.get("observation") == "error":
        kind = "failed"
        payload["message"] = line.get("message", "")
    elif (
        line.get("observation") == "agent_state_changed"
        and line.get("extras", {}).get("agent_state") == "finished"
    ):
        kind = "succeeded"
    elif line.get("action") == "run":
        payload["command"] = line.get("args", {}).get("command", "")
    elif "action" in line:
        payload["action"] = line["action"]

    if tokens:
        payload["tokens"] = tokens
    return Event(job_id, task_id, nickname, kind, seq, payload)


class OpenHandsAdapter(AgentAdapter):
    """I5 — OpenHands headless(--headless)。构造启动命令 → 逐行解析 stdout JSONL。"""

    def __init__(self, launch_cmd: list[str] | None = None) -> None:
        # launch_cmd 模板；真跑由 Provisioner 在子容器内起。P0 支持本地子进程模式。
        self._launch_cmd = launch_cmd or ["python", "-m", "openhands.core.main", "--headless"]
        self._procs: dict[tuple[str, str], asyncio.subprocess.Process] = {}

    async def dispatch(self, spec: DispatchSpec) -> AsyncIterator[Event]:
        cmd = [*self._launch_cmd, "-t", spec.goal]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        self._procs[(spec.job_id, spec.task_id)] = proc
        seq = 0
        yield Event(spec.job_id, spec.task_id, spec.nickname, "started", seq, {"goal": spec.goal})
        assert proc.stdout is not None
        async for raw in proc.stdout:
            text = raw.decode(errors="replace").strip()
            if not text:
                continue
            try:
                obj = json.loads(text)
            except json.JSONDecodeError:
                continue
            seq += 1
            yield map_openhands_line(
                obj, job_id=spec.job_id, task_id=spec.task_id, nickname=spec.nickname, seq=seq
            )
        await proc.wait()

    async def health(self) -> bool:
        return True

    async def cancel(self, job_id: str, task_id: str) -> None:
        proc = self._procs.get((job_id, task_id))
        if proc and proc.returncode is None:
            proc.terminate()

    def manifest(self) -> dict[str, Any]:
        return {"name": "openhands", "capabilities": ["stream", "cancel", "sandbox"]}

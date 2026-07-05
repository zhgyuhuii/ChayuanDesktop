from __future__ import annotations

from fastapi import FastAPI, HTTPException
from sqlalchemy import select

from chacmd.api.schemas import (
    ContainerOut,
    CreateRunRequest,
    ForceStateRequest,
    RejectRequest,
    RunCreated,
    RunStatus,
)
from chacmd.domain.models import ContainerReg
from chacmd.domain.repository import JobRepository
from chacmd.domain.state import JobState
from chacmd.interfaces.db import Database


def create_app(db: Database, chayuan: object | None = None) -> FastAPI:
    app = FastAPI(title="ChaCMD Orchestrator", version="0.1.0")
    jobs = JobRepository(db)

    @app.post("/api/v1/tasks/{code}/runs", response_model=RunCreated, status_code=201)
    async def create_run(code: str, req: CreateRunRequest) -> RunCreated:
        # #20 Task-as-API: external caller passes `code` → spawn a new run instance.
        job = await jobs.create(code=code, goal=req.goal, dept=req.dept)
        return RunCreated(job_id=job.id, state=job.state)

    @app.get("/api/v1/runs/{job_id}", response_model=RunStatus)
    async def get_run(job_id: str) -> RunStatus:
        job = await jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="run not found")
        return RunStatus(job_id=job.id, code=job.code, goal=job.goal, dept=job.dept, state=job.state)

    @app.get("/api/v1/containers", response_model=list[ContainerOut])
    async def list_containers() -> list[ContainerOut]:
        async with db.session() as s:
            rows = await s.execute(select(ContainerReg))
            return [ContainerOut(nickname=r.nickname, dept=r.dept) for r in rows.scalars()]

    async def _status(job_id: str) -> RunStatus:
        job = await jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="run not found")
        return RunStatus(job_id=job.id, code=job.code, goal=job.goal, dept=job.dept, state=job.state)

    @app.post("/api/v1/runs/{job_id}/approve", response_model=RunStatus)
    async def approve(job_id: str) -> RunStatus:
        # NFR-H1 审批门：pending_approval → running（继续执行）
        try:
            await jobs.set_state(job_id, JobState.RUNNING)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        return await _status(job_id)

    @app.post("/api/v1/runs/{job_id}/reject", response_model=RunStatus)
    async def reject(job_id: str, req: RejectRequest) -> RunStatus:
        # NFR-H1 审批门：pending_approval → cancelled（打回）
        try:
            await jobs.set_state(job_id, JobState.CANCELLED)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        return await _status(job_id)

    @app.post("/api/v1/runs/{job_id}/_force_state", response_model=RunStatus)
    async def force_state(job_id: str, req: ForceStateRequest) -> RunStatus:
        # 运维/测试专用：绕过状态机造态
        await jobs.force_state(job_id, req.state)
        return await _status(job_id)

    if chayuan is not None:
        from chacmd.shim.anthropic_shim import anthropic_to_openai, openai_to_anthropic

        @app.post("/v1/messages")
        async def anthropic_messages(req: dict) -> dict:
            # #16 缺口：Claude Code 经此 shim 调察元 OpenAI 兼容网关(/v1/chat/completions)。
            oai = anthropic_to_openai(req)
            extra = {k: v for k, v in oai.items() if k not in ("model", "messages")}
            resp = await chayuan.chat_completions(oai["model"], oai["messages"], **extra)
            return openai_to_anthropic(resp, model=req["model"])

    return app

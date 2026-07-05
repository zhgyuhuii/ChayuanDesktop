from __future__ import annotations

from pydantic import BaseModel


class CreateRunRequest(BaseModel):
    goal: str
    dept: str


class RunCreated(BaseModel):
    job_id: str
    state: str


class RunStatus(BaseModel):
    job_id: str
    code: str
    goal: str
    dept: str
    state: str


class ContainerOut(BaseModel):
    nickname: str
    dept: str


class RejectRequest(BaseModel):
    reason: str = ""


class ForceStateRequest(BaseModel):  # 仅测试/运维用
    state: str

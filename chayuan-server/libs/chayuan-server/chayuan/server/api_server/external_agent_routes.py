from __future__ import annotations
from dataclasses import asdict
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.agent_connector.manager import AgentInstanceManager
from chayuan.server.agent_connector.policy import derive_host_policy

external_agent_router = APIRouter(prefix="/api/v1/external-agents", tags=["External Agents"])


def _agents_enabled() -> bool:
    try:
        from chayuan.settings import Settings
        return bool(getattr(Settings.basic_settings, "EXTERNAL_AGENTS_ENABLED", False))
    except Exception:
        return False


def _manager() -> AgentInstanceManager:
    from chayuan.settings import Settings
    hp = getattr(Settings.basic_settings, "EXTERNAL_AGENTS_HOST_POLICY", "auto")
    auth = bool(getattr(Settings.basic_settings, "AUTH_REQUIRED", False))
    return AgentInstanceManager(policy=derive_host_policy(host_policy=hp, auth_required=auth))


def _resolve(system_id: str, user: Optional[Dict[str, Any]] = None):
    return _manager().resolve(system_id, user=user)


def _guard():
    if not _agents_enabled():
        raise HTTPException(status_code=404, detail="external agents disabled")


@external_agent_router.get("/{system_id}/status")
def status(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    return asdict(_resolve(system_id, user).status())


@external_agent_router.post("/{system_id}/start")
def start(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).start()
    return {"ok": True}


@external_agent_router.post("/{system_id}/stop")
def stop(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).stop()
    return {"ok": True}


@external_agent_router.post("/{system_id}/restart")
def restart(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).restart()
    return {"ok": True}


@external_agent_router.post("/{system_id}/uninstall")
def uninstall(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    _resolve(system_id, user).uninstall()
    return {"ok": True}


@external_agent_router.get("/{system_id}/config")
def get_config(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    return asdict(_resolve(system_id, user).get_config())


@external_agent_router.post("/{system_id}/install")
def install(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    conn = _resolve(system_id, user)

    def gen():
        import json
        for ev in conn.install():
            yield f"event: agent.install.{ev.level}\ndata: {json.dumps(asdict(ev))}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


class ConfigIn(BaseModel):
    raw: str
    soul: str = ""
    format: str = "json5"


@external_agent_router.put("/{system_id}/config")
def put_config(system_id: str, body: ConfigIn, user=Depends(require_auth_enabled())):
    _guard()
    from chayuan.server.agent_connector.base import AgentConfigBundle
    _resolve(system_id, user).set_config(
        AgentConfigBundle(raw=body.raw, soul=body.soul, format=body.format)
    )
    return {"ok": True}


@external_agent_router.get("/{system_id}/logs/stream")
def logs_stream(system_id: str, user=Depends(require_auth_enabled())):
    _guard()
    conn = _resolve(system_id, user)

    def gen():
        import json
        for line in conn.stream_logs():
            yield f"event: agent.log\ndata: {json.dumps({'line': line})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

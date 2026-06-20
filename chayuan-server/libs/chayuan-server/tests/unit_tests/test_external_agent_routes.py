import os, sys
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server import external_agent_routes as R
from chayuan.server.agent_connector.openclaw import OpenClawAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

FAKE = os.path.join(os.path.dirname(__file__), "fakes", "fake_openclaw.py")


def _client(monkeypatch, enabled=True):
    from chayuan.settings import Settings
    monkeypatch.setattr(Settings.basic_settings, "AUTH_REQUIRED", False)
    monkeypatch.setattr(R, "_agents_enabled", lambda: enabled)

    def fake_resolve(system_id, user=None):
        runner = AgentCliRunner(bin_path=sys.executable, allowed_subcommands={FAKE})
        return OpenClawAdapter(runner=runner, argv_prefix=[FAKE])

    monkeypatch.setattr(R, "_resolve", fake_resolve)
    app = FastAPI()
    app.include_router(R.external_agent_router)
    return TestClient(app)


def test_status_endpoint(monkeypatch):
    os.environ.pop("FAKE_OPENCLAW_RUNNING", None)
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/status")
    assert r.status_code == 200
    assert r.json()["installed"] is True and r.json()["running"] is False


def test_disabled_returns_404(monkeypatch):
    c = _client(monkeypatch, enabled=False)
    r = c.get("/api/v1/external-agents/openclaw/status")
    assert r.status_code == 404


def test_start_endpoint(monkeypatch):
    c = _client(monkeypatch)
    r = c.post("/api/v1/external-agents/openclaw/start")
    assert r.status_code == 200 and r.json()["ok"] is True

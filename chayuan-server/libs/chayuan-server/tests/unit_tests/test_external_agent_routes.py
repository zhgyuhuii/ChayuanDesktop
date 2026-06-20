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


def test_put_config(monkeypatch):
    c = _client(monkeypatch)
    r = c.put("/api/v1/external-agents/openclaw/config",
              json={"raw": "{}", "soul": "be nice", "format": "json5"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_logs_stream(monkeypatch):
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/logs/stream")
    assert r.status_code == 200
    assert "text/event-stream" in r.headers["content-type"]
    assert "gateway up" in r.text


def test_skills_list(monkeypatch):
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/skills")
    assert r.status_code == 200
    assert r.json()[0]["name"] == "Web Search"
    assert r.json()[0]["permissions"] == ["net"]


def test_skills_search(monkeypatch):
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/skills/search?q=todo")
    assert r.status_code == 200 and r.json()[0]["name"] == "Todo"


def test_skills_uninstall(monkeypatch):
    c = _client(monkeypatch)
    r = c.post("/api/v1/external-agents/openclaw/skills/web-search/uninstall")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_skills_translate_permissions_rejected(monkeypatch):
    c = _client(monkeypatch)
    r = c.get("/api/v1/external-agents/openclaw/skills/web-search/translate",
              params={"field": "permissions", "version": "1", "text": "net"})
    assert r.status_code == 400

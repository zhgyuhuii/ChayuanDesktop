import os
import sys
from chayuan.server.agent_connector.openclaw import OpenClawAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

FAKE = os.path.join(os.path.dirname(__file__), "fakes", "fake_openclaw.py")


def _adapter(running: bool = False) -> OpenClawAdapter:
    # bin=python；argv_prefix=[FAKE]；白名单放 FAKE（args[0] 即 FAKE）
    runner = AgentCliRunner(bin_path=sys.executable, allowed_subcommands={FAKE})
    ad = OpenClawAdapter(runner=runner, argv_prefix=[FAKE])
    if running:
        os.environ["FAKE_OPENCLAW_RUNNING"] = "1"
    else:
        os.environ.pop("FAKE_OPENCLAW_RUNNING", None)
    return ad


def test_status_when_stopped():
    s = _adapter(running=False).status()
    assert s.installed is True and s.running is False
    assert s.version == "0.22.0" and s.pid is None


def test_status_when_running():
    s = _adapter(running=True).status()
    assert s.running is True and s.pid == 4242 and s.uptime_seconds == 60
    assert s.health == "ok"


def test_install_streams_events_ending_done():
    events = list(_adapter().install())
    assert events[-1].level == "done"
    assert any("installed" in e.message for e in events)


def test_get_config_returns_text():
    bundle = _adapter().get_config()
    assert "agents" in bundle.raw and bundle.format == "json5"


def test_list_skills():
    skills = _adapter().list_skills()
    assert skills[0].name == "Web Search" and skills[0].installed is True
    assert skills[0].permissions == ["net"]


def test_search_skills():
    res = _adapter().search_skills("todo")
    assert res[0].name == "Todo" and res[0].installed is False

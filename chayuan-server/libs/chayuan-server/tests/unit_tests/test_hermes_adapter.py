import os, sys
from chayuan.server.agent_connector.hermes import HermesAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

FAKE = os.path.join(os.path.dirname(__file__), "fakes", "fake_hermes.py")


def _ad(running=False):
    r = AgentCliRunner(bin_path=sys.executable, allowed_subcommands={FAKE})
    os.environ["FAKE_HERMES_RUNNING"] = "1" if running else "0"
    return HermesAdapter(runner=r, argv_prefix=[FAKE])


def test_status_running():
    s = _ad(running=True).status()
    assert s.installed is True and s.running is True and s.version == "1.0.0"


def test_status_stopped():
    s = _ad(running=False).status()
    assert s.running is False


def test_hermes_list_skills():
    s = _ad().list_skills()
    assert s[0].name == "Weather" and s[0].permissions == ["net"]

import sys
import pytest
from chayuan.server.agent_connector.runner import AgentCliRunner, DisallowedCommand


def _runner():
    # 白名单放 "-c"；bin 是 python。argv = [python, "-c", ...]，白名单校验 args[0]="-c"。
    return AgentCliRunner(bin_path=sys.executable, allowed_subcommands={"-c"})


def test_rejects_disallowed_subcommand():
    r = _runner()
    with pytest.raises(DisallowedCommand):
        r.run(["rm", "-rf", "/"])


def test_run_captures_stdout_and_rc():
    r = _runner()
    res = r.run(["-c", "print('hi')"])
    assert res.returncode == 0
    assert "hi" in res.stdout


def test_stream_yields_lines():
    r = _runner()
    lines = list(r.stream(["-c", "import sys;[print(i) for i in range(3)]"]))
    assert lines == ["0", "1", "2"]

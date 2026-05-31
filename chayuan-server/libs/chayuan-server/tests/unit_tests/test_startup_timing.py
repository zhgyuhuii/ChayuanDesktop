# tests/unit_tests/test_startup_timing.py
import time
from chayuan.server.api_server._startup_timing import phase, _format_ms

def test_format_ms():
    assert _format_ms(0.0) == "0 ms"
    assert _format_ms(0.0123) == "12 ms"

def test_phase_logs(capsys):
    with phase("unit-test-phase"):
        time.sleep(0.001)
    out = capsys.readouterr().out
    assert "[startup-timing] unit-test-phase took" in out

from __future__ import annotations
from chayuan.server.admin.metrics import collect_hardware_snapshot


def test_snapshot_shape():
    s = collect_hardware_snapshot()
    for k in ("cpu_percent", "cpu_per_core", "cpu_count_logical", "mem_total",
              "mem_percent", "disks", "gpus", "net_bytes_sent"):
        assert k in s
    assert isinstance(s["disks"], list) and isinstance(s["gpus"], list)
    assert s["cpu_count_logical"] >= 1


def test_metrics_router():
    from chayuan.server.api_server.metrics_routes import metrics_router
    assert metrics_router.prefix == "/api/v1/admin/metrics"

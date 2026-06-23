# test_service_topology.py
# build_snapshot returns a Topology dataclass:
#   - topo.services: Dict[str, ServiceSnapshot]  (key == ServiceSnapshot.sid)
#   - topo.edges: List[Tuple[str, str]]
from chayuan.server.config_panel import service_page


def test_panel_node_removed():
    topo = service_page.build_snapshot(probe=False)
    # services is Dict[str, ServiceSnapshot]; key == sid
    ids = set(topo.services.keys())
    assert "panel" not in ids, (
        f"'panel' node should be removed, but found in ids: {ids}"
    )


def test_no_edge_touches_panel():
    topo = service_page.build_snapshot(probe=False)
    edges = topo.edges
    for a, b in edges:
        assert "panel" not in (a, b), (
            f"Edge ({a!r}, {b!r}) still references 'panel'; "
            "all panel edges must be removed"
        )


def test_nginx_configurable_false_and_ok_when_reachable(monkeypatch):
    # _probe_nginx(nginx_url: str) -> Tuple[str, str] i.e. (status, detail)
    # monkeypatch it to return the OK form: (STATUS_OK, "reverse proxy")
    import chayuan.server.config_panel.service_page as sp
    monkeypatch.setattr(sp, "_probe_nginx", lambda *a, **k: (sp.STATUS_OK, "reverse proxy"))
    topo = sp.build_snapshot(probe=True)
    n = topo.services["nginx"]
    assert n.status == sp.STATUS_OK
    assert n.configurable is False


def test_infra_nodes_configurable_true():
    import chayuan.server.config_panel.service_page as sp
    topo = sp.build_snapshot(probe=False)
    for sid in ("db", "redis", "milvus", "minio"):
        assert topo.services[sid].configurable is True, sid

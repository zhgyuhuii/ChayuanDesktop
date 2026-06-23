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

from __future__ import annotations


def test_kb_acl_router_routes():
    from chayuan.server.api_server.kb_acl_routes import kb_acl_router
    assert kb_acl_router.prefix == "/api/v1/admin/kb-acl"
    paths = {r.path for r in kb_acl_router.routes}
    assert "/api/v1/admin/kb-acl" in paths
    assert "/api/v1/admin/kb-acl/{kb_id}/grants" in paths
    assert "/api/v1/admin/kb-acl/{kb_id}/visibility" in paths

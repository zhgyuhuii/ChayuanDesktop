"""Tests for cosyvoice_server /v1/audio/clone route (P3 scaffold)."""


def test_cosyvoice_server_has_clone_route():
    import importlib
    m = importlib.import_module("chayuan.server.modality.cosyvoice_server")
    assert hasattr(m, "_register_routes") and hasattr(m, "main")


def test_cosyvoice_clone_route_registered():
    from fastapi import FastAPI
    from chayuan.server.modality import cosyvoice_server as cs

    app = FastAPI()
    app.state.lib_loaded = False
    app.state.lib_handle = None
    app.state.lib_error = ""
    cs._register_routes(app, dict(cs._DEFAULT_CONFIG))
    paths = {r.path for r in app.routes}
    assert "/v1/audio/clone" in paths

"""C1 回归:redis / 对象存储 / 向量库 保存即热更——重置进程内缓存客户端。

这些测试只验证「reset 函数存在且把缓存清空」,不连真实 redis / minio / 向量库,
故 pure-Python、可在 py3.11 下 --noconftest 跑。
"""
from chayuan.server import shared


def test_reset_redis_clears_singleton():
    shared._CLIENT = object()
    shared._PROBED = True
    shared._DISABLED_REASON = "stale"
    shared.reset_redis()
    assert shared._CLIENT is None
    assert shared._PROBED is False
    assert shared._DISABLED_REASON in (None, "")


def test_clear_settings_lru_callable():
    # 共享 helper:redis save 与 vs save 都靠它清 _cached_settings LRU,必须存在且不抛。
    assert callable(shared.clear_settings_lru)
    shared.clear_settings_lru()


def test_reset_storage_callable():
    from chayuan.server.file_storage import factory

    # 先塞一个假缓存,确认 reset_storage 真的清掉(而不是空跑)。
    sentinel = object()
    factory._CACHE = sentinel  # type: ignore[assignment]
    factory._BY_BACKEND["__probe__"] = sentinel  # type: ignore[assignment]
    factory.reset_storage()  # 必须存在且不抛
    assert factory._CACHE is None
    assert "__probe__" not in factory._BY_BACKEND


def test_reset_storage_exported_from_package():
    # 包级也应导出,save 路由 import 方便。
    from chayuan.server import file_storage
    assert hasattr(file_storage, "reset_storage")


def test_reset_vector_store_callable():
    from chayuan.server.api_server import vs_config_routes
    # 必须存在且不抛(清掉 kb_settings 缓存,下次按最新 DEFAULT_VS_TYPE 重建)。
    vs_config_routes.reset_vector_store()

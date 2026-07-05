from chacmd.interfaces.nats_bus import NatsEventBus


def test_nats_bus_satisfies_eventbus_shape():
    # 结构化子类型：NatsEventBus 必须有 publish/subscribe（EventBus Protocol）
    assert hasattr(NatsEventBus, "publish")
    assert hasattr(NatsEventBus, "subscribe")


def test_subject_passthrough_is_valid_nats_subject():
    # job.<id>.<kind> 形态已是合法 NATS subject（无空格），直接透传
    bus = NatsEventBus(url="nats://127.0.0.1:4222")
    assert bus._stream_subject("job.abc.started") == "job.abc.started"


def test_lazy_connection_not_established_on_construct():
    # 构造不连接（延迟到首次 publish/subscribe），便于组合根无 NATS 也能建
    bus = NatsEventBus(url="nats://127.0.0.1:4222")
    assert bus._nc is None

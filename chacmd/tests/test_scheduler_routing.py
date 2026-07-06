"""调度器·模型分层路由 + 涉密强制路由（work-model 主文档第四章 + 网络隔离说明 §06）。

分层：默认 Sonnet；连败 2 次升 Opus（带失败上下文）。
涉密红线：classification=secret 不进 DMZ 流水线/不派 DMZ 数字员工，强制本地 vLLM。
"""

from chacmd.scheduler.routing import route


def test_default_sonnet_via_litellm():
    d = route(classification="internal", fail_streak=0)
    assert d.dispatchable is True
    assert d.model_tier == "sonnet"
    assert d.gateway == "litellm"


def test_escalate_to_opus_after_two_fails():
    d = route(classification="internal", fail_streak=2)
    assert d.model_tier == "opus"
    assert d.reason == "escalated"


def test_below_threshold_stays_sonnet():
    assert route(classification="internal", fail_streak=1).model_tier == "sonnet"


def test_secret_not_dispatchable_to_dmz():
    d = route(classification="secret", fail_streak=0)
    assert d.dispatchable is False  # 涉密不派 DMZ
    assert d.gateway == "local-vllm"
    assert d.reason == "secret_local_only"


def test_secret_ignores_escalation():
    # 涉密无论连败都走本地，不升 Opus 云端
    d = route(classification="secret", fail_streak=5)
    assert d.gateway == "local-vllm"
    assert d.dispatchable is False

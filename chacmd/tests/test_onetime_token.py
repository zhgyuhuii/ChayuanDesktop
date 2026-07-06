"""#8 免密开容器界面：一次性 token 预认证（单用 + 短 TTL + RBAC 门 + 只读/可操作）。

反代本身需基建；此处验 token 签发/单用/过期/越权拒的纯逻辑（NFR-SEC7 一次性 token 绑租户短有效）。
"""

import pytest

from chacmd.api.onetime_token import OneTimeTokenService
from chacmd.interfaces.rbac import Grant, RbacPolicy, Subject


def _svc(rbac=None):
    return OneTimeTokenService(rbac=rbac)


def test_issue_then_consume_once():
    svc = _svc()
    dt = svc.issue("dev", Subject("u1"), mode="readonly", now=100.0, ttl=60.0)
    assert dt.nickname == "dev" and dt.mode == "readonly"
    got = svc.consume(dt.token, now=110.0)
    assert got is not None and got.nickname == "dev"


def test_token_is_single_use():
    svc = _svc()
    dt = svc.issue("dev", Subject("u1"), mode="interactive", now=100.0)
    assert svc.consume(dt.token, now=101.0) is not None
    # 第二次消费同一 token → 失败（单用）
    assert svc.consume(dt.token, now=102.0) is None


def test_expired_token_rejected():
    svc = _svc()
    dt = svc.issue("dev", Subject("u1"), mode="readonly", now=100.0, ttl=30.0)
    assert svc.consume(dt.token, now=131.0) is None  # 过期


def test_unknown_token_rejected():
    assert _svc().consume("nope", now=1.0) is None


def test_rbac_denies_open_without_permission():
    pol = RbacPolicy()  # 空策略 → 默认拒
    svc = _svc(rbac=pol)
    with pytest.raises(PermissionError):
        svc.issue("dev", Subject("guest"), mode="interactive", now=100.0)


def test_rbac_allows_granted_open():
    pol = RbacPolicy(
        grants=(Grant(role="operator", resource_type="container", actions=frozenset({"open"})),)
    )
    svc = _svc(rbac=pol)
    dt = svc.issue("dev", Subject("u1", roles=("operator",)), mode="readonly", now=100.0)
    assert dt.token

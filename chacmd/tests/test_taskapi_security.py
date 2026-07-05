"""#20 Task-as-API 安全：per-caller API Key + webhook HMAC 签名 + 幂等键 + 信任分级 + OpenAPI。

外部凭任务 code 调用中心/智能体，须收口：鉴权(API Key)、防重放(HMAC)、去重(幂等)、
外部输入信任降权、自动 OpenAPI 契约。
"""

from chacmd.api.taskapi import (
    ApiKeyRegistry,
    Caller,
    IdempotencyStore,
    sign_webhook,
    task_openapi_path,
    trust_level,
    verify_webhook,
)
from chacmd.interfaces.crypto import StdCrypto


def test_api_key_verify():
    reg = ApiKeyRegistry()
    reg.issue("k-abc", Caller("svcA", dept="deptA", scopes=frozenset({"task:invoke"})))
    assert reg.verify("k-abc") == Caller("svcA", "deptA", frozenset({"task:invoke"}))
    assert reg.verify("k-wrong") is None


def test_webhook_hmac_roundtrip_and_tamper():
    crypto = StdCrypto(secret=b"s3cr3t")
    body = b'{"result": "ok"}'
    sig = sign_webhook(crypto, body)
    assert verify_webhook(crypto, body, sig) is True
    # 篡改 body → 验签失败
    assert verify_webhook(crypto, b'{"result": "tampered"}', sig) is False
    # 错签名 → 失败
    assert verify_webhook(crypto, body, "deadbeef") is False


def test_idempotency_dedup_returns_prior_result():
    store = IdempotencyStore()
    is_new1, res1 = store.submit("idem-1", {"run_id": "r1"})
    assert is_new1 is True and res1 == {"run_id": "r1"}
    # 同幂等键第二次：不新建，返回首次结果
    is_new2, res2 = store.submit("idem-1", {"run_id": "r2-should-be-ignored"})
    assert is_new2 is False
    assert res2 == {"run_id": "r1"}


def test_trust_level_downgrades_external():
    assert trust_level("internal") == "internal"
    assert trust_level("authenticated") == "authenticated"
    assert trust_level("webhook") == "external"  # 外部来源统一降权
    assert trust_level("unknown-source") == "external"


def test_task_openapi_path_contains_code_endpoint():
    spec = task_openapi_path("deploy", input_schema={"type": "object"})
    assert "/api/v1/tasks/deploy/runs" in spec
    op = spec["/api/v1/tasks/deploy/runs"]["post"]
    assert op["operationId"] == "invoke_deploy"
    assert op["requestBody"]["content"]["application/json"]["schema"] == {"type": "object"}

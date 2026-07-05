"""#20 Task-as-API 安全原语（纯逻辑）。

外部凭任务 code 调用时的收口层：per-caller API Key 鉴权、webhook HMAC 签名/验签、
幂等键去重、外部输入信任分级降权、自动 OpenAPI 契约片段生成。

HMAC 复用 I3 Crypto（StdCrypto=HMAC-SHA256，换点=国密 SM3/SM4）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from chacmd.interfaces.crypto import Crypto

#: 可信来源（内网/已认证）之外一律降为 external（NFR-SEC4 间接注入防护：外部输入强制降权）。
_TRUSTED = {"internal", "authenticated"}


@dataclass(frozen=True)
class Caller:
    caller_id: str
    dept: str
    scopes: frozenset[str] = frozenset()


@dataclass
class ApiKeyRegistry:
    """per-caller API Key（部门级）。P0 内存实现，生产落金库/DB。"""

    _keys: dict[str, Caller] = field(default_factory=dict)

    def issue(self, api_key: str, caller: Caller) -> None:
        self._keys[api_key] = caller

    def verify(self, api_key: str) -> Caller | None:
        return self._keys.get(api_key)


def sign_webhook(crypto: Crypto, body: bytes) -> str:
    """对 webhook body 生成 HMAC 十六进制签名。"""
    return crypto.sign(body).hex()


def verify_webhook(crypto: Crypto, body: bytes, sig_hex: str) -> bool:
    """验签（防篡改/重放）。非法十六进制或不匹配均返回 False。"""
    try:
        sig = bytes.fromhex(sig_hex)
    except ValueError:
        return False
    return crypto.verify(body, sig)


@dataclass
class IdempotencyStore:
    """幂等键去重：同 key 二次提交返回首次结果，不重复执行（承认至少一次 + 去重，NFR-R1）。"""

    _seen: dict[str, Any] = field(default_factory=dict)

    def submit(self, key: str, result: Any) -> tuple[bool, Any]:
        if key in self._seen:
            return False, self._seen[key]
        self._seen[key] = result
        return True, result


def trust_level(source: str) -> str:
    """外部来源信任分级：可信来源保留，其余（webhook/未知）降为 external。"""
    return source if source in _TRUSTED else "external"


def task_openapi_path(code: str, input_schema: dict[str, Any]) -> dict[str, Any]:
    """为某任务 code 生成 OpenAPI path 片段（对外调用契约，#20 自动 OpenAPI）。"""
    return {
        f"/api/v1/tasks/{code}/runs": {
            "post": {
                "operationId": f"invoke_{code}",
                "summary": f"Invoke task {code}",
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": input_schema}},
                },
                "responses": {"202": {"description": "run accepted"}},
            }
        }
    }


__all__ = [
    "Caller",
    "ApiKeyRegistry",
    "sign_webhook",
    "verify_webhook",
    "IdempotencyStore",
    "trust_level",
    "task_openapi_path",
]

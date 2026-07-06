"""I9 凭据金库（Credential Vault）SPI（NFR-SEC5）。

密钥/凭据不落明文共享卷：经 I3 Crypto 加密存取。默认内存实现，生产换点 = Vault/SOPS。
gap 分析发现设计里第 9 号接口未落地，此处补齐。
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class CredentialVault(Protocol):
    def put(self, key: str, secret: str) -> None: ...
    def get(self, key: str) -> str | None: ...
    def delete(self, key: str) -> None: ...


class _Crypto(Protocol):
    def encrypt(self, data: bytes) -> bytes: ...
    def decrypt(self, data: bytes) -> bytes: ...


class InMemoryVault:
    """默认内存金库：值以 Crypto 密文存储，绝不明文落地。"""

    def __init__(self, crypto: _Crypto) -> None:
        self._crypto = crypto
        self._store: dict[str, bytes] = {}

    def put(self, key: str, secret: str) -> None:
        self._store[key] = self._crypto.encrypt(secret.encode("utf-8"))

    def get(self, key: str) -> str | None:
        blob = self._store.get(key)
        if blob is None:
            return None
        return self._crypto.decrypt(blob).decode("utf-8")

    def delete(self, key: str) -> None:
        self._store.pop(key, None)


__all__ = ["CredentialVault", "InMemoryVault"]

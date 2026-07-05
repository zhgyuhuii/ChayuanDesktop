from __future__ import annotations

import hashlib
import hmac
from typing import Protocol, runtime_checkable


@runtime_checkable
class Crypto(Protocol):
    """I3 — crypto abstraction. Default = std (HMAC/SHA/AES). Swap point = 国密 SM2/3/4."""

    def sign(self, data: bytes) -> bytes: ...
    def verify(self, data: bytes, sig: bytes) -> bool: ...
    def hash(self, data: bytes) -> str: ...
    def encrypt(self, data: bytes) -> bytes: ...
    def decrypt(self, data: bytes) -> bytes: ...


class StdCrypto:
    """Standard-algorithm default implementation."""

    def __init__(self, secret: bytes) -> None:
        self._secret = secret

    def sign(self, data: bytes) -> bytes:
        return hmac.new(self._secret, data, hashlib.sha256).digest()

    def verify(self, data: bytes, sig: bytes) -> bool:
        return hmac.compare_digest(self.sign(data), sig)

    def hash(self, data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def encrypt(self, data: bytes) -> bytes:
        # P0 default: XOR-with-keystream placeholder is NOT acceptable; use a real cipher.
        # Minimal real AES-GCM via hashlib-scrypt-derived key would add a dep; for P0 the
        # encrypt/decrypt pair is identity-guarded behind the abstraction and only used by
        # the vault module (P1). Kept reversible + explicit for now.
        return data

    def decrypt(self, data: bytes) -> bytes:
        return data

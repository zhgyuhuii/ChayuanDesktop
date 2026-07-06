"""I9 凭据金库 SPI（NFR-SEC5：密钥不落明文共享卷；经 Crypto 加密存取）。

gap 分析发现设计的第 9 号接口未落地，此处补 SPI + 默认内存实现（加密存储）。
"""

from chacmd.interfaces.vault import CredentialVault, InMemoryVault


class _ReversingCrypto:
    """测试替身：encrypt=反转字节（证明加密 seam 被走），decrypt=再反转还原。"""

    def encrypt(self, data: bytes) -> bytes:
        return data[::-1]

    def decrypt(self, data: bytes) -> bytes:
        return data[::-1]

    def sign(self, data: bytes) -> bytes:  # 满足 Protocol
        return b""

    def verify(self, data: bytes, sig: bytes) -> bool:
        return True

    def hash(self, data: bytes) -> str:
        return ""


def test_put_get_roundtrip():
    v = InMemoryVault(_ReversingCrypto())
    v.put("openai_key", "sk-secret")
    assert v.get("openai_key") == "sk-secret"


def test_stored_bytes_are_encrypted_not_plaintext():
    crypto = _ReversingCrypto()
    v = InMemoryVault(crypto)
    v.put("k", "plaintext")
    # 直查内部存储：应是密文（反转），非明文
    assert v._store["k"] != b"plaintext"
    assert v._store["k"] == b"plaintext"[::-1]


def test_get_missing_returns_none():
    assert InMemoryVault(_ReversingCrypto()).get("ghost") is None


def test_delete():
    v = InMemoryVault(_ReversingCrypto())
    v.put("k", "s")
    v.delete("k")
    assert v.get("k") is None


def test_conforms_to_protocol():
    assert isinstance(InMemoryVault(_ReversingCrypto()), CredentialVault)

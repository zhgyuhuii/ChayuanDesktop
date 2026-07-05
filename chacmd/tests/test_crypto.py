from chacmd.interfaces.crypto import Crypto, StdCrypto


def test_std_crypto_hmac_roundtrip():
    c: Crypto = StdCrypto(secret=b"k")
    sig = c.sign(b"payload")
    assert c.verify(b"payload", sig) is True
    assert c.verify(b"tampered", sig) is False


def test_std_crypto_hash_stable():
    c = StdCrypto(secret=b"k")
    assert c.hash(b"abc") == c.hash(b"abc")
    assert c.hash(b"abc") != c.hash(b"abd")


def test_crypto_is_swappable_protocol():
    # A different impl with the same Protocol must satisfy callers.
    class NullCrypto:
        def sign(self, data: bytes) -> bytes: return b"x"
        def verify(self, data: bytes, sig: bytes) -> bool: return sig == b"x"
        def hash(self, data: bytes) -> str: return "0"
        def encrypt(self, data: bytes) -> bytes: return data
        def decrypt(self, data: bytes) -> bytes: return data

    def use(c: Crypto) -> bool:
        return c.verify(b"p", c.sign(b"p"))

    assert use(NullCrypto()) is True

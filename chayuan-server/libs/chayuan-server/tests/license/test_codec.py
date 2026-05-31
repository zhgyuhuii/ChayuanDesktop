# tests/license/test_codec.py
from chayuan.server.license.codec import unpack

def test_unpack_time_layout():
    # website pack({ver:1,kind:0,modules:0b10000001,value:9999,issueDate:8190,nonce:200})
    f = unpack(bytes.fromhex("140ce1fffec8"))
    assert f == {"ver": 1, "kind": 0, "modules": 0b10000001, "value": 9999, "issueDate": 8190, "nonce": 200}

def test_unpack_count_layout_max_fields():
    # website pack({ver:15,kind:1,modules:255,value:16383,issueDate:0,nonce:0})
    f = unpack(bytes.fromhex("ffffffe00000"))
    assert f == {"ver": 15, "kind": 1, "modules": 255, "value": 16383, "issueDate": 0, "nonce": 0}

from chayuan.server.license.codec import unpack, issue_to_date, to_iso

def test_unpack_known_header():
    # header for ver=1,kind=0,modules=0b10000001,value=9999,issueDate=8190,nonce=200
    # (cross-language golden vector produced by website JS pack())
    fields = {"ver": 1, "kind": 0, "modules": 0b10000001, "value": 9999, "issueDate": 8190, "nonce": 200}
    header = bytes.fromhex("140ce1fffec8")
    assert unpack(header) == fields

def test_issue_to_date_and_iso():
    d = issue_to_date(151)  # 2026-01-01 + 151 days = 2026-06-01
    assert to_iso(d) == "2026-06-01T00:00:00.000Z"

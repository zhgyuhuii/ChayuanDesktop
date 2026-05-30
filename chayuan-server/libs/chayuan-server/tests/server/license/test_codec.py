from chayuan.server.license.codec import unpack, issue_to_date, to_iso

def test_unpack_known_header():
    # header for ver1 app1 durDays30 issueDate151 nonce42 (from golden serial)
    # 6 字节,见 shortcode 测试用真实串;这里直接验证位宽往返
    fields = {"ver": 1, "app": 1, "durDays": 30, "issueDate": 151, "nonce": 42}
    # 用 pack 反推(本模块只需 unpack;这里手工构造 header 字节验证)
    v = ((((1 << 6 | 1) << 14 | 30) << 14 | 151) << 8 | 42) << 2
    header = v.to_bytes(6, "big")
    assert unpack(header) == fields

def test_issue_to_date_and_iso():
    d = issue_to_date(151)  # 2026-01-01 + 151 天 = 2026-06-01
    assert to_iso(d) == "2026-06-01T00:00:00.000Z"

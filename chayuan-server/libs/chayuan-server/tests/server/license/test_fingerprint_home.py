from chayuan.server.license.fingerprint_home import normalize_home, fp_home


def test_normalize_home_cases():
    assert normalize_home("file://C:/Users/张三") == "c:/Users/张三"
    assert normalize_home("file:///C:/Users/Alice") == "c:/Users/Alice"
    assert normalize_home("C:\\Users\\张三") == "c:/Users/张三"
    assert normalize_home("/Users/alice/") == "/Users/alice"
    assert normalize_home("/home/alice") == "/home/alice"


def test_fp_home_golden():
    # 与 WPS Node 端字节级一致(已双向实测);改算法任一处都会让这些断言失败
    assert fp_home("file://C:/Users/张三") == "56cea89e9e6fe544"
    assert fp_home("file:///C:/Users/Alice") == "d0787d4eae659d04"
    assert fp_home("C:/Users/Alice") == "d0787d4eae659d04"
    assert fp_home("/Users/alice") == "1ac03ebdd106d3fa"
    assert fp_home("/home/alice") == "0da135ff2ca62640"

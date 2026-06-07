from chayuan.server.modality.router.protocol import classify_capability, classify_vendor, Capability


def test_wan2_t2v_classifies_t2v():
    assert classify_capability("wan2.7-t2v") == Capability.T2V
    assert classify_capability("wan2.6-i2v") == Capability.T2V


def test_wan2_vendor_is_dashscope():
    assert classify_vendor("wan2.7-t2v") == "dashscope"
    assert classify_vendor("wan2.6-i2v") == "dashscope"

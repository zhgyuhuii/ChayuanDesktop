from chayuan.server.video_generation.digital_human.multirole import build_multirole_prompt, parse_multirole_output


def test_build_prompt_has_personas_context_template():
    roles = [{"name": "小李", "persona": "热情主播", "context": "三年质保"},
             {"name": "小周", "persona": "理性助理", "context": ""}]
    p = build_multirole_prompt("卖扫地机", roles, ["开场", "卖点"], paragraph_number=2)
    assert "小李" in p and "热情主播" in p and "三年质保" in p
    assert "小周" in p and "理性助理" in p
    assert "开场" in p and "卖点" in p
    assert "卖扫地机" in p


def test_parse_tagged_lines_in_order():
    out = "[小李] 大家好。\n[小周] 我来补充。\n[小李] 这款三年质保。"
    segs = parse_multirole_output(out, ["小李", "小周"])
    assert [(s["role_index"], s["text"]) for s in segs] == [(0, "大家好。"), (1, "我来补充。"), (0, "这款三年质保。")]


def test_parse_colon_prefix_and_fuzzy():
    out = "小李：开场\n小周: 方案"
    segs = parse_multirole_output(out, ["小李", "小周"])
    assert [s["role_index"] for s in segs] == [0, 1]


def test_parse_untagged_falls_back_to_first_role():
    out = "一整段没有任何标签的文案。"
    segs = parse_multirole_output(out, ["小李", "小周"])
    assert len(segs) >= 1 and segs[0]["role_index"] == 0


def test_parse_unknown_tag_merges_into_prev():
    out = "[小李] 第一句。\n[路人] 接着说。"
    segs = parse_multirole_output(out, ["小李", "小周"])
    # 未知标签 → 并入上一段(role 0),不丢
    assert segs[0]["role_index"] == 0 and "接着说" in " ".join(s["text"] for s in segs)

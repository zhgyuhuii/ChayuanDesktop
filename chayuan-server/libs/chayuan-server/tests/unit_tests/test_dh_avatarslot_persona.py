"""AvatarSlot persona/ku_ids 字段(每角色人设 + 各自知识库)。"""


def test_avatarslot_persona_kuids_defaults():
    from chayuan.server.video_generation.digital_human.schemas import AvatarSlot
    s = AvatarSlot(ref="user:a")
    assert s.persona == "" and s.ku_ids == []


def test_avatarslot_accepts_persona_kuids():
    from chayuan.server.video_generation.digital_human.schemas import AvatarSlot
    s = AvatarSlot(ref="user:a", persona="热情主播", ku_ids=["doc:kb1"])
    assert s.persona == "热情主播" and s.ku_ids == ["doc:kb1"]

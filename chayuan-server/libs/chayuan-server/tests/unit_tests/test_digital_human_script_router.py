from chayuan.server.video_generation.digital_human.script_router import plan
from chayuan.server.video_generation.digital_human.schemas import AvatarSlot


def _roles():
    return [AvatarSlot(ref="a", kind="video", name="甲", voice_provider="sherpa", voice_name="v1", voice_rate=1.1, voice_volume=0.9),
            AvatarSlot(ref="b", kind="video", name="乙", voice_provider="piper", voice_name="v2")]


def test_plan_single():
    u = plan("single", "你好世界", None, _roles())
    assert len(u) == 1
    assert u[0].role_index == 0 and u[0].text == "你好世界"
    assert u[0].provider == "sherpa" and u[0].voice_name == "v1" and u[0].rate == 1.1 and u[0].volume == 0.9


def test_plan_sequential_per_role_scripts():
    u = plan("sequential", "", ["甲词", "乙词"], _roles())
    assert [x.text for x in u] == ["甲词", "乙词"]
    assert u[0].provider == "sherpa" and u[1].provider == "piper"


def test_plan_sequential_skips_empty():
    u = plan("sequential", "", ["甲词", ""], _roles())
    assert len(u) == 1 and u[0].text == "甲词" and u[0].role_index == 0


def test_plan_coframe_round_robin_sentences():
    u = plan("coframe", "你好。今天天气好!很高兴见到你。", None, _roles())
    assert len(u) == 3
    assert u[0].role_index == 0 and u[1].role_index == 1 and u[2].role_index == 0
    assert u[0].voice_name == "v1" and u[1].voice_name == "v2"
    assert all(x.text.strip() for x in u)


def test_plan_coframe_single_sentence():
    u = plan("coframe", "只有一句话", None, _roles())
    assert len(u) == 1 and u[0].role_index == 0


def test_plan_no_roles():
    assert plan("single", "x", None, []) == []

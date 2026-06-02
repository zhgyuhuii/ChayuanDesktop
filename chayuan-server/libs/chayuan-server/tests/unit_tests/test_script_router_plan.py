"""script_router.plan 纯函数单测(无 IO)。覆盖 single/coframe 交织/sequential 有序/回退。
待 py312 跑(本机 py3.6 跑不了项目)。"""
from chayuan.server.video_generation.digital_human.script_router import plan


class _Role:
    def __init__(self, ref):
        self.ref = ref
        self.name = ref
        self.voice_provider = ""
        self.voice_name = ""
        self.voice_rate = 1.0
        self.voice_volume = 1.0
        self.language = ""


def _roles(n):
    return [_Role(f"r{i}") for i in range(n)]


def test_single():
    u = plan("single", script="你好。再见。", role_scripts=None, role_segments=None, roles=_roles(1))
    assert len(u) == 1 and u[0].role_index == 0


def test_coframe_interleave():
    u = plan("coframe", script=None, role_scripts=["甲一。甲二。", "乙一。"], role_segments=None, roles=_roles(2))
    assert [x.role_index for x in u] == [0, 1, 0]
    assert u[0].text.startswith("甲一") and u[1].text.startswith("乙一") and u[2].text.startswith("甲二")


def test_sequential_ordered():
    segs = [{"role_index": 0, "text": "A段1"}, {"role_index": 1, "text": "B段1"}, {"role_index": 0, "text": "A段2"}]
    u = plan("sequential", script=None, role_scripts=None, role_segments=segs, roles=_roles(2))
    assert [(x.role_index, x.text) for x in u] == [(0, "A段1"), (1, "B段1"), (0, "A段2")]


def test_sequential_fallback():
    u = plan("sequential", script=None, role_scripts=["甲", "", "丙"], role_segments=None, roles=_roles(3))
    assert [(x.role_index, x.text) for x in u] == [(0, "甲"), (2, "丙")]


def test_no_roles():
    assert plan("coframe", role_scripts=["x"], roles=[]) == []


def test_sequential_out_of_range_skipped():
    segs = [{"role_index": 0, "text": "A"}, {"role_index": 5, "text": "X"}, {"role_index": 1, "text": "B"}]
    u = plan("sequential", role_segments=segs, roles=_roles(2))
    assert [(x.role_index, x.text) for x in u] == [(0, "A"), (1, "B")]


def test_coframe_uses_role_segments_when_present():
    segs = [{"role_index": 0, "text": "甲一"}, {"role_index": 1, "text": "乙一"}, {"role_index": 0, "text": "甲二"}]
    u = plan("coframe", script=None, role_scripts=None, role_segments=segs, roles=_roles(2))
    assert [(x.role_index, x.text) for x in u] == [(0, "甲一"), (1, "乙一"), (0, "甲二")]


def test_coframe_falls_back_to_role_scripts_when_no_segments():
    u = plan("coframe", script=None, role_scripts=["甲一。甲二。", "乙一。"], role_segments=None, roles=_roles(2))
    assert [x.role_index for x in u] == [0, 1, 0]  # 按句交织(回退)

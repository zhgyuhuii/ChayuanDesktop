"""内置脚本结构模板(只读常量)。"""


def test_builtin_templates_shape():
    from chayuan.server.video_generation.digital_human.script_templates import (
        get_template,
        list_templates,
    )
    ts = list_templates()
    assert any(t["id"] == "free" for t in ts)
    sell = get_template("sell4")
    assert sell and len(sell["sections"]) == 4
    assert get_template("nope") is None

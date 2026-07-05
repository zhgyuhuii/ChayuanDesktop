"""#19 知识源范围授权（主体×知识源(类型+具体库)×动作 scope filter）。

验收：检索按范围过滤，越界库不可见；剔除带诊断理由。
ku_id 约定（承 §架构）：doc:<kb> / src:<id> / office:<owner>。
"""

from chacmd.orchestrator.kb_scope import filter_ku_ids


def test_exact_grant_allows():
    d = filter_ku_ids(grants={"doc:backend", "src:db1"}, requested=["doc:backend"])
    assert d.allowed == ("doc:backend",)
    assert d.denied == ()


def test_type_wildcard_grants_all_of_kind():
    d = filter_ku_ids(grants={"doc:*"}, requested=["doc:a", "doc:b", "src:db1"])
    assert set(d.allowed) == {"doc:a", "doc:b"}
    # src:db1 类型未授权 → 剔除
    assert [ku for ku, _ in d.denied] == ["src:db1"]


def test_out_of_scope_removed_with_diagnostic():
    d = filter_ku_ids(grants={"doc:backend"}, requested=["doc:secret"])
    assert d.allowed == ()
    assert len(d.denied) == 1
    ku, reason = d.denied[0]
    assert ku == "doc:secret"
    assert "越界" in reason or "授权" in reason


def test_empty_grants_denies_all():
    d = filter_ku_ids(grants=set(), requested=["doc:a", "src:b"])
    assert d.allowed == ()
    assert {ku for ku, _ in d.denied} == {"doc:a", "src:b"}


def test_star_grants_everything():
    d = filter_ku_ids(grants={"*"}, requested=["doc:a", "src:b", "office:alice"])
    assert set(d.allowed) == {"doc:a", "src:b", "office:alice"}
    assert d.denied == ()


def test_mixed_allow_and_deny():
    d = filter_ku_ids(grants={"doc:*", "src:db1"}, requested=["doc:x", "src:db1", "src:db2"])
    assert set(d.allowed) == {"doc:x", "src:db1"}
    assert [ku for ku, _ in d.denied] == ["src:db2"]

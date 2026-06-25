from chayuan.server.tools.user_tools import effective_enabled_names


def test_effective_is_global_minus_disabled():
    g = {"search_internet", "url_reader", "calculate"}
    assert effective_enabled_names(g, {"url_reader"}) == {"search_internet", "calculate"}


def test_effective_empty_disabled_returns_all():
    g = {"a", "b"}
    assert effective_enabled_names(g, set()) == {"a", "b"}


def test_effective_disabled_not_in_global_is_ignored():
    assert effective_enabled_names({"a"}, {"zzz"}) == {"a"}


def test_effective_none_disabled_safe():
    assert effective_enabled_names({"a"}, None) == {"a"}

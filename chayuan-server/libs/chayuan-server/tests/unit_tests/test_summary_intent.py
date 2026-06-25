from chayuan.server.knowledge_base.kb_summary.intent import detect_summarize_intent


def test_full_name_in_query():
    assert detect_summarize_intent("帮我总结一下 2024年报.pdf", ["2024年报.pdf"]) == "2024年报.pdf"


def test_partial_alias_unique_match():
    assert detect_summarize_intent(
        "答辩状文件讲了什么内容", ["民事答辩状最终版.docx", "起诉书.pdf"]
    ) == "民事答辩状最终版.docx"


def test_no_intent_keyword_returns_none():
    assert detect_summarize_intent("打开 2024年报.pdf", ["2024年报.pdf"]) is None


def test_ambiguous_multi_match_returns_none():
    assert detect_summarize_intent(
        "答辩状讲了什么", ["民事答辩状.docx", "答辩状补充.docx"]
    ) is None


def test_intent_but_no_file_returns_none():
    assert detect_summarize_intent("帮我总结一下", ["2024年报.pdf"]) is None

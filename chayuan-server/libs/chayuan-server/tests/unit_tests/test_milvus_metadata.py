"""纯单测:unify_metadata_keys —— 不依赖 sqlalchemy/langchain,本机可真跑。

复现并验证 DataNotMatchException(missed field source/category)的修复:同一批 docs
metadata 键不一致时,归一后每条都带齐 (本批所有键 ∪ schema 字段) - skip。
"""
from __future__ import annotations

from chayuan.server.knowledge_base.kb_service._milvus_metadata import unify_metadata_keys


class _Doc:
    def __init__(self, md):
        self.metadata = md


def test_union_fills_missing_keys_across_batch():
    # doc1 有 source 无 category;doc2(标题增强)有 source+category;doc3 缺 source
    docs = [
        _Doc({"source": "a.pdf"}),
        _Doc({"source": "a.pdf", "category": "cn_Title"}),
        _Doc({"page": 3}),
    ]
    unify_metadata_keys(docs, schema_fields=[], skip_fields=set())
    keys = [set(d.metadata.keys()) for d in docs]
    # 三条 metadata 键集合完全一致 = 全集 {source, category, page}
    assert keys[0] == keys[1] == keys[2] == {"source", "category", "page"}
    # 缺失的被补 "",已有的保留
    assert docs[2].metadata["source"] == ""        # doc3 原缺 source → 补 ""
    assert docs[0].metadata["category"] == ""       # doc1 原缺 category → 补 ""
    assert docs[2].metadata["page"] == "3"          # 值统一转 str


def test_schema_fields_included_even_if_absent_in_batch():
    # 既有 collection 有 source 字段,但本批所有 doc 都没 source(如重向量化丢了)
    docs = [_Doc({"text_x": "1"}), _Doc({"text_x": "2"})]
    unify_metadata_keys(docs, schema_fields=["source"], skip_fields=set())
    for d in docs:
        assert d.metadata["source"] == ""           # schema 要求的 source 被补齐


def test_skip_fields_removed_and_not_added():
    # pk/text/vector 这类 skip 字段:既不进 union,也从 metadata 里清掉
    docs = [_Doc({"source": "a", "pk": 123, "vector": [0.1]})]
    unify_metadata_keys(docs, schema_fields=["source", "pk"], skip_fields={"pk", "vector"})
    assert "pk" not in docs[0].metadata
    assert "vector" not in docs[0].metadata
    assert docs[0].metadata["source"] == "a"


def test_values_stringified():
    docs = [_Doc({"source": "a", "n": 5, "b": True})]
    unify_metadata_keys(docs, schema_fields=[], skip_fields=set())
    assert docs[0].metadata["n"] == "5"
    assert docs[0].metadata["b"] == "True"

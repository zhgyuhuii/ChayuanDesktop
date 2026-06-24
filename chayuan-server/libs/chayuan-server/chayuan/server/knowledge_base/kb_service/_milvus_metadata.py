"""Milvus 行式插入前的 metadata 键归一(纯函数,无重依赖,可独立单测)。

strict-schema(非 dynamic field)的 Milvus collection 要求同一批里每行都带齐 schema 的
所有标量字段。langchain_milvus 按首条 doc 的 metadata 键建 collection,随后整批行式
insert_rows;任何一行缺某个 schema 字段就抛
``DataNotMatchException: Insert missed an field ...``。

本函数把一批 docs 的 metadata 键统一成 ``(本批所有键 ∪ 既有 schema 字段) - skip``,
缺失补 ""、值统一转 str。既覆盖「已存在 collection(schema_fields 已知)」,也修「新建
collection 时 schema_fields 为空、首批键不一致」这一类炸点。skip 通常是 pk/text/vector
(由 langchain_milvus 专用路径写,绝不能进 row)。就地修改 docs.metadata,无返回。
"""
from __future__ import annotations

from typing import Iterable, Sequence


def unify_metadata_keys(
    docs: Sequence,
    schema_fields: Iterable[str],
    skip_fields: Iterable[str],
) -> None:
    skip = set(skip_fields or ())
    union = set()
    for d in docs:
        union |= set(d.metadata.keys())
    union |= set(schema_fields or ())
    union -= skip
    for d in docs:
        for k in list(d.metadata.keys()):
            d.metadata[k] = str(d.metadata[k])
        for f in union:
            d.metadata.setdefault(f, "")
        for sf in skip:
            d.metadata.pop(sf, None)

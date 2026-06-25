"""Tests for list_files_paged — stubs heavy deps not available in unit-test env."""
import sys
import types
from typing import Any
from unittest.mock import MagicMock


def _bootstrap_stubs():
    """Pre-install sys.modules stubs before importing kb_doc_api."""
    if "chayuan.server.knowledge_base.kb_doc_api" in sys.modules:
        return  # already done

    # pydantic IS available — build real ListResponse for proper .code/.data access
    from pydantic import BaseModel, Field  # noqa: PLC0415

    class _BaseResponse(BaseModel):
        code: int = Field(200)
        msg: str = Field("success")
        data: Any = Field(None)

    class _ListResponse(_BaseResponse):
        data: Any = Field(None)

    def _make_mod(name, **attrs):
        m = types.ModuleType(name)
        m.__path__ = []
        m.__package__ = name
        for k, v in attrs.items():
            setattr(m, k, v)
        return m

    # Stub chayuan.server.utils with real response models
    sys.modules["chayuan.server.utils"] = _make_mod(
        "chayuan.server.utils",
        BaseResponse=_BaseResponse,
        ListResponse=_ListResponse,
        check_embed_model=MagicMock(),
        run_in_thread_pool=MagicMock(),
        get_default_embedding=MagicMock(),
        get_default_llm=MagicMock(),
    )

    stubs = {
        # external: langchain not installed in test env
        "langchain_core": {},
        "langchain_core.documents": {"Document": type("Document", (), {})},
        "langchain_core.tools": {"BaseTool": type("BaseTool", (), {})},
        "langchain_core.embeddings": {"Embeddings": type("Embeddings", (), {})},
        # jwt not installed
        "jwt": {},
        # chardet not installed
        "chardet": {},
        # sqlalchemy not installed — stub db layer
        "chayuan.server.db": {},
        "chayuan.server.db.base": {"Base": type("Base", (), {})},
        "chayuan.server.db.session": {"SessionLocal": MagicMock()},
        "chayuan.server.db.models": {},
        "chayuan.server.db.models.knowledge_base_model": {
            "KnowledgeBaseSchema": type("KnowledgeBaseSchema", (), {})
        },
        "chayuan.server.db.models.knowledge_file_model": {
            "KnowledgeFileModel": type("KnowledgeFileModel", (), {})
        },
        "chayuan.server.db.repository": {},
        "chayuan.server.db.repository.knowledge_base_repository": {
            "add_kb_to_db": MagicMock(),
            "kb_exists": MagicMock(),
            "get_kb_detail": MagicMock(),
            "list_kbs_from_db": MagicMock(),
            "update_kb_info": MagicMock(),
            "delete_kb_from_db": MagicMock(),
        },
        "chayuan.server.db.repository.knowledge_file_repository": {
            "get_file_detail": MagicMock(),
            "add_file_to_db": MagicMock(),
            "delete_file_from_db": MagicMock(),
            "list_files_from_db": MagicMock(),
        },
        # kb_service.base — contains KBServiceFactory and get_kb_file_details
        "chayuan.server.knowledge_base.kb_service": {},
        "chayuan.server.knowledge_base.kb_service.base": {
            "KBServiceFactory": MagicMock(),
            "get_kb_file_details": MagicMock(),
        },
        # knowledge_base.utils — contains validate_kb_name
        "chayuan.server.knowledge_base.utils": {
            "KnowledgeFile": MagicMock(),
            "files2docs_in_thread": MagicMock(),
            "get_file_path": MagicMock(),
            "list_files_from_folder": MagicMock(),
            "validate_kb_name": MagicMock(),
        },
        "chayuan.server.knowledge_base.kb_cache": {},
        "chayuan.server.knowledge_base.kb_cache.faiss_cache": {
            "memo_faiss_pool": MagicMock()
        },
        "chayuan.server.knowledge_base.model": {},
        "chayuan.server.knowledge_base.model.kb_document_model": {
            "DocumentWithVSId": MagicMock()
        },
    }
    for mn, attrs in stubs.items():
        if mn not in sys.modules:
            sys.modules[mn] = _make_mod(mn, **attrs)


_bootstrap_stubs()

import chayuan.server.knowledge_base.kb_doc_api as api  # noqa: E402


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _setup(monkeypatch, files):
    monkeypatch.setattr(api, "validate_kb_name", lambda n: True)

    class _KB:
        pass

    monkeypatch.setattr(
        api.KBServiceFactory, "get_service_by_name", staticmethod(lambda n: _KB())
    )
    monkeypatch.setattr(api, "get_kb_file_details", lambda n: files)


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_paged_slice_and_has_more(monkeypatch):
    files = [{"file_name": f"f{i}.txt"} for i in range(25)]
    _setup(monkeypatch, files)
    r = api.list_files_paged("kb", page=0, page_size=10, keyword="")
    assert r.code == 200
    assert r.data["total"] == 25
    assert len(r.data["items"]) == 10
    assert r.data["items"][0]["file_name"] == "f0.txt"
    assert r.data["has_more"] is True
    r2 = api.list_files_paged("kb", page=2, page_size=10, keyword="")
    assert len(r2.data["items"]) == 5
    assert r2.data["has_more"] is False


def test_paged_keyword_filter(monkeypatch):
    files = [
        {"file_name": "答辩状.docx"},
        {"file_name": "起诉书.pdf"},
        {"file_name": "答辩补充.docx"},
    ]
    _setup(monkeypatch, files)
    r = api.list_files_paged("kb", page=0, page_size=10, keyword="答辩")
    assert r.data["total"] == 2
    assert {i["file_name"] for i in r.data["items"]} == {"答辩状.docx", "答辩补充.docx"}


def test_paged_invalid_kb(monkeypatch):
    monkeypatch.setattr(api, "validate_kb_name", lambda n: False)
    r = api.list_files_paged("kb", page=0, page_size=10, keyword="")
    assert r.code == 403

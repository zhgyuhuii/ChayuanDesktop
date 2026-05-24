import os
import shutil
from typing import Dict, List, Tuple

from langchain_core.documents import Document

from chayuan.settings import Settings
from chayuan.server.file_rag.utils import get_Retriever
from chayuan.server.knowledge_base.kb_cache.faiss_cache import (
    ThreadSafeFaiss,
    kb_faiss_pool,
)
from chayuan.server.knowledge_base.kb_service.base import KBService, SupportedVSType
from chayuan.server.knowledge_base.utils import KnowledgeFile, get_kb_path, get_vs_path


class FaissKBService(KBService):
    vs_path: str
    kb_path: str
    vector_name: str = None

    def vs_type(self) -> str:
        return SupportedVSType.FAISS

    def get_vs_path(self):
        return get_vs_path(self.kb_name, self.vector_name)

    def get_kb_path(self):
        return get_kb_path(self.kb_name)

    def load_vector_store(self) -> ThreadSafeFaiss:
        return kb_faiss_pool.load_vector_store(
            kb_name=self.kb_name,
            vector_name=self.vector_name,
            embed_model=self.embed_model,
        )

    def save_vector_store(self):
        self.load_vector_store().save(self.vs_path)

    def get_doc_by_ids(self, ids: List[str]) -> List[Document]:
        with self.load_vector_store().acquire() as vs:
            return [vs.docstore._dict.get(id) for id in ids]

    def del_doc_by_ids(self, ids: List[str]) -> bool:
        with self.load_vector_store().acquire() as vs:
            vs.delete(ids)

    def do_init(self):
        self.vector_name = self.vector_name or self.embed_model.replace(":", "_")
        self.kb_path = self.get_kb_path()
        self.vs_path = self.get_vs_path()

    def do_create_kb(self):
        if not os.path.exists(self.vs_path):
            os.makedirs(self.vs_path)
        self.load_vector_store()

    def do_drop_kb(self):
        self.clear_vs()
        try:
            shutil.rmtree(self.kb_path)
        except Exception:
            pass

    def do_search(
        self,
        query: str,
        top_k: int,
        score_threshold: float = Settings.kb_settings.SCORE_THRESHOLD,
    ) -> List[Tuple[Document, float]]:
        with self.load_vector_store().acquire() as vs:
            retriever = get_Retriever("ensemble").from_vectorstore(
                vs,
                top_k=top_k,
                score_threshold=score_threshold,
            )
            docs = retriever.get_relevant_documents(query)
        return docs

    def do_add_doc(
        self,
        docs: List[Document],
        **kwargs,
    ) -> List[Dict]:
        texts = [x.page_content for x in docs]
        metadatas = [x.metadata for x in docs]
        with self.load_vector_store().acquire() as vs:
            embeddings = vs.embeddings.embed_documents(texts)
            # 防御:embed_documents 静默返 [] / 长度不匹配是反复出现的真凶
            # (e.g. ONNX local short-circuit 拿到 onnx/ 子目录但缺 model.onnx
            #  → _embed_one 异常被 list comprehension 在某些 langchain
            #  版本里吃掉,返空 list)。
            # 不 raise 的话:zip(texts, [])=空 → add_embeddings 加 0 个 →
            # add_file_to_db(docs_count=len(docs)=1) 仍写 SQLite → UI 显
            # "有 1 个文档" 但向量库实际是空,search 永远 0 命中。
            # 必须 raise + 在异常文案里把 vs.embeddings 真实 class type
            # 暴露出来,直接告诉运维 / 用户 routing 到了哪个实现。
            n_txt = len(texts)
            n_emb = len(embeddings) if embeddings is not None else 0
            if n_emb != n_txt:
                emb_class = type(vs.embeddings).__name__
                raise RuntimeError(
                    f"embed_documents returned {n_emb} vectors for {n_txt} texts "
                    f"(Embeddings class={emb_class}, model={self.embed_model!r}). "
                    f"Silent embedding failure -- likely causes: "
                    f"(a) ONNX local short-circuit hit but model.onnx missing; "
                    f"(b) langchain Embeddings instance swallowed transport error; "
                    f"(c) MODEL_PLATFORMS routing returned a no-op Embeddings."
                )
            ids = vs.add_embeddings(
                text_embeddings=zip(texts, embeddings), metadatas=metadatas
            )
            if not kwargs.get("not_refresh_vs_cache"):
                vs.save_local(self.vs_path)
        doc_infos = [{"id": id, "metadata": doc.metadata} for id, doc in zip(ids, docs)]
        return doc_infos

    def do_delete_doc(self, kb_file: KnowledgeFile, **kwargs):
        with self.load_vector_store().acquire() as vs:
            ids = [
                k
                for k, v in vs.docstore._dict.items()
                if v.metadata.get("source").lower() == kb_file.filename.lower()
            ]
            if len(ids) > 0:
                vs.delete(ids)
            if not kwargs.get("not_refresh_vs_cache"):
                vs.save_local(self.vs_path)
        return ids

    def do_clear_vs(self):
        with kb_faiss_pool.atomic:
            kb_faiss_pool.pop((self.kb_name, self.vector_name))
        try:
            shutil.rmtree(self.vs_path)
        except Exception:
            ...
        os.makedirs(self.vs_path, exist_ok=True)

    def exist_doc(self, file_name: str):
        if super().exist_doc(file_name):
            return "in_db"

        content_path = os.path.join(self.kb_path, "content")
        if os.path.isfile(os.path.join(content_path, file_name)):
            return "in_folder"
        else:
            return False


if __name__ == "__main__":
    faissService = FaissKBService("test")
    faissService.add_doc(KnowledgeFile("README.md", "test"))
    faissService.delete_doc(KnowledgeFile("README.md", "test"))
    faissService.do_drop_kb()
    print(faissService.search_docs("如何启动api服务"))

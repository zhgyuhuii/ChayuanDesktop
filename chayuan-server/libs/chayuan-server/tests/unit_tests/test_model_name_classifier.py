"""模型名启发式分类(OpenAI 兼容 /models 与 Ollama /api/tags 无可靠类型字段时按名字猜)。

真实样本取自百度千帆 /v2/models 返回的 model id(仅名字,无敏感信息)。
"""
from chayuan.server.model_name_classify import classify_model_ids_by_name


def test_qianfan_real_names_bucketed():
    ids = [
        # chat / vl-chat -> llm
        "ernie-5.1", "deepseek-v3", "qwen3-32b", "qwen3-vl-8b-instruct",
        # embedding
        "qwen3-embedding-8b", "tao-8k", "embedding", "bge-large-zh",
        # ocr -> image2text_models
        "qianfan-ocr", "deepseek-ocr", "paddleocr-vl-0.9b", "pp-structurev3",
        # text2image
        "qwen-image", "flux.1-schnell", "ernie-image-turbo",
        # image edit -> image2image
        "qwen-image-edit",
    ]
    out = classify_model_ids_by_name(ids)
    assert set(out["embed_models"]) == {"qwen3-embedding-8b", "tao-8k", "embedding", "bge-large-zh"}
    assert set(out["image2text_models"]) == {"qianfan-ocr", "deepseek-ocr", "paddleocr-vl-0.9b", "pp-structurev3"}
    assert set(out["text2image_models"]) == {"qwen-image", "flux.1-schnell", "ernie-image-turbo"}
    assert out["image2image_models"] == ["qwen-image-edit"]
    # 没有把上面任何一类漏进对话桶
    assert set(out["llm_models"]) == {"ernie-5.1", "deepseek-v3", "qwen3-32b", "qwen3-vl-8b-instruct"}


def test_rerank_checked_before_embed():
    # bge-reranker 同时含 'bge'(embed 关键词),但必须归 rerank(rerank 先匹配)
    out = classify_model_ids_by_name(["bge-reranker-v2-m3", "bge-m3", "nomic-embed-text", "llama3.1"])
    assert out["rerank_models"] == ["bge-reranker-v2-m3"]
    assert set(out["embed_models"]) == {"bge-m3", "nomic-embed-text"}
    assert out["llm_models"] == ["llama3.1"]


def test_core_buckets_present_and_blank_skipped():
    out = classify_model_ids_by_name(["", None, "gpt-4o", "text-embedding-3-large", "whisper-1"])
    # 始终含三个对齐 PlatformConfig 的核心桶
    assert "llm_models" in out and "embed_models" in out and "rerank_models" in out
    assert out["llm_models"] == ["gpt-4o"]
    assert out["embed_models"] == ["text-embedding-3-large"]
    assert out["speech2text_models"] == ["whisper-1"]

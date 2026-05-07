"""图像知识源子系统（image source）。

在 KnowledgeSource 家族里新增 ``kind=image``；图像向量化由 ImageEmbedder 统一抽象，
支持多种 world-best 模型（默认 SigLIP 2，fallback CLIP / Chinese-CLIP / JinaCLIP v2）。

对外暴露：
- ``get_embedder(model_name)``：拿到 embedder 单例
- ``list_supported_models()``：模型目录（用于 WebUI 下拉）
- ``ImageConnector``：检索 Connector
- ``build_image_index_for_source(source_id, paths)``：离线索引入口（可走 Arq）
"""

from chayuan.server.image_source.embedder import (  # noqa: F401
    BaseImageEmbedder,
    ImageEmbeddingResult,
    get_embedder,
    list_supported_models,
)
from chayuan.server.image_source.connector import ImageConnector  # noqa: F401

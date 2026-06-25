from chayuan.server.file_service import registry
from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
from chayuan.server.file_service.adapters.image import ImageAdapter
from chayuan.server.file_service.adapters.kb_doc import KbDocAdapter

registry.register(ArtifactAdapter())
registry.register(ImageAdapter())
registry.register(KbDocAdapter())

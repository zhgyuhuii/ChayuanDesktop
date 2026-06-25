from chayuan.server.file_service import registry
from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
from chayuan.server.file_service.adapters.image import ImageAdapter
from chayuan.server.file_service.adapters.kb_doc import KbDocAdapter
from chayuan.server.file_service.adapters.dh import DhTaskAdapter, DhAvatarAdapter, DhProductAdapter
from chayuan.server.file_service.adapters.vg import VgTaskAdapter, VgMaterialAdapter, VgBgmAdapter

registry.register(ArtifactAdapter())
registry.register(ImageAdapter())
registry.register(KbDocAdapter())
registry.register(DhTaskAdapter())
registry.register(DhAvatarAdapter())
registry.register(DhProductAdapter())
registry.register(VgTaskAdapter())
registry.register(VgMaterialAdapter())
registry.register(VgBgmAdapter())

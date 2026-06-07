"""文生视频 Connector 集合。

PR-5:DashScope wanx 异步轮询。
PR-6+:Runway / Kling / Sora 等。
"""

from chayuan.server.modality.router.connectors.video_gen import dashscope  # noqa: F401
from chayuan.server.modality.router.connectors.video_gen import local_stub  # noqa: F401
from chayuan.server.modality.router.connectors.video_gen import kling  # noqa: F401
from chayuan.server.modality.router.connectors.video_gen import zhipu  # noqa: F401
from chayuan.server.modality.router.connectors.video_gen import seedance  # noqa: F401
from chayuan.server.modality.router.connectors.video_gen import minimax  # noqa: F401
from chayuan.server.modality.router.connectors.video_gen import vidu  # noqa: F401
from chayuan.server.modality.router.connectors.video_gen import runway  # noqa: F401

__all__: list[str] = []

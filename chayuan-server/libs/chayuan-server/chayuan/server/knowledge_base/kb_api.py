import os
import urllib
from typing import Optional

from fastapi import Body

from chayuan.settings import Settings
from chayuan.server.db.repository.knowledge_base_repository import list_kbs_from_db
from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory, force_rmtree
from chayuan.server.knowledge_base.utils import validate_kb_name
from chayuan.server.utils import BaseResponse, ListResponse, get_default_embedding
from chayuan.utils import build_logger


logger = build_logger()


def list_kbs():
    # Get List of Knowledge Base
    return ListResponse(data=list_kbs_from_db())


def create_kb(
    knowledge_base_name: str = Body(..., examples=["samples"]),
    # 默认值用 None 而不是 Settings.kb_settings.DEFAULT_VS_TYPE / get_default_embedding():
    # 后者在 import 时一次性求值,设置面板改了也不会刷新。前端不传时进函数后再现读
    # Settings,保证「创建 KB 永远沿用此刻的设置」语义。
    vector_store_type: Optional[str] = Body(None),
    kb_info: str = Body("", description="知识库内容简介，用于Agent选择知识库。"),
    embed_model: Optional[str] = Body(None),
) -> BaseResponse:
    # Create selected knowledge base
    if not validate_kb_name(knowledge_base_name):
        return BaseResponse(code=403, msg="Don't attack me")
    if knowledge_base_name is None or knowledge_base_name.strip() == "":
        return BaseResponse(code=404, msg="知识库名称不能为空，请重新填写知识库名称")

    # 现读 Settings:用户改完设置面板立即生效,不用重启
    if not vector_store_type:
        vector_store_type = Settings.kb_settings.DEFAULT_VS_TYPE
    if not embed_model:
        embed_model = get_default_embedding()

    kb = KBServiceFactory.get_service_by_name(knowledge_base_name)
    if kb is not None:
        return BaseResponse(code=404, msg=f"已存在同名知识库 {knowledge_base_name}")

    kb = KBServiceFactory.get_service(
        knowledge_base_name, vector_store_type, embed_model, kb_info=kb_info
    )
    # 同名重建兜底:走到这里 KB 一定不在 DB(上面已挡重名)。磁盘上若还有同名
    # 目录,那是上一次删除没清净的残留 —— 先清掉。否则 get_kb_file_details 的
    # list_files_from_folder 会把残留 content/ 里的旧文件读出来,表现为
    # "删了知识库、重新建同名的、旧文件又回来了"。
    if os.path.exists(kb.kb_path) and not force_rmtree(kb.kb_path):
        logger.error(
            "create_kb: 残留的同名知识库目录清不掉 kb=%s path=%s —— 旧文件可能"
            "复活;请关闭占用该目录的进程后重试。",
            knowledge_base_name, kb.kb_path,
        )
    try:
        kb.create_kb()
    except Exception as e:
        emsg = str(e)
        # 区分"embedding 未配置(用户操作可解决)"和"真错误":
        # - get_Embeddings 在 embedding 不可用时抛带"embedding 模型... 不可用"的 RuntimeError
        #   (见 chayuan/server/utils.py 翻译块);也可能是底层 langchain 直接抛
        #   "openai_api_key" 错(向后兼容,极少出现)
        # 这类错不应该红色 BizError — 改 code=422 + 短引导文案,前端识别后弹
        # info-级提示让用户去配置,不是错误。
        needs_embedding_config = (
            ("embedding" in emsg and "不可用" in emsg)
            or "openai_api_key" in emsg.lower()
            or "OPENAI_API_KEY" in emsg
        )
        if needs_embedding_config:
            logger.warning(
                "[create_kb] embedding 未配置 → 422 引导用户配置(KB=%s): %s",
                knowledge_base_name, emsg.splitlines()[0] if emsg else "",
            )
            return BaseResponse(
                code=422,
                msg=(
                    f"还没配置向量模型,无法创建知识库「{knowledge_base_name}」。\n"
                    "请先去「设置 → 本地模型服务」配一个向量模型:\n"
                    "  • 推荐:拷整仓 ONNX 模型(如 BAAI/bge-m3)到 "
                    "<data>/models/bundled/embedding/<repo>/,系统会自动 in-process 跑\n"
                    "  • 或拷 GGUF 量化版给 llama-server\n"
                    "  • 或在 MODEL_PLATFORMS 配云端 embedding(OpenAI/阿里百炼/智谱)"
                ),
            )
        msg = f"创建知识库出错: {e}"
        logger.error(f"{e.__class__.__name__}: {msg}")
        return BaseResponse(code=500, msg=msg)

    return BaseResponse(code=200, msg=f"已新增知识库 {knowledge_base_name}")


def delete_kb(
    knowledge_base_name: str = Body(..., examples=["samples"]),
) -> BaseResponse:
    # Delete selected knowledge base
    if not validate_kb_name(knowledge_base_name):
        return BaseResponse(code=403, msg="Don't attack me")
    knowledge_base_name = urllib.parse.unquote(knowledge_base_name)

    kb = KBServiceFactory.get_service_by_name(knowledge_base_name)

    if kb is None:
        return BaseResponse(code=404, msg=f"未找到知识库 {knowledge_base_name}")

    try:
        # clear_vs 与 drop_kb 解耦:clear_vs(清向量内容 + file metadata)失败
        # 不能阻止 drop_kb 清磁盘文件 / FileStorage / KB DB 行 —— 否则磁盘上
        # 的文件按 kb_name 残留,同名重建会"复活"。要求:删库不留任何数据。
        try:
            kb.clear_vs()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"clear_vs 失败,仍继续 drop_kb 清磁盘 + DB: {e!r}")
        status = kb.drop_kb()
        if status:
            return BaseResponse(code=200, msg=f"成功删除知识库 {knowledge_base_name}")
    except Exception as e:
        msg = f"删除知识库时出现意外： {e}"
        logger.error(f"{e.__class__.__name__}: {msg}")
        return BaseResponse(code=500, msg=msg)

    return BaseResponse(code=500, msg=f"删除知识库失败 {knowledge_base_name}")

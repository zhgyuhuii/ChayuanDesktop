import urllib
from typing import Optional

from fastapi import Body

from chayuan.settings import Settings
from chayuan.server.db.repository.knowledge_base_repository import list_kbs_from_db
from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory
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
    try:
        kb.create_kb()
    except Exception as e:
        msg = f"创建知识库出错： {e}"
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
        status = kb.clear_vs()
        status = kb.drop_kb()
        if status:
            return BaseResponse(code=200, msg=f"成功删除知识库 {knowledge_base_name}")
    except Exception as e:
        msg = f"删除知识库时出现意外： {e}"
        logger.error(f"{e.__class__.__name__}: {msg}")
        return BaseResponse(code=500, msg=msg)

    return BaseResponse(code=500, msg=f"删除知识库失败 {knowledge_base_name}")

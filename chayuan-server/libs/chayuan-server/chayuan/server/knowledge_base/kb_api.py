import os
import urllib
from typing import Optional

from fastapi import Body

from chayuan.settings import Settings
from chayuan.server.db.repository.knowledge_base_repository import (
    delete_kb_from_db,
    list_kbs_from_db,
)
from chayuan.server.db.repository.knowledge_file_repository import (
    delete_files_from_db,
    list_files_from_db,
)
from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory, force_rmtree
from chayuan.server.knowledge_base.utils import (
    get_file_path,
    get_kb_path,
    list_files_from_folder,
    validate_kb_name,
)
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
    # 同名重建兜底:走到这里 KB 一定不在 DB(上面已挡重名)。把上一次删除没
    # 清净的残留**全部**按名字清掉 —— 磁盘 content/ 目录 + DB 的 knowledge_file
    # 行,两处都清。否则 get_kb_file_details 会从这两个来源把旧文件读回来,
    # 表现为"删了知识库、重新建同名的、旧文件又复活了"。
    _purge_kb_residue(knowledge_base_name)
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


def _purge_kb_residue(knowledge_base_name: str) -> None:
    """按名字**彻底**清掉一个 KB 的全部残留。

    KB 的文件列表 get_kb_file_details = 磁盘 content/ 文件夹 ∪ DB 的
    knowledge_file 行,**两个来源**;文件实体还可能同时落在 FileStorage
    (KB_CONTENT 命名空间)。任一处残留,"删知识库 → 同名重建"后旧文件
    就会复活。

    清理步骤(删除 / 重建前都调一次):
      1. 列出该 KB 已知的所有文件名(磁盘 content/ ∪ DB knowledge_file 行);
      2. **逐个文件名删**:本地磁盘文件 + FileStorage 对象;
      3. FileStorage 再按前缀兜底清一遍;
      4. 删 DB 的 knowledge_file / file_doc 行;
      5. force_rmtree 整个 KB 目录(逐个删完剩空壳,这步兜底删目录树)。
    每步都 logger,删/建知识库后搜后端日志 "[purge]" 即可逐项核对。
    """
    import stat

    # 1. 收集该 KB 已知的所有文件名(磁盘 + DB 两个来源)
    names: set = set()
    try:
        names.update(list_files_from_folder(knowledge_base_name))
    except Exception as e:  # noqa: BLE001
        logger.warning("[purge] 列磁盘文件失败 kb=%s: %r", knowledge_base_name, e)
    try:
        names.update(list_files_from_db(knowledge_base_name) or [])
    except Exception as e:  # noqa: BLE001
        logger.warning("[purge] 列 DB 文件失败 kb=%s: %r", knowledge_base_name, e)

    # FileStorage 句柄(local 后端落 KB_ROOT/../storage;minio 在远端 bucket)
    storage = None
    NS = None
    try:
        from chayuan.server.file_storage import NS as _NS, get_storage
        storage = get_storage()
        NS = _NS
    except Exception as e:  # noqa: BLE001
        logger.debug("[purge] FileStorage 不可用(忽略): %r", e)

    # 2. 逐个文件名删:本地磁盘 + FileStorage
    removed = 0
    for fname in sorted(names):
        try:
            fp = get_file_path(knowledge_base_name, fname)
            if fp and os.path.isfile(fp):
                try:
                    os.chmod(fp, stat.S_IWRITE)  # 清只读位,防 Windows 删不掉
                except Exception:  # noqa: BLE001
                    pass
                os.remove(fp)
                removed += 1
                logger.info("[purge] 删文件 kb=%s name=%s -> %s",
                            knowledge_base_name, fname, fp)
        except Exception as e:  # noqa: BLE001
            logger.warning("[purge] 删本地文件失败 kb=%s name=%s: %r",
                           knowledge_base_name, fname, e)
        if storage is not None:
            try:
                storage.delete(NS.KB_CONTENT, f"{knowledge_base_name}/{fname}")
            except Exception as e:  # noqa: BLE001
                logger.debug("[purge] 删 FileStorage 失败 kb=%s name=%s: %r",
                             knowledge_base_name, fname, e)

    # 3. FileStorage 再按前缀兜底清(逐个删可能漏掉 list 不到名字的对象)
    if storage is not None:
        try:
            for obj in storage.list(NS.KB_CONTENT,
                                    prefix=f"{knowledge_base_name}/", limit=10000):
                storage.delete(NS.KB_CONTENT, obj.key)
        except Exception as e:  # noqa: BLE001
            logger.debug("[purge] FileStorage 前缀清理失败 kb=%s: %r",
                         knowledge_base_name, e)

    # 4. DB 的 knowledge_file / file_doc 行
    db_ok = True
    try:
        delete_files_from_db(knowledge_base_name)
    except Exception as e:  # noqa: BLE001
        db_ok = False
        logger.warning("[purge] delete_files_from_db(%s) 失败: %r",
                       knowledge_base_name, e)

    # 5. force_rmtree 整个 KB 目录(逐个删完后多半剩空壳,这步兜底删目录树)
    folder_existed = False
    folder_cleared = True
    kb_dir = ""
    try:
        kb_dir = get_kb_path(knowledge_base_name)
        folder_existed = os.path.exists(kb_dir)
        if folder_existed:
            folder_cleared = force_rmtree(kb_dir)
            if not folder_cleared:
                logger.error(
                    "[purge] 知识库磁盘目录清不掉 kb=%s path=%s —— 旧文件可能复活,"
                    "关掉占用该目录的进程后重试。", knowledge_base_name, kb_dir,
                )
    except Exception as e:  # noqa: BLE001
        folder_cleared = False
        logger.warning("[purge] 清磁盘目录(%s)失败: %r", knowledge_base_name, e)

    logger.info(
        "[purge] KB=%s 文件名=%d 删除文件=%d db_rows_cleared=%s "
        "folder_existed=%s folder_cleared=%s path=%s",
        knowledge_base_name, len(names), removed, db_ok,
        folder_existed, folder_cleared, kb_dir,
    )


def delete_kb(
    knowledge_base_name: str = Body(..., examples=["samples"]),
) -> BaseResponse:
    # Delete selected knowledge base
    if not validate_kb_name(knowledge_base_name):
        return BaseResponse(code=403, msg="Don't attack me")
    knowledge_base_name = urllib.parse.unquote(knowledge_base_name)

    kb = KBServiceFactory.get_service_by_name(knowledge_base_name)

    # 不是文档 KB → 可能是图像 / 向量 knowledge_source(同名)。前端有的入口
    # (KbPage 等)删知识库不分 kind、统一打到本接口;这里必须把 knowledge_source
    # 也删干净 —— 尤其**图像源**的索引 store(data/image_indexes/<name>/)+
    # 进程内 _STORES 缓存,delete_source 自己不碰,不清就同名重建旧图复活。
    if kb is None:
        try:
            from chayuan.server.db.repository.knowledge_source_repository import (
                delete_source,
                get_source_by_name,
            )
            _src = get_source_by_name(knowledge_base_name)
            if _src is not None:
                _sid = int(_src["id"])
                _img_store = None
                if (_src.get("kind") or "") == "image":
                    try:
                        from chayuan.server.api_server.image_routes import (
                            _resolve_store_name,
                        )
                        _img_store = _resolve_store_name(_sid)
                    except Exception as e:  # noqa: BLE001
                        logger.warning("delete_kb: 解析图像 store 名失败: %r", e)
                delete_source(_sid)
                if _img_store is not None:
                    try:
                        from chayuan.server.api_server.image_routes import (
                            purge_image_source_storage,
                        )
                        purge_image_source_storage(_sid, _img_store)
                    except Exception as e:  # noqa: BLE001
                        logger.warning("delete_kb: 清图像存储失败: %r", e)
                logger.info(
                    "[delete_kb] 按 knowledge_source 删除 name=%s id=%s kind=%s",
                    knowledge_base_name, _sid, _src.get("kind"),
                )
                return BaseResponse(
                    code=200, msg=f"已删除知识库 {knowledge_base_name}"
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("delete_kb: knowledge_source 兜底删除失败 name=%s: %r",
                           knowledge_base_name, e)

    # KB 在 DB 里 → 先让 KBService 清向量库 collection。clear_vs / drop_kb
    # 失败都不致命:下面 _purge_kb_residue 会按名字把文件 + DB 行兜底全清。
    if kb is not None:
        try:
            kb.clear_vs()
        except Exception as e:  # noqa: BLE001
            logger.warning("delete_kb: clear_vs 失败,继续: %r", e)
        try:
            kb.drop_kb()
        except Exception as e:  # noqa: BLE001
            logger.warning("delete_kb: drop_kb 失败,继续按名清残留: %r", e)

    # 不管 kb 在不在、drop_kb 成没成,都按名字做一次**彻底清理**:列出文件名
    # 逐个删本地磁盘 + FileStorage,再删目录、DB 文件行;最后删 KB 行。
    # 保证"删知识库 → 同名重建"绝不复活旧文件。删除是幂等的,恒返回 200。
    _purge_kb_residue(knowledge_base_name)
    try:
        delete_kb_from_db(knowledge_base_name)
    except Exception as e:  # noqa: BLE001
        logger.warning("delete_kb: delete_kb_from_db(%s) 失败: %r",
                       knowledge_base_name, e)
    return BaseResponse(code=200, msg=f"已删除知识库 {knowledge_base_name}")

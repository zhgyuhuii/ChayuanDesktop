"""首启自动创建「使用帮助」文档知识库。

把 :mod:`chayuan.server.manuals.deploy` 部署出来的《察元产品介绍》《察元使用
手册》塞进一个文档知识库,用户在「知识中心」里点开即可查看。

设计要点
========
* **只建一次**:``<CHAYUAN_ROOT>/manuals/.help_kb_seeded`` 标记文件存在就跳过
  —— 用户删掉「使用帮助」后,下次启动不会再把它建回来。
* **不抢占同名库**:已存在同名 KB 时直接写标记返回,不动用户自己的库。
* **不向量化**:只 ``add_kb_to_db`` 注册 + 把文件拷进 ``content/``,不初始化
  向量库、不依赖嵌入模型(首启时嵌入模型常没就绪)。文件可在知识中心点开
  查看;需要检索时用户可在 KB 详情手动重建索引。
* **best-effort**:任何步骤失败只记日志,绝不阻塞 server 启动。

入口 :func:`seed_help_kb`,由 first_launch 在 ``deploy_user_manuals`` 之后调用。
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger("chayuan.manuals.help_kb")

# 知识库公开名 + 简介
HELP_KB_NAME = "使用帮助"
HELP_KB_INFO = "察元的产品介绍与使用手册,点开即可查看。"

# 标记文件名(放在 <CHAYUAN_ROOT>/manuals/ 下)
_MARKER_NAME = ".help_kb_seeded"


def _manuals_dir() -> Path:
    from chayuan.settings import CHAYUAN_ROOT
    return Path(CHAYUAN_ROOT) / "manuals"


def _write_marker(marker: Path) -> None:
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("seeded\n", encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        logger.warning("[help-kb] 写标记文件失败 %s: %r", marker, e)


def seed_help_kb() -> Dict[str, Any]:
    """首启:把产品介绍 + 使用手册塞进「使用帮助」文档知识库。

    返回结果快照 ``{"action": "created"|"skipped"|"failed", "files": [...], ...}``。
    """
    result: Dict[str, Any] = {"action": "skipped", "kb": HELP_KB_NAME, "files": []}
    claimed_marker = False  # 本次调用是否抢到了 seed 锁(失败时要回滚 marker)
    try:
        marker = _manuals_dir() / _MARKER_NAME
        if marker.exists():
            result["reason"] = "already seeded (marker exists)"
            return result

        # 已存在同名库(用户自建 or 上次已 seed 但 marker 丢了)→ 不重复建、不抢占,
        # 补写标记后跳过。
        # ⚠ 血泪:原来用 KBServiceFactory.get_service_by_name() 判存在,它会去【构造】
        # KBService;milvus 类型 + milvus 连不上时返回 None → 把已存在的库误判成「不
        # 存在」→ 重启又建一个。改用纯 DB 存在性检查 kb_exists(),不碰向量库/嵌入。
        from chayuan.server.db.repository.knowledge_base_repository import kb_exists
        if kb_exists(HELP_KB_NAME):
            _write_marker(marker)
            result["reason"] = "kb already exists in db"
            return result

        # 原子占锁:prod 多 worker(UVICORN_WORKERS>1)会各自跑首启 hook,若都过了
        # 上面的检查会【并发建库】→ 同名多行(触发 MultipleResultsFound)。用 O_EXCL
        # 独占创建 marker 当锁,只有一个 worker 抢到、其余直接跳过。
        try:
            marker.parent.mkdir(parents=True, exist_ok=True)
            with open(marker, "x", encoding="utf-8") as f:
                f.write("seeding\n")
            claimed_marker = True
        except FileExistsError:
            result["reason"] = "another worker is seeding"
            return result

        from chayuan.settings import Settings
        from chayuan.server.db.repository.knowledge_base_repository import add_kb_to_db
        from chayuan.server.db.repository.knowledge_file_repository import add_file_to_db
        from chayuan.server.knowledge_base.utils import KnowledgeFile, get_doc_path
        from chayuan.server.manuals.deploy import MANUAL_FILES, get_manual_path
        from chayuan.server.utils import get_default_embedding

        # 1) 注册 KB(view-only:只写元数据,不建向量库、不碰嵌入模型)
        try:
            embed_model = get_default_embedding() or ""
        except Exception:  # noqa: BLE001
            embed_model = ""
        add_kb_to_db(
            HELP_KB_NAME, HELP_KB_INFO,
            Settings.kb_settings.DEFAULT_VS_TYPE, embed_model,
        )

        # 2) content/ 目录
        doc_path = Path(get_doc_path(HELP_KB_NAME))
        doc_path.mkdir(parents=True, exist_ok=True)

        # 3) 逐个手册:优先 .docx,缺了退回 .md;拷进 content/ 再登记 DB 行
        copied: List[str] = []
        for spec in MANUAL_FILES:
            src = get_manual_path(spec.public_name, fmt="docx")
            if src is None or not Path(src).is_file():
                src = get_manual_path(spec.public_name, fmt="md")
            if src is None or not Path(src).is_file():
                logger.warning("[help-kb] 手册文件缺失,跳过: %s", spec.public_name)
                continue
            src = Path(src)
            dst = doc_path / src.name
            try:
                shutil.copy2(src, dst)
            except Exception as e:  # noqa: BLE001
                logger.warning("[help-kb] 拷贝失败 %s: %r", src.name, e)
                continue
            try:
                add_file_to_db(
                    KnowledgeFile(filename=src.name,
                                  knowledge_base_name=HELP_KB_NAME)
                )
            except Exception as e:  # noqa: BLE001
                # DB 行登记失败不致命:文件已在 content/,知识库仍能列出 + 点开
                logger.warning("[help-kb] add_file_to_db 失败 %s: %r", src.name, e)
            copied.append(src.name)

        _write_marker(marker)
        result["action"] = "created"
        result["files"] = copied
        logger.info("[help-kb] 已创建「%s」知识库,文件: %s", HELP_KB_NAME, copied)
    except Exception as e:  # noqa: BLE001 — 首启 hook 失败绝不阻塞 server 启动
        logger.warning("[help-kb] seed_help_kb 失败(忽略): %r", e)
        result["action"] = "failed"
        result["error"] = repr(e)
        # 抢到锁后中途失败 → 回滚 marker,让下次启动能重试,别把「使用帮助」永久卡没。
        if claimed_marker:
            try:
                (_manuals_dir() / _MARKER_NAME).unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass
    return result

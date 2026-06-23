"""后台「模块」目录 —— 角色按模块授权(#2)的权限粒度真源(后端侧)。

与前端 AdminPage 的 ADMIN_GROUPS 对齐:每个后台域是一个可授权模块。角色持有
一组 module_key;内置 admin 角色隐式拥有全部模块。前端 RoleManagementPage 从
GET /api/v1/admin/roles 的 module_catalog 拿到本清单渲染勾选框。
"""
from __future__ import annotations

from typing import Dict, List

# (group, key, label) —— 顺序即展示顺序
MODULE_CATALOG: List[Dict[str, str]] = [
    {"group": "用户与权限", "key": "users", "label": "用户"},
    {"group": "用户与权限", "key": "roles", "label": "角色"},
    {"group": "用户与权限", "key": "kbacl", "label": "KB 授权"},
    {"group": "用户与权限", "key": "apps", "label": "应用"},
    {"group": "模型与服务", "key": "defaults", "label": "默认模型"},
    {"group": "模型与服务", "key": "platforms", "label": "模型平台"},
    {"group": "模型与服务", "key": "mcp", "label": "MCP"},
    {"group": "模型与服务", "key": "tools", "label": "工具"},
    {"group": "模型与服务", "key": "modelcfg", "label": "模型参数"},
    {"group": "模型与服务", "key": "prompttpl", "label": "Prompt 模板"},
    {"group": "模型与服务", "key": "services", "label": "系统服务"},
    {"group": "模型与服务", "key": "topology", "label": "服务状态"},
    {"group": "模型与服务", "key": "svcstatus", "label": "服务就绪"},
    {"group": "知识库", "key": "kbcfg", "label": "知识库配置"},
    {"group": "知识库", "key": "vstore", "label": "向量库"},
    {"group": "知识库", "key": "kbmanage", "label": "知识库管理"},
    {"group": "监控", "key": "traces", "label": "最近 Trace"},
    {"group": "监控", "key": "scores", "label": "Scores"},
    {"group": "监控", "key": "perf", "label": "性能"},
    {"group": "监控", "key": "outbox", "label": "Outbox"},
    {"group": "监控", "key": "prompts", "label": "Prompt"},
    {"group": "基础设施", "key": "basic", "label": "基础配置"},
    {"group": "基础设施", "key": "database", "label": "数据库"},
    {"group": "基础设施", "key": "redis", "label": "Redis"},
    {"group": "基础设施", "key": "storage", "label": "对象存储"},
    {"group": "基础设施", "key": "datadir", "label": "数据目录"},
    {"group": "部署", "key": "deployment", "label": "部署授权"},
    # ── 前端功能(消费端)：角色可按功能授权;键以 app. 前缀,与后台模块区分。
    # 语义(前端 useFeatureAccess):admin 或「角色未勾选任何 app.* 」→ 不限制(向后兼容,
    # 老角色不受影响);一旦勾选了部分 app.*,则只放行勾选的功能,其余在主页/侧栏隐藏。
    {"group": "前端功能", "key": "app.chat", "label": "对话"},
    {"group": "前端功能", "key": "app.kb", "label": "知识中心"},
    {"group": "前端功能", "key": "app.ocr", "label": "图转文 OCR"},
    {"group": "前端功能", "key": "app.asr", "label": "音转文"},
    {"group": "前端功能", "key": "app.notes", "label": "AI 笔记"},
    {"group": "前端功能", "key": "app.t2v", "label": "AI 视频生成"},
    {"group": "前端功能", "key": "app.article-video", "label": "图文成片"},
    {"group": "前端功能", "key": "app.tts", "label": "语音合成"},
    {"group": "前端功能", "key": "app.video-edit", "label": "视频编辑"},
    {"group": "前端功能", "key": "app.digital-human", "label": "数字人"},
    {"group": "前端功能", "key": "app.model-hub", "label": "模型厂商"},
]

ALL_MODULE_KEYS: List[str] = [m["key"] for m in MODULE_CATALOG]
_VALID = set(ALL_MODULE_KEYS)


def sanitize_modules(keys) -> List[str]:
    """过滤掉未知 module_key,保持目录顺序去重。"""
    if not isinstance(keys, (list, tuple)):
        return []
    picked = {k for k in keys if isinstance(k, str) and k in _VALID}
    return [k for k in ALL_MODULE_KEYS if k in picked]

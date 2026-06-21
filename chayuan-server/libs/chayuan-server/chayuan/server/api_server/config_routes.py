"""通用配置 admin REST(S0 —— Schema 驱动表单引擎后端)。

把原 8502 config_panel 的 ``schema.py``(ALL_SCHEMAS:FileSchema→Section→Field)
以 JSON 暴露给 React 控制台,配合前端通用 ``<SchemaForm>`` 一次覆盖 5 个 yaml
配置域(basic / kb / model / tool / prompt)的字段级读写。

端点(均 admin-only):
- GET  /api/v1/admin/config/{file}/schema  返回该 yaml 的 schema(sections/fields)。
- GET  /api/v1/admin/config/{file}/values  返回当前各 path 的值(password 脱敏)。
- POST /api/v1/admin/config/{file}         按 path 写回(复用 yaml_store.save_updates),
                                           返回变更明细 + needs_restart 汇总。

设计要点:
- ``{file}`` 限定在 schema.py 已声明的白名单(schema_by_filename),非法值 404。
- 敏感字段(widget=password)读取时脱敏为 ``_MASK``;保存时若提交值等于 ``_MASK``
  视为「未改动」跳过,避免把掩码写回 yaml 抹掉真密钥。
- 保存按 Field.widget 走 ``yaml_store.coerce_for_widget`` 归一化类型。
- needs_restart:本次真正发生变化的字段里,只要有一个 Field.needs_restart=True 即 True。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from chayuan.server.auth.deps import require_role

config_router = APIRouter(prefix="/api/v1/admin/config", tags=["admin-config"])
_ADMIN = require_role("admin")

# 脱敏占位符。前端原样回传 = 未改动;保存时据此跳过。
_MASK = "********"


def _field_to_dict(f: Any) -> Dict[str, Any]:
    """把 schema.Field 序列化成前端可渲染的纯 JSON。"""
    return {
        "path": f.path,
        "label": f.label,
        "widget": f.widget,
        "help": f.help or "",
        "needs_restart": bool(f.needs_restart),
        "choices": list(f.choices) if f.choices else None,
        "placeholder": f.placeholder or "",
        "min": f.min,
        "max": f.max,
        "step": f.step,
        "rows": f.rows,
        "password_toggle": bool(f.password_toggle),
    }


def _schema_to_dict(fs: Any) -> Dict[str, Any]:
    return {
        "filename": fs.filename,
        "title": fs.title,
        "description": fs.description or "",
        "raw_editor": bool(fs.raw_editor),
        "sections": [
            {
                "title": s.title,
                "description": s.description or "",
                "fields": [_field_to_dict(f) for f in s.fields],
            }
            for s in fs.sections
        ],
    }


def _resolve(file: str):
    """把 ``file``(可不带 .yaml)解析为 FileSchema,找不到 404。"""
    from chayuan.server.config_panel.schema import schema_by_filename

    name = file if file.endswith(".yaml") else f"{file}.yaml"
    fs = schema_by_filename(name)
    if fs is None:
        raise HTTPException(status_code=404, detail=f"未知配置文件: {file}")
    return name, fs


def _all_fields(fs: Any) -> List[Any]:
    out: List[Any] = []
    for s in fs.sections:
        out.extend(s.fields)
    return out


@config_router.get("/", summary="[admin] 列出全部可配置 yaml 域")
def list_files(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.schema import ALL_SCHEMAS

    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "files": [
                {"filename": fs.filename, "title": fs.title, "description": fs.description or ""}
                for fs in ALL_SCHEMAS
            ]
        },
    }


@config_router.get("/{file}/schema", summary="[admin] 返回某 yaml 域的字段 schema")
def get_schema(file: str, _=Depends(_ADMIN)) -> Dict[str, Any]:
    _name, fs = _resolve(file)
    return {"code": 0, "msg": "ok", "data": _schema_to_dict(fs)}


def _effective_default(file_stem: str, path: str):
    """yaml 缺该键时,回退到 pydantic Settings 的实际生效默认值。

    file_stem 形如 model_settings/kb_settings/basic_settings/tool_settings/prompt_settings,
    恰为 Settings 容器上的属性名。path 点号分隔,逐级走属性或 dict。任何异常返回 None,
    不影响取值主流程。让「模型参数 HISTORY_LEN/TEMPERATURE、RAG 模板」等即便没写进 yaml
    也能在表单里显示真实默认。"""
    try:
        from chayuan.settings import Settings
        node = getattr(Settings, file_stem, None)
        if node is None:
            return None
        for key in path.split("."):
            if node is None:
                return None
            node = node.get(key) if isinstance(node, dict) else getattr(node, key, None)
        return node
    except Exception:  # noqa: BLE001
        return None


@config_router.get("/{file}/values", summary="[admin] 返回某 yaml 域当前值(password 脱敏)")
def get_values(file: str, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import yaml_store

    name, fs = _resolve(file)
    res = yaml_store.load_yaml(name)
    doc = res.doc if res.exists else {}
    file_stem = name[:-5] if name.endswith(".yaml") else name

    values: Dict[str, Any] = {}
    masked: Dict[str, bool] = {}
    for f in _all_fields(fs):
        raw = yaml_store.get_by_path(doc, f.path, default=None)
        # ruamel scalar → 原生
        raw = yaml_store._normalize(raw)
        # yaml 没写该键 → 回退到 Settings 实际生效默认值(让表单显示真实默认而非空)
        if raw is None:
            eff = _effective_default(file_stem, f.path)
            if eff is not None:
                raw = yaml_store._normalize(eff)
        if f.widget == "password" and isinstance(raw, str) and raw:
            values[f.path] = _MASK
            masked[f.path] = True
        else:
            values[f.path] = raw
    # raw 文本(高级编辑器),仅当 schema 允许
    raw_text = yaml_store.load_text(name) if fs.raw_editor else None
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "filename": name,
            "exists": res.exists,
            "values": values,
            "masked": masked,
            "raw_text": raw_text,
        },
    }


@config_router.post("/{file}", summary="[admin] 按 path 写回某 yaml 域")
def save_values(
    file: str,
    body: Dict[str, Any] = Body(...),
    _=Depends(_ADMIN),
) -> Dict[str, Any]:
    """body: {"values": {<path>: <ui_value>, ...}}。

    - 仅接受 schema 已声明的 path(防越权写任意键);
    - password 字段提交值 == _MASK → 跳过(未改动);
    - 按 widget coerce 后交 yaml_store.save_updates。
    """
    from chayuan.server.config_panel import yaml_store

    name, fs = _resolve(file)
    incoming = body.get("values") or {}
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="values 必须是对象")

    field_by_path = {f.path: f for f in _all_fields(fs)}
    updates: Dict[str, Any] = {}
    rejected: List[str] = []
    for path, ui_val in incoming.items():
        f = field_by_path.get(path)
        if f is None:
            rejected.append(path)
            continue
        if f.widget == "password" and ui_val == _MASK:
            continue  # 未改动的脱敏值,不回写
        try:
            updates[path] = yaml_store.coerce_for_widget(f.widget, ui_val)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"{path}: {e}")

    _path, _bak, changes = yaml_store.save_updates(name, updates)

    needs_restart = any(
        field_by_path[p].needs_restart for p in changes.keys() if p in field_by_path
    )
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "changed": list(changes.keys()),
            "rejected": rejected,
            "needs_restart": bool(needs_restart),
        },
    }


@config_router.post("/{file}/raw", summary="[admin] 覆盖写某 yaml 域原文(高级)")
def save_raw(
    file: str,
    body: Dict[str, Any] = Body(...),
    _=Depends(_ADMIN),
) -> Dict[str, Any]:
    from chayuan.server.config_panel import yaml_store

    name, fs = _resolve(file)
    if not fs.raw_editor:
        raise HTTPException(status_code=400, detail=f"{name} 不支持原文编辑")
    text: Optional[str] = body.get("text")
    if not isinstance(text, str):
        raise HTTPException(status_code=400, detail="text 必须是字符串")
    ok, err = yaml_store.validate_text(text)
    if not ok:
        raise HTTPException(status_code=400, detail=f"YAML 解析失败: {err}")
    yaml_store.save_raw_text(name, text)
    return {"code": 0, "msg": "ok", "data": {"needs_restart": True}}

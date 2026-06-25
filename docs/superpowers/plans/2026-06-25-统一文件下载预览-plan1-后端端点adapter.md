# 统一文件下载/预览 — 阶段1实施计划（后端统一端点 + adapter + 白名单）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `GET /v1/files` 统一文件端点 + adapter 分发框架,先覆盖 kb-doc/image/artifact 三类(已接 file_storage),并把 `/v1/files` 加进 nginx 与 token 中间件白名单。

**Architecture:** 路由层薄(只 kind→adapter 查表 + 调用),每 adapter 复用现有端点函数(download_doc / image 定位 / artifacts find_fetch)返回 FastAPI Response。FileBlob 抽象用 Response 落地以最大化复用、零重写。旧端点不动(并存)。

**Tech Stack:** Python/FastAPI, pytest;现有 `chayuan/server/file_storage`(NS+get/exists/copy_to_local)、`modality/router/artifacts.py`、`knowledge_base/kb_doc_api.download_doc`、`image_source`。

**前置:** 阶段1设计见 `docs/superpowers/specs/2026-06-25-统一文件下载预览-design.md`。版本号一律 `cd /work/chayuan-desktop && sudo /usr/bin/python3.11 scripts/bump-version.py`(改了后端业务代码,commit 时 +1);本仓 root 所有,编辑前 `sudo chown admin <file>`,commit 用 `sudo git -c core.fileMode=false`。pytest 真机:`PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q <test>`(沙箱 conftest 读 root 的 settings.yaml 会 PermissionError,真机正常)。

---

## 文件结构

- Create `chayuan/server/file_service/__init__.py` — 导出 registry/dispatch
- Create `chayuan/server/file_service/base.py` — `FileAdapter` Protocol + `FileRequestError`
- Create `chayuan/server/file_service/registry.py` — kind→adapter 查表 + `dispatch()`
- Create `chayuan/server/file_service/adapters/__init__.py`
- Create `chayuan/server/file_service/adapters/artifact.py` — artifact adapter
- Create `chayuan/server/file_service/adapters/image.py` — image adapter
- Create `chayuan/server/file_service/adapters/kb_doc.py` — kb-doc adapter
- Modify `chayuan/server/api_server/image_routes.py` — 抽 `serve_image_file()` 供复用(旧端点 + adapter 共用)
- Create `chayuan/server/api_server/file_routes.py` — `GET /v1/files`
- Modify `chayuan/server/api_server/server_app.py:177` — 注册 file_router
- Modify `chayuan/server/auth/middleware.py:48` — `_QUERY_TOKEN_ALLOWED_PATHS` 加 `/v1/files`
- Modify `docker/nginx.conf` + `docker/nginx.split.conf` — `@route` 的 `$spa=0` regex 加 `v1/files`
- Tests: `tests/unit_tests/test_file_service_registry.py`, `test_file_service_adapters.py`, `test_file_routes.py`

---

### Task 1: adapter 接口 + registry 框架

**Files:**
- Create: `chayuan/server/file_service/base.py`
- Create: `chayuan/server/file_service/registry.py`
- Create: `chayuan/server/file_service/__init__.py`
- Create: `chayuan/server/file_service/adapters/__init__.py`
- Test: `tests/unit_tests/test_file_service_registry.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_file_service_registry.py
import pytest
from chayuan.server.file_service import registry
from chayuan.server.file_service.base import FileRequestError


def test_dispatch_unknown_kind_raises():
    with pytest.raises(FileRequestError) as ei:
        registry.dispatch("nope", {}, user=None, download=False)
    assert ei.value.status_code == 400


def test_register_and_dispatch_calls_adapter():
    calls = {}

    class _Stub:
        kind = "stub"
        def handle(self, params, user, *, download):
            calls["params"] = params
            calls["download"] = download
            return "RESP"

    registry.register(_Stub())
    out = registry.dispatch("stub", {"a": "1"}, user={"id": "u"}, download=True)
    assert out == "RESP"
    assert calls == {"params": {"a": "1"}, "download": True}
```

- [ ] **Step 2: 运行确认失败**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_registry.py -p no:cacheprovider`
Expected: FAIL (ModuleNotFoundError: chayuan.server.file_service)

- [ ] **Step 3: 写实现**

```python
# chayuan/server/file_service/base.py
from __future__ import annotations
from typing import Mapping, Optional, Protocol, runtime_checkable
from fastapi import Response


class FileRequestError(Exception):
    """adapter 层错误,路由转成 HTTPException。"""
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


@runtime_checkable
class FileAdapter(Protocol):
    kind: str
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response: ...
```

```python
# chayuan/server/file_service/registry.py
from __future__ import annotations
from typing import Dict, Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileAdapter, FileRequestError

_ADAPTERS: Dict[str, FileAdapter] = {}


def register(adapter: FileAdapter) -> None:
    _ADAPTERS[adapter.kind] = adapter


def dispatch(kind: str, params: Mapping[str, str], *, user: Optional[dict], download: bool) -> Response:
    adapter = _ADAPTERS.get(kind)
    if adapter is None:
        raise FileRequestError(400, f"unknown file kind: {kind!r}")
    return adapter.handle(params, user, download=download)
```

```python
# chayuan/server/file_service/__init__.py
from chayuan.server.file_service import registry  # noqa: F401
from chayuan.server.file_service.base import FileAdapter, FileRequestError  # noqa: F401
```

```python
# chayuan/server/file_service/adapters/__init__.py
```

- [ ] **Step 4: 运行确认通过**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_registry.py -p no:cacheprovider`
Expected: PASS (2 passed)

- [ ] **Step 5: 提交**

```bash
sudo chown admin chayuan/server/file_service -R 2>/dev/null
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/file_service libs/chayuan-server/tests/unit_tests/test_file_service_registry.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): adapter 接口 + registry 框架(统一文件端点阶段1)"
```

---

### Task 2: artifact adapter

**Files:**
- Create: `chayuan/server/file_service/adapters/artifact.py`
- Test: `tests/unit_tests/test_file_service_adapters.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_file_service_adapters.py
import pytest
from chayuan.server.file_service.base import FileRequestError


def test_artifact_missing_name_raises():
    from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
    with pytest.raises(FileRequestError) as ei:
        ArtifactAdapter().handle({}, {"id": "u"}, download=False)
    assert ei.value.status_code == 400


def test_artifact_not_found_raises(monkeypatch):
    from chayuan.server.file_service.adapters import artifact as mod
    from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
    monkeypatch.setattr(mod, "find_by_filename", lambda n: None)
    monkeypatch.setattr(mod, "fetch_from_storage", lambda n: None)
    with pytest.raises(FileRequestError) as ei:
        ArtifactAdapter().handle({"name": "deadbeef.png"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404


def test_artifact_returns_fileresponse(monkeypatch, tmp_path):
    from chayuan.server.file_service.adapters import artifact as mod
    from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
    p = tmp_path / "deadbeef.png"
    p.write_bytes(b"PNG")
    monkeypatch.setattr(mod, "find_by_filename", lambda n: p)
    resp = ArtifactAdapter().handle({"name": "deadbeef.png"}, {"id": "u"}, download=True)
    from fastapi.responses import FileResponse
    assert isinstance(resp, FileResponse)
    assert "attachment" in resp.headers.get("content-disposition", "")
```

- [ ] **Step 2: 运行确认失败**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_adapters.py -p no:cacheprovider`
Expected: FAIL (ModuleNotFoundError adapters.artifact)

- [ ] **Step 3: 写实现**

```python
# chayuan/server/file_service/adapters/artifact.py
from __future__ import annotations
import mimetypes
from typing import Mapping, Optional
from fastapi import Response
from fastapi.responses import FileResponse
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.modality.router.artifacts import find_by_filename, fetch_from_storage


class ArtifactAdapter:
    """模态产物:内容寻址(name=sha.ext)。复用 artifacts 本地优先 + minio 回填。
    鉴权:路由层 require_auth_enabled 已确保登录;sha 本身是隐蔽凭证。"""
    kind = "artifact"

    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        name = (params.get("name") or "").strip()
        if not name or "/" in name or "\\" in name:
            raise FileRequestError(400, "missing or invalid artifact name")
        path = find_by_filename(name) or fetch_from_storage(name)
        if path is None:
            raise FileRequestError(404, "artifact not found")
        media = mimetypes.guess_type(name)[0] or "application/octet-stream"
        headers = {"Cache-Control": "public, max-age=31536000, immutable"}
        if download:
            headers["Content-Disposition"] = f"attachment; filename=\"{name}\""
        return FileResponse(str(path), media_type=media, headers=headers)
```

- [ ] **Step 4: 运行确认通过**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_adapters.py -p no:cacheprovider`
Expected: PASS (3 passed)

- [ ] **Step 5: 提交**

```bash
sudo chown admin chayuan/server/file_service/adapters/artifact.py
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/file_service/adapters/artifact.py libs/chayuan-server/tests/unit_tests/test_file_service_adapters.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): artifact adapter(复用 find/fetch_from_storage)"
```

---

### Task 3: 抽 serve_image_file + image adapter

**Files:**
- Modify: `chayuan/server/api_server/image_routes.py:385-432`(把 endpoint body 抽成 `serve_image_file`)
- Create: `chayuan/server/file_service/adapters/image.py`
- Test: `tests/unit_tests/test_file_service_adapters.py`(追加)

- [ ] **Step 1: 写失败测试(追加到 test_file_service_adapters.py)**

```python
def test_image_delegates_to_serve(monkeypatch):
    from chayuan.server.file_service.adapters import image as mod
    from chayuan.server.file_service.adapters.image import ImageAdapter
    seen = {}
    def _fake_serve(source_id, image_id, *, download, user):
        seen.update(source_id=source_id, image_id=image_id, download=download)
        return "IMG_RESP"
    monkeypatch.setattr(mod, "serve_image_file", _fake_serve)
    out = ImageAdapter().handle(
        {"source_id": "12", "image_id": "abc"}, {"id": "u"}, download=True)
    assert out == "IMG_RESP"
    assert seen == {"source_id": 12, "image_id": "abc", "download": True}


def test_image_missing_params_raises():
    from chayuan.server.file_service.base import FileRequestError
    from chayuan.server.file_service.adapters.image import ImageAdapter
    import pytest
    with pytest.raises(FileRequestError) as ei:
        ImageAdapter().handle({"source_id": "x", "image_id": ""}, {"id": "u"}, download=False)
    assert ei.value.status_code == 400
```

- [ ] **Step 2: 运行确认失败**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_adapters.py::test_image_delegates_to_serve -p no:cacheprovider`
Expected: FAIL (adapters.image 不存在)

- [ ] **Step 3a: 在 image_routes.py 抽出 `serve_image_file`**

把 `image_file_endpoint` 函数体(385-432 行的 can_read 之后整段)移进新函数,endpoint 改为转调。新函数:

```python
def serve_image_file(source_id: int, image_id: str, *, download: bool, user) -> FileResponse:
    """图像下载/预览的复用核心:authz + 定位(minio 同源 stream / 本地回填) + Response。
    供 /knowledge_source/{id}/image/{id} 旧端点与 /v1/files(image adapter)共用。"""
    if not can_read(user, int(source_id)):
        raise HTTPException(403, "no read permission")
    _get_source_or_404(int(source_id))
    from chayuan.server.image_source.store import get_store
    store = get_store(_resolve_store_name(source_id))
    rec = next((m for m in store._meta if m.get("id") == image_id), None)
    if rec is None:
        raise HTTPException(404, "image not found")
    local_path = rec.get("path") or ""
    fname = os.path.basename(local_path) if local_path else image_id
    try:
        import mimetypes
        import urllib.parse as _ulp
        from chayuan.server.file_storage import NS, get_storage
        from fastapi.responses import StreamingResponse
        storage = get_storage()
        key = f"{int(source_id)}/{fname}"
        if storage.name == "minio" and storage.exists(NS.IMAGE_FILES, key):
            data = storage.get(NS.IMAGE_FILES, key)
            guessed = mimetypes.guess_type(fname)[0] or "application/octet-stream"
            headers = {}
            if download:
                headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{_ulp.quote(fname)}"
            return StreamingResponse(iter([data]), media_type=guessed, headers=headers)
        if local_path and not os.path.isfile(local_path) and storage.exists(NS.IMAGE_FILES, key):
            storage.copy_to_local(NS.IMAGE_FILES, key, local_path)
    except Exception:  # noqa: BLE001
        pass
    if not local_path or not os.path.isfile(local_path):
        raise HTTPException(404, "image file missing")
    return FileResponse(local_path, filename=fname if download else None, media_type=None)
```

endpoint 改为:

```python
@image_router.get("/{source_id}/image/{image_id}", summary="下载/预览图像文件")
def image_file_endpoint(source_id: int, image_id: str,
                        download: bool = Query(False),
                        user=Depends(require_auth_enabled())):
    return serve_image_file(int(source_id), image_id, download=download, user=user)
```

- [ ] **Step 3b: 写 image adapter**

```python
# chayuan/server/file_service/adapters/image.py
from __future__ import annotations
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.api_server.image_routes import serve_image_file


class ImageAdapter:
    kind = "image"

    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        sid = (params.get("source_id") or "").strip()
        iid = (params.get("image_id") or "").strip()
        if not sid.isdigit() or not iid:
            raise FileRequestError(400, "missing or invalid source_id/image_id")
        return serve_image_file(int(sid), iid, download=download, user=user)
```

- [ ] **Step 4: 运行确认通过**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_adapters.py -p no:cacheprovider`
Expected: PASS (image 两例 + artifact 三例)

- [ ] **Step 5: 提交**

```bash
sudo chown admin chayuan/server/api_server/image_routes.py chayuan/server/file_service/adapters/image.py
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/api_server/image_routes.py libs/chayuan-server/chayuan/server/file_service/adapters/image.py libs/chayuan-server/tests/unit_tests/test_file_service_adapters.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "refactor(image): 抽 serve_image_file + image adapter 复用"
```

---

### Task 4: kb-doc adapter

**Files:**
- Create: `chayuan/server/file_service/adapters/kb_doc.py`
- Test: `tests/unit_tests/test_file_service_adapters.py`(追加)

说明:kb-doc 鉴权用现有 `can_read_kb(user, kb)`;定位/预览用现有 `download_doc(knowledge_base_name, file_name, preview)`(已处理 minio 同源 stream + office 预览)。preview = 非 download。

- [ ] **Step 1: 写失败测试(追加)**

```python
def test_kbdoc_delegates(monkeypatch):
    from chayuan.server.file_service.adapters import kb_doc as mod
    from chayuan.server.file_service.adapters.kb_doc import KbDocAdapter
    monkeypatch.setattr(mod, "can_read_kb", lambda u, kb: True)
    seen = {}
    def _fake_download(knowledge_base_name, file_name, preview):
        seen.update(kb=knowledge_base_name, file=file_name, preview=preview)
        return "DOC_RESP"
    monkeypatch.setattr(mod, "download_doc", _fake_download)
    out = KbDocAdapter().handle({"kb": "kbA", "file": "a.pdf"}, {"id": "u"}, download=False)
    assert out == "DOC_RESP"
    assert seen == {"kb": "kbA", "file": "a.pdf", "preview": True}


def test_kbdoc_denied(monkeypatch):
    from chayuan.server.file_service.adapters import kb_doc as mod
    from chayuan.server.file_service.adapters.kb_doc import KbDocAdapter
    from chayuan.server.file_service.base import FileRequestError
    import pytest
    monkeypatch.setattr(mod, "can_read_kb", lambda u, kb: False)
    with pytest.raises(FileRequestError) as ei:
        KbDocAdapter().handle({"kb": "kbA", "file": "a.pdf"}, {"id": "u"}, download=True)
    assert ei.value.status_code == 403
```

- [ ] **Step 2: 运行确认失败**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_adapters.py::test_kbdoc_delegates -p no:cacheprovider`
Expected: FAIL (adapters.kb_doc 不存在)

- [ ] **Step 3: 写实现**

```python
# chayuan/server/file_service/adapters/kb_doc.py
from __future__ import annotations
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.knowledge_base.kb_doc_api import download_doc
from chayuan.server.auth.access import can_read_kb  # 定义在 chayuan/server/auth/access.py:88


class KbDocAdapter:
    kind = "kb-doc"

    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        kb = (params.get("kb") or "").strip()
        file = (params.get("file") or "").strip()
        if not kb or not file:
            raise FileRequestError(400, "missing kb/file")
        if not can_read_kb(user, kb):
            raise FileRequestError(403, f"no read permission on kb {kb!r}")
        return download_doc(knowledge_base_name=kb, file_name=file, preview=not download)
```

- [ ] **Step 4: 运行确认通过**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_adapters.py -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
sudo chown admin chayuan/server/file_service/adapters/kb_doc.py
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/file_service/adapters/kb_doc.py libs/chayuan-server/tests/unit_tests/test_file_service_adapters.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): kb-doc adapter(复用 download_doc + can_read_kb)"
```

---

### Task 5: `GET /v1/files` 端点 + 注册 + adapter 自注册

**Files:**
- Create: `chayuan/server/api_server/file_routes.py`
- Modify: `chayuan/server/file_service/__init__.py`(import 三 adapter 触发 register)
- Modify: `chayuan/server/api_server/server_app.py:177`(include_router)
- Test: `tests/unit_tests/test_file_routes.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_file_routes.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    # 让 require_auth_enabled 直接放行,返回固定 user(隔离鉴权,只测分发)
    from chayuan.server.auth import deps
    monkeypatch.setattr(deps, "require_auth_enabled", lambda: (lambda: {"id": "u"}))
    from chayuan.server.api_server.file_routes import file_router
    app = FastAPI()
    app.include_router(file_router)
    return TestClient(app, raise_server_exceptions=False)


def test_unknown_kind_400(client):
    r = client.get("/v1/files", params={"kind": "nope"})
    assert r.status_code == 400


def test_artifact_404_when_missing(client, monkeypatch):
    from chayuan.server.file_service.adapters import artifact as mod
    monkeypatch.setattr(mod, "find_by_filename", lambda n: None)
    monkeypatch.setattr(mod, "fetch_from_storage", lambda n: None)
    r = client.get("/v1/files", params={"kind": "artifact", "name": "x.png"})
    assert r.status_code == 404
```

- [ ] **Step 2: 运行确认失败**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_routes.py -p no:cacheprovider`
Expected: FAIL (file_routes 不存在)

- [ ] **Step 3a: 写端点**

```python
# chayuan/server/api_server/file_routes.py
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.file_service import registry
from chayuan.server.file_service.base import FileRequestError
import chayuan.server.file_service.adapters as _adapters_pkg  # noqa: F401  触发自注册

file_router = APIRouter(prefix="/v1/files", tags=["Files"])


@file_router.get("", summary="统一文件下载/预览(kind 分发到各来源 adapter)")
def get_file(
    request: Request,
    kind: str = Query(..., description="kb-doc|image|artifact|dh-*|vg-*"),
    download: bool = Query(False),
    user=Depends(require_auth_enabled()),
):
    params = {k: v for k, v in request.query_params.items() if k not in ("kind", "download", "token")}
    try:
        return registry.dispatch(kind, params, user=user, download=download)
    except FileRequestError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
```

- [ ] **Step 3b: 三 adapter 自注册**

在 `chayuan/server/file_service/adapters/__init__.py` 写:

```python
from chayuan.server.file_service import registry
from chayuan.server.file_service.adapters.artifact import ArtifactAdapter
from chayuan.server.file_service.adapters.image import ImageAdapter
from chayuan.server.file_service.adapters.kb_doc import KbDocAdapter

registry.register(ArtifactAdapter())
registry.register(ImageAdapter())
registry.register(KbDocAdapter())
```

- [ ] **Step 3c: 注册 file_router** — 在 `server_app.py:177`(`app.include_router(artifacts_router)` 下一行)加:

```python
    from chayuan.server.api_server.file_routes import file_router
    app.include_router(file_router)
```

- [ ] **Step 4: 运行确认通过**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_routes.py -p no:cacheprovider`
Expected: PASS (2 passed)

- [ ] **Step 5: 提交**

```bash
sudo chown admin chayuan/server/api_server/file_routes.py chayuan/server/api_server/server_app.py chayuan/server/file_service/adapters/__init__.py
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/api_server/file_routes.py libs/chayuan-server/chayuan/server/api_server/server_app.py libs/chayuan-server/chayuan/server/file_service/adapters/__init__.py libs/chayuan-server/tests/unit_tests/test_file_routes.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): GET /v1/files 端点 + adapter 自注册 + 路由注册"
```

---

### Task 6: token 中间件 + nginx 白名单加 `/v1/files`

**Files:**
- Modify: `chayuan/server/auth/middleware.py:48-53`
- Modify: `docker/nginx.conf`(`@route` 的 `$spa=0` regex)
- Modify: `docker/nginx.split.conf`(同)

- [ ] **Step 1: token 白名单** — 在 `_QUERY_TOKEN_ALLOWED_PATHS`(middleware.py:48)元组里加一行:

```python
        "/v1/files",
```

- [ ] **Step 2: nginx** — 两个 conf 的 `@route` 里那条 `if ($uri ~* "^/(knowledge_base/(download|preview)_doc|v1/artifacts/|knowledge_source/[^/]+/image|storage/stream)")` 改为加上 `v1/files`:

```nginx
        if ($uri ~* "^/(v1/files|knowledge_base/(download|preview)_doc|v1/artifacts/|knowledge_source/[^/]+/image|storage/stream)") { set $spa "0"; }
```

- [ ] **Step 3: nginx 语法校验**

```bash
TMP=/tmp/nginx_test.conf; sed 's/^user .*/user nginx;/' docker/nginx.conf > "$TMP"
sudo docker run --rm -v "$TMP":/etc/nginx/nginx.conf:ro nginx:alpine nginx -t
```
Expected: `syntax is ok` + `test is successful`

- [ ] **Step 4: 提交**

```bash
sudo chown admin chayuan/server/auth/middleware.py docker/nginx.conf docker/nginx.split.conf
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/auth/middleware.py docker/nginx.conf docker/nginx.split.conf
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): /v1/files 加入 token + nginx 反代白名单"
```

---

### Task 7: 全量回归 + 版本 bump + 推送

- [ ] **Step 1: 跑文件服务相关测试**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -m pytest -q tests/unit_tests/test_file_service_registry.py tests/unit_tests/test_file_service_adapters.py tests/unit_tests/test_file_routes.py -p no:cacheprovider`
Expected: 全 PASS

- [ ] **Step 2: py_compile 改动文件**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -c "import ast,glob; [ast.parse(open(f).read()) for f in glob.glob('libs/chayuan-server/chayuan/server/file_service/**/*.py', recursive=True)+['libs/chayuan-server/chayuan/server/api_server/file_routes.py']]; print('AST OK')"`
Expected: AST OK

- [ ] **Step 3: 版本 bump(改了后端业务代码)**

Run: `cd /work/chayuan-desktop && sudo /usr/bin/python3.11 scripts/bump-version.py`
Expected: 打印新版本(全 6 文件同步,含 _FALLBACK_VERSION)

- [ ] **Step 4: 提交版本 + 推送**

```bash
sudo git -c core.fileMode=false add -- VERSION chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-server/libs/chayuan-server/pyproject.toml chayuan-server/libs/chayuan-server/chayuan/__init__.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "chore: bump version(统一文件端点阶段1)"
sudo git push origin main
```

---

## 阶段1验收

- `GET /v1/files?kind=artifact&name=<sha>.<ext>&token=` 返回产物(本地优先+minio回填);`download=1` 触发下载。
- `GET /v1/files?kind=image&source_id=&image_id=&token=` 同源 stream 图片(权限校验)。
- `GET /v1/files?kind=kb-doc&kb=&file=&token=` 预览/下载 KB 文档(ACL 校验,office 走现有解析)。
- 旧端点(`/v1/artifacts`、`/knowledge_source/.../image`、`/knowledge_base/download_doc`)**全部不变、继续可用**。
- nginx `/v1/files` 整页导航也反代后端(不被 SPA 吞)。

## 后续阶段(各自出 plan,本计划不展开)

- **阶段2** 前端统一解析层:`FileRef` + `resolveFileUrl/downloadFile/openFilePreview`;KB/图片/artifact 各处下载预览切 `/v1/files`(根治 `KbResultsView` 的 `window.open`);`useFileUrl` 收敛;前端 typecheck。
- **阶段3** 后端 dh/vg adapter(先读本地兼容) + 前端 DH/VG 下载预览切新端点。
- **阶段4** DH/VG 产物接 file_storage(新 NS DH_ARTIFACTS/VG_ARTIFACTS,镜像+回填)——多副本铺路(单容器可延后)。
- **阶段5** 旧端点转薄壳转调 adapter(可选/长期并存)。

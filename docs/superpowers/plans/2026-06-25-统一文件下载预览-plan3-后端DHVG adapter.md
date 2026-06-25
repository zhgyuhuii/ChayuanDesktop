# 统一文件下载/预览 — 阶段3实施计划（后端 DH/VG adapter，让 /v1/files 覆盖全部 6 类）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps `- [ ]`.

**Goal:** 给 `/v1/files` 加 dh-task/dh-avatar/dh-product/vg-task/vg-material/vg-bgm 六个 kind 的 adapter,复用现有 DH/VG 定位+authz 逻辑(先读本地,阶段4再接 file_storage)。旧 DH/VG 端点不动并存。

**Architecture:** 新建共享 `file_service/_response.py`(file_response helper) + `adapters/dh.py`(3 adapter)、`adapters/vg.py`(3 adapter),复用 `digital_human.store/jobs`、`video_generation.service/binaries/_helpers/materials_store`。adapters/__init__.py 注册全部。前端 DH/VG 切换**不在本阶段**(需异步-src 重构,DH/VG 当前没坏,延后)。

**Tech Stack:** Python/FastAPI;沙箱 pytest 跑不了(conftest 权限+缺 sqlalchemy/jwt),adapter 逻辑用 sys.modules 桩/直接 python 验证 + AST,真机 pytest 待验。

**前置:** 阶段1框架(file_service/base+registry+file_routes)已上线。本仓 root 所有:编辑前 `sudo chown admin <file>`;commit `sudo git -c core.fileMode=false ...`;不 push(controller 末尾推);不 bump(controller 做)。基准目录 `/work/chayuan-desktop/chayuan-server`,模块 `libs/chayuan-server/chayuan/server/`。

**已确认 import**(直接用):
- `from chayuan.server.auth.deps import owner_id_of`
- `from chayuan.server.video_generation.digital_human import store as dh_store`(resolve_avatar_path/resolve_product_path)、`from chayuan.server.video_generation.digital_human import jobs as dh_jobs`(get_status)
- `from chayuan.server.video_generation import service as vg_service`(get_task)、`from chayuan.server.video_generation import binaries`(get_bgm_dir)
- `from chayuan.server.video_generation._helpers import task_dir, song_dir, resolve_path_within_directory`
- **待 grep 确认**:vg 素材 `get_material` 的模块——`grep -rn "def get_material" libs/chayuan-server/chayuan/server/video_generation/`,用实际模块路径 import(很可能 `chayuan.server.video_generation.materials_store`)。若找不到立即 BLOCKED 报告。

---

## 文件结构
- Create `chayuan/server/file_service/_response.py` — file_response(path, download, media_type, filename)
- Create `chayuan/server/file_service/adapters/dh.py` — DhTaskAdapter/DhAvatarAdapter/DhProductAdapter
- Create `chayuan/server/file_service/adapters/vg.py` — VgTaskAdapter/VgMaterialAdapter/VgBgmAdapter
- Modify `chayuan/server/file_service/adapters/__init__.py` — 注册新 6 个
- Test `tests/unit_tests/test_file_service_dhvg.py`

---

### Task 1: 共享 file_response + DH 三 adapter

**Files:**
- Create: `chayuan/server/file_service/_response.py`
- Create: `chayuan/server/file_service/adapters/dh.py`
- Test: `tests/unit_tests/test_file_service_dhvg.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_file_service_dhvg.py
import pytest
from chayuan.server.file_service.base import FileRequestError


def test_dh_avatar_missing_ref():
    from chayuan.server.file_service.adapters.dh import DhAvatarAdapter
    with pytest.raises(FileRequestError) as ei:
        DhAvatarAdapter().handle({}, {"id": "u"}, download=False)
    assert ei.value.status_code == 400


def test_dh_avatar_not_found(monkeypatch):
    from chayuan.server.file_service.adapters import dh as mod
    from chayuan.server.file_service.adapters.dh import DhAvatarAdapter
    monkeypatch.setattr(mod.dh_store, "resolve_avatar_path", lambda r: None)
    with pytest.raises(FileRequestError) as ei:
        DhAvatarAdapter().handle({"ref": "user:x"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404


def test_dh_avatar_ok(monkeypatch, tmp_path):
    from chayuan.server.file_service.adapters import dh as mod
    from chayuan.server.file_service.adapters.dh import DhAvatarAdapter
    p = tmp_path / "a.png"; p.write_bytes(b"x")
    monkeypatch.setattr(mod.dh_store, "resolve_avatar_path", lambda r: str(p))
    from fastapi.responses import FileResponse
    assert isinstance(DhAvatarAdapter().handle({"ref": "user:a"}, {"id": "u"}, download=False), FileResponse)


def test_dh_task_not_ready(monkeypatch):
    from chayuan.server.file_service.adapters import dh as mod
    from chayuan.server.file_service.adapters.dh import DhTaskAdapter
    class _St:  state = "running"; result_path = ""
    monkeypatch.setattr(mod.dh_jobs, "get_status", lambda tid, oid: _St())
    monkeypatch.setattr(mod, "owner_id_of", lambda u: None)
    with pytest.raises(FileRequestError) as ei:
        DhTaskAdapter().handle({"task_id": "t1"}, {"id": "u"}, download=True)
    assert ei.value.status_code == 404
```

- [ ] **Step 2: 确认失败**

Run: `PYTHONPATH=libs/chayuan-server python3.11 -c "import chayuan.server.file_service.adapters.dh"`
Expected: ModuleNotFoundError

- [ ] **Step 3: 写实现**

```python
# chayuan/server/file_service/_response.py
from __future__ import annotations
import os
from typing import Optional
from fastapi.responses import FileResponse


def file_response(path: str, download: bool, *, media_type: Optional[str] = None,
                  filename: Optional[str] = None) -> FileResponse:
    headers = {}
    if download:
        fn = filename or os.path.basename(path)
        headers["Content-Disposition"] = f'attachment; filename="{fn}"'
    return FileResponse(path, media_type=media_type, headers=headers)
```

```python
# chayuan/server/file_service/adapters/dh.py
from __future__ import annotations
import os
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.file_service._response import file_response
from chayuan.server.video_generation.digital_human import store as dh_store
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.auth.deps import owner_id_of


class DhAvatarAdapter:
    kind = "dh-avatar"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        ref = (params.get("ref") or "").strip()
        if not ref:
            raise FileRequestError(400, "missing ref")
        p = dh_store.resolve_avatar_path(ref)
        if not p or not os.path.isfile(p):
            raise FileRequestError(404, "avatar not found")
        return file_response(p, download)


class DhProductAdapter:
    kind = "dh-product"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        ref = (params.get("ref") or "").strip()
        if not ref:
            raise FileRequestError(400, "missing ref")
        p = dh_store.resolve_product_path(ref)
        if not p or not os.path.isfile(p):
            raise FileRequestError(404, "product not found")
        return file_response(p, download)


class DhTaskAdapter:
    kind = "dh-task"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        tid = (params.get("task_id") or "").strip()
        if not tid:
            raise FileRequestError(400, "missing task_id")
        st = dh_jobs.get_status(tid, owner_id_of(user))
        if getattr(st, "state", None) != "complete" or not os.path.isfile(getattr(st, "result_path", "") or ""):
            raise FileRequestError(404, "product not ready")
        return file_response(st.result_path, download, media_type="video/mp4", filename="digital_human.mp4")
```

- [ ] **Step 4: 验证**

AST 校验三文件。逻辑验证(sys.modules 桩绕 video_generation 重依赖,或 monkeypatch.setattr 跑前 3 个 avatar 测试 + dh_task not_ready)。能跑则跑,不能则 AST + 记录待真机。用 python3.11。

- [ ] **Step 5: 提交**

```bash
sudo chown admin chayuan/server/file_service/_response.py chayuan/server/file_service/adapters/dh.py 2>/dev/null
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/file_service/_response.py libs/chayuan-server/chayuan/server/file_service/adapters/dh.py libs/chayuan-server/tests/unit_tests/test_file_service_dhvg.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): DH adapter(task/avatar/product)复用现有定位+owner校验"
```

---

### Task 2: VG 三 adapter

**Files:**
- Create: `chayuan/server/file_service/adapters/vg.py`
- Test: `tests/unit_tests/test_file_service_dhvg.py`(追加)

- [ ] **Step 1: grep 确认 get_material 模块**

Run: `grep -rn "def get_material" libs/chayuan-server/chayuan/server/video_generation/`
记下模块路径(预期 `materials_store`),用于下面 import。找不到 → BLOCKED 报告。

- [ ] **Step 2: 追加测试**

```python
def test_vg_task_missing_params():
    from chayuan.server.file_service.adapters.vg import VgTaskAdapter
    with pytest.raises(FileRequestError) as ei:
        VgTaskAdapter().handle({"task_id": "t"}, {"id": "u"}, download=False)  # 缺 file
    assert ei.value.status_code == 400


def test_vg_task_not_found(monkeypatch):
    from chayuan.server.file_service.adapters import vg as mod
    from chayuan.server.file_service.adapters.vg import VgTaskAdapter
    monkeypatch.setattr(mod.vg_service, "get_task", lambda tid, owner_id=None: None)
    monkeypatch.setattr(mod, "owner_id_of", lambda u: None)
    with pytest.raises(FileRequestError) as ei:
        VgTaskAdapter().handle({"task_id": "t", "file": "a.mp4"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404


def test_vg_bgm_not_found(monkeypatch):
    from chayuan.server.file_service.adapters import vg as mod
    from chayuan.server.file_service.adapters.vg import VgBgmAdapter
    monkeypatch.setattr(mod.binaries, "get_bgm_dir", lambda: None)
    monkeypatch.setattr(mod, "song_dir", lambda: "/nonexistent")
    with pytest.raises(FileRequestError) as ei:
        VgBgmAdapter().handle({"name": "x.mp3"}, {"id": "u"}, download=False)
    assert ei.value.status_code == 404
```

- [ ] **Step 3: 写实现**(把 `MATERIALS_MODULE` 换成 Step 1 grep 到的真实模块)

```python
# chayuan/server/file_service/adapters/vg.py
from __future__ import annotations
import os
from typing import Mapping, Optional
from fastapi import Response
from chayuan.server.file_service.base import FileRequestError
from chayuan.server.file_service._response import file_response
from chayuan.server.video_generation import service as vg_service
from chayuan.server.video_generation import binaries
from chayuan.server.video_generation._helpers import task_dir, song_dir, resolve_path_within_directory
from chayuan.server.video_generation import materials_store  # ← 按 Step1 grep 实际模块改
from chayuan.server.auth.deps import owner_id_of


class VgTaskAdapter:
    kind = "vg-task"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        tid = (params.get("task_id") or "").strip()
        file = (params.get("file") or "").strip()
        if not tid or not file:
            raise FileRequestError(400, "missing task_id/file")
        if not vg_service.get_task(tid, owner_id=owner_id_of(user)):
            raise FileRequestError(404, "task not found")
        try:
            real = resolve_path_within_directory(task_dir(tid, create=False), file, require_file=True)
        except ValueError:
            raise FileRequestError(404, "file not found")
        return file_response(real, download)


class VgMaterialAdapter:
    kind = "vg-material"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        mid = (params.get("material_id") or "").strip()
        if not mid:
            raise FileRequestError(400, "missing material_id")
        row = materials_store.get_material(mid, owner_id=owner_id_of(user))
        if not row:
            raise FileRequestError(404, "material not found")
        path = row.get("path") or ""
        if path and not os.path.isfile(path):
            from chayuan.server.video_generation._helpers import storage_dir
            alt = os.path.join(storage_dir("materials"), os.path.basename(path))
            if os.path.isfile(alt):
                path = alt
        if not path or not os.path.isfile(path):
            raise FileRequestError(404, "material file missing")
        return file_response(path, download, media_type=row.get("mime") or None)


class VgBgmAdapter:
    kind = "vg-bgm"
    def handle(self, params: Mapping[str, str], user: Optional[dict], *, download: bool) -> Response:
        name = (params.get("name") or "").strip()
        if not name:
            raise FileRequestError(400, "missing name")
        base = os.path.basename(name)
        for d in (binaries.get_bgm_dir(), song_dir()):
            if d:
                p = os.path.join(d, base)
                if os.path.isfile(p):
                    return file_response(p, download)
        raise FileRequestError(404, "bgm not found")
```

- [ ] **Step 4: 验证** — AST 三测试通过 + 逻辑(桩)验证 vg_task missing/not_found、vg_bgm not_found。能跑则跑,不能 AST+记录。

- [ ] **Step 5: 提交**

```bash
sudo chown admin chayuan/server/file_service/adapters/vg.py 2>/dev/null
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/file_service/adapters/vg.py libs/chayuan-server/tests/unit_tests/test_file_service_dhvg.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): VG adapter(task/material/bgm)复用现有定位+owner校验"
```

---

### Task 3: 注册 6 个新 adapter

**Files:**
- Modify: `chayuan/server/file_service/adapters/__init__.py`

- [ ] **Step 1: 追加注册** — 在现有 register 三个之后加:

```python
from chayuan.server.file_service.adapters.dh import DhTaskAdapter, DhAvatarAdapter, DhProductAdapter
from chayuan.server.file_service.adapters.vg import VgTaskAdapter, VgMaterialAdapter, VgBgmAdapter

registry.register(DhTaskAdapter())
registry.register(DhAvatarAdapter())
registry.register(DhProductAdapter())
registry.register(VgTaskAdapter())
registry.register(VgMaterialAdapter())
registry.register(VgBgmAdapter())
```

- [ ] **Step 2: AST 校验** `adapters/__init__.py`。

- [ ] **Step 3: 提交**

```bash
sudo chown admin chayuan/server/file_service/adapters/__init__.py 2>/dev/null
sudo git -c core.fileMode=false add -- libs/chayuan-server/chayuan/server/file_service/adapters/__init__.py
sudo git -c core.fileMode=false -c user.name='chayuan-dev' -c user.email='zhgyuhuig@gmail.com' commit -m "feat(files): 注册 DH/VG 六个 adapter(/v1/files 覆盖全部来源)"
```

---

## 阶段3(后端)验收
- `/v1/files?kind=dh-task&task_id=&token=`、`dh-avatar&ref=`、`dh-product&ref=`、`vg-task&task_id=&file=`、`vg-material&material_id=`、`vg-bgm&name=` 全部可用(复用各自 authz+定位)。
- 旧 DH/VG 端点全部不变并存。
- AST 全过;adapter 逻辑桩验证过;真机 pytest 待验:`PYTHONPATH=libs/chayuan-server python3.11 -m pytest libs/chayuan-server/tests/unit_tests/test_file_service_dhvg.py`。

## 后续(本阶段不做)
- 前端 DH/VG 切 /v1/files:需把 dhTaskFileUrl/vgTaskFileUrl 等**同步 src**(用于 `<img/video src>`)改成**异步 resolveFileUrl**(useState/useEffect 解析),触及 ~14 个调用点 + 多个组件。DH/VG 当前没坏,建议真机验证阶段1+2 后单独出 plan 做。FileRef 届时加 dh/vg 变体。
- 阶段4:DH/VG 接 file_storage(NS DH_ARTIFACTS/VG_ARTIFACTS+回填)。阶段5:旧端点转薄壳。

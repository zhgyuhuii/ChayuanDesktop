# 视频生成「完成最后配置」弹框重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `MaterialsBgmOutputDialog` 从三段(素材+BGM+输出)收敛为两段(素材三 tab + BGM),补齐缩略图/预览/删除、在线搜索自动英文化、从链接抽取多媒体、BGM 上游移植试听,移除与 toolbar 重复的在线源 key / 字幕 / 渲染配置。

**Architecture:** 后端新增/改 4 个 endpoint(extract-media、search auto_translate、bgm 试听文件、materials ingest)+ 1 个 seed 脚本;前端在已有三 tab `MaterialsStep` 上增强(MineTab 预览删除、OnlineTab 英文化+入库、新 LinkTab),改 `MaterialsSection`/`BgmSection`,从 Dialog 删 `OutputSection`。

**Tech Stack:** chayuan-server(FastAPI / stdlib HTMLParser / yt-dlp / ffmpeg / pytest)、chayuan-client(React 19 / TanStack Query / Zustand / pnpm workspace / tsc)。

**前置已完成(不入本 plan):** `_config_shim._VgConfig.proxy` 修复(`/materials/search` 500)已落地。

**Spec:** `docs/superpowers/specs/2026-05-29-vg-materials-bgm-dialog-redesign.md`

---

## File Structure

**chayuan-server**(`libs/chayuan-server/`):
- `chayuan/server/video_generation/url_extractor.py` — 加 `extract_media(url)`,职责:URL → 媒体列表(网页 img/video/source/og + yt-dlp 探测)。
- `chayuan/server/video_generation/steps/materials.py` — 加 `save_image(url, save_dir)`(图像下载,复用 save_video 风格)。
- `chayuan/server/api_server/video_generation_routes.py` — 加 `GET /materials/extract-media`、`POST /materials/ingest`、`GET /bgm/{name}/file`;改 `GET /materials/search`(加 `auto_translate`)。
- `scripts/seed_bgm.py` — 新建,ffmpeg 转码上游 29 首 BGM 到 `vendor/bundled_bgm/`。
- `tests/unit_tests/test_vg_extract_media.py`、`tests/unit_tests/test_vg_search_translate.py` — 新建单测。

**chayuan-client**(`packages/`):
- `api/src/videoGeneration.ts` — 加 `vgExtractMedia`、`vgIngestMedia`、`vgBgmFileUrl`;`vgSearchMaterials` 加 `auto_translate` + 返回 `translated_query`;类型 `VgExtractedMedia`、`VgMediaItem`。
- `app/src/features/video-generation/steps/MaterialsStep.tsx` — MineTab 缩略图/预览/删除;OnlineTab 英文化回显 + 入库;新 LinkTab;tab 列表加「从链接」。
- `app/src/features/video-generation/sections/MaterialsSection.tsx` — 删 `OnlineSourceChips`。
- `app/src/features/video-generation/sections/BgmSection.tsx` — 加试听 `<audio>` + 上传按钮。
- `app/src/features/video-generation/MaterialsBgmOutputDialog.tsx` — 删 `OutputSection` 引用。

---

## Task 1: 后端 `extract_media()` — 网页多媒体解析

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/url_extractor.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_extract_media.py`

- [ ] **Step 1: Write the failing test**

Create `libs/chayuan-server/tests/unit_tests/test_vg_extract_media.py`:

```python
from chayuan.server.video_generation.url_extractor import _parse_media_from_html


def test_parse_media_extracts_img_video_source_og():
    html = b"""
    <html><head>
      <meta property="og:image" content="https://x.com/og.jpg">
      <meta property="og:video" content="https://x.com/og.mp4">
    </head><body>
      <img src="https://x.com/a.png">
      <img src="/rel/b.jpg">
      <video src="https://x.com/c.mp4"></video>
      <video><source src="https://x.com/d.webm" type="video/webm"></video>
      <img src="data:image/gif;base64,AAAA">
    </body></html>
    """
    items = _parse_media_from_html(html, "https://x.com/page", "utf-8")
    urls = [it["url"] for it in items]
    assert "https://x.com/og.jpg" in urls
    assert "https://x.com/og.mp4" in urls
    assert "https://x.com/a.png" in urls
    assert "https://x.com/rel/b.jpg" in urls   # 相对路径已 urljoin
    assert "https://x.com/c.mp4" in urls
    assert "https://x.com/d.webm" in urls
    assert all(not u.startswith("data:") for u in urls)  # data URI 丢弃
    kinds = {it["url"]: it["kind"] for it in items}
    assert kinds["https://x.com/a.png"] == "image"
    assert kinds["https://x.com/c.mp4"] == "video"


def test_parse_media_dedups():
    html = b'<img src="https://x.com/a.png"><img src="https://x.com/a.png">'
    items = _parse_media_from_html(html, "https://x.com/p", "utf-8")
    assert sum(1 for it in items if it["url"] == "https://x.com/a.png") == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_extract_media.py -v`
Expected: FAIL — `ImportError: cannot import name '_parse_media_from_html'`

- [ ] **Step 3: Implement `_parse_media_from_html` + `extract_media` in `url_extractor.py`**

在 `url_extractor.py` 末尾(`extract_url` 之后)追加:

```python
from html.parser import HTMLParser as _HTMLParser  # 已 import,复用顶部
from urllib.parse import urljoin

_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")
_VIDEO_EXTS = (".mp4", ".webm", ".mov", ".m4v", ".mkv")


def _kind_of(url: str) -> str:
    low = url.split("?")[0].lower()
    if low.endswith(_VIDEO_EXTS):
        return "video"
    if low.endswith(_IMAGE_EXTS):
        return "image"
    return "image"  # 默认按图处理(og:image 等无扩展名场景)


class _MediaHTMLParser(_HTMLParser):
    """抽 <img src>/<video src>/<source src>/og:image/og:video 的媒体 URL。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.raw: list[tuple[str, str]] = []  # (url, forced_kind|"")

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        d = dict(attrs)
        t = tag.lower()
        if t == "img" and d.get("src"):
            self.raw.append((d["src"], "image"))
        elif t in ("video", "source") and d.get("src"):
            self.raw.append((d["src"], "video"))
        elif t == "meta":
            prop = (d.get("property") or d.get("name") or "").lower()
            content = d.get("content") or ""
            if content and prop in ("og:image", "twitter:image"):
                self.raw.append((content, "image"))
            elif content and prop in ("og:video", "og:video:url"):
                self.raw.append((content, "video"))


def _parse_media_from_html(body: bytes, base_url: str, encoding):  # noqa: ANN001
    enc = (encoding or "utf-8").strip() or "utf-8"
    try:
        html = body.decode(enc, errors="replace")
    except LookupError:
        html = body.decode("utf-8", errors="replace")
    parser = _MediaHTMLParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("[extract_media] HTML parse 失败: %r", e)
    out: list[dict] = []
    seen: set[str] = set()
    for src, forced in parser.raw:
        if not src or src.startswith("data:"):
            continue
        absolute = urljoin(base_url, src.strip())
        if not absolute.startswith(("http://", "https://")):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        out.append({"url": absolute, "kind": forced or _kind_of(absolute)})
    return out


def extract_media(url: str, max_items: int = 60) -> dict:
    """URL → {items:[{url,kind,thumb,title}], source_url}.

    先 yt-dlp 探测(视频平台,可含 playlist);非平台或 yt-dlp 不可用则回退
    抓 HTML 解析 <img>/<video>/og:*。失败抛 ValueError 给路由转 4xx。
    """
    if not url or not url.strip():
        raise ValueError("URL 不能为空")
    url = url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("仅支持 http(s) URL")

    # 1. yt-dlp 探测(不下载,只 extract_info)
    try:
        import yt_dlp  # type: ignore[import-not-found]
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
        entries = info.get("entries") if isinstance(info, dict) else None
        vids = entries if entries else ([info] if info else [])
        items = []
        for e in vids:
            if not e:
                continue
            page = e.get("webpage_url") or e.get("original_url") or e.get("url") or url
            items.append({
                "url": page,
                "kind": "video",
                "thumb": e.get("thumbnail") or "",
                "title": e.get("title") or "",
                "via": "ytdlp",
            })
        if items:
            return {"items": items[:max_items], "source_url": url}
    except Exception as e:  # noqa: BLE001
        logger.info("[extract_media] yt-dlp 未命中(%r),回退 HTML 抓取", e)

    # 2. HTML 抓取
    try:
        resp = requests.get(
            url, timeout=_FETCH_TIMEOUT_S, stream=True,
            headers={"User-Agent": "chayuan-video-generation/1.0"},
        )
    except requests.RequestException as e:
        raise ValueError(f"抓取失败: {e}") from e
    try:
        if resp.status_code >= 400:
            raise ValueError(f"HTTP {resp.status_code}")
        ct = (resp.headers.get("Content-Type") or "").lower()
        body = b""
        for chunk in resp.iter_content(chunk_size=1 << 16):
            if chunk:
                body += chunk
                if len(body) > _MAX_FETCH_BYTES:
                    break
    finally:
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass
    if "html" not in ct and "xml" not in ct:
        raise ValueError(f"该 URL 不是网页也非视频平台({ct or '未知类型'}),无法提取媒体")
    items = [{**m, "thumb": m["url"] if m["kind"] == "image" else "", "title": "", "via": "html"}
             for m in _parse_media_from_html(body, url, resp.encoding)]
    if not items:
        raise ValueError("该页面未发现可提取的图片/视频")
    return {"items": items[:max_items], "source_url": url}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_extract_media.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/url_extractor.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_extract_media.py
git commit -m "feat(server/vg): url_extractor.extract_media 网页多媒体抓取 + yt-dlp 探测"
```

---

## Task 2: 后端 `save_image` + `POST /materials/ingest` + `GET /materials/extract-media`

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/materials.py`
- Modify: `libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

- [ ] **Step 1: 加 `save_image` 到 `materials.py`**

在 `materials.py` 的 `save_video` 之后追加(复用同款 headers/proxy/tls):

```python
def save_image(image_url: str, save_dir: str = "") -> str:
    """下载图像到 save_dir,返回本地路径;失败返回 ""。"""
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")
    if not os.path.exists(save_dir):
        os.makedirs(save_dir)
    url_without_query = image_url.split("?")[0]
    ext = os.path.splitext(url_without_query)[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
        ext = ".jpg"
    img_id = f"img-{utils.md5(url_without_query)}"
    img_path = f"{save_dir}/{img_id}{ext}"
    if os.path.exists(img_path) and os.path.getsize(img_path) > 0:
        return img_path
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    try:
        content = requests.get(
            image_url, headers=headers, proxies=config.proxy,
            verify=_get_tls_verify(), timeout=(30, 120),
        ).content
        with open(img_path, "wb") as f:
            f.write(content)
    except Exception as e:  # noqa: BLE001
        logger.error(f"download image failed: {image_url} => {e}")
        return ""
    if os.path.exists(img_path) and os.path.getsize(img_path) > 0:
        return img_path
    return ""
```

- [ ] **Step 2: 加 `GET /materials/extract-media` 路由**

在 `video_generation_routes.py` 的 `search_materials`(line ~575)之后追加:

```python
@video_generation_router.get(
    "/materials/extract-media",
    summary="从链接提取多个媒体(网页 img/video + 视频平台)",
)
def extract_media_route(
    url: str = Query(..., min_length=4, max_length=2048),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.url_extractor import extract_media
    try:
        return extract_media(url)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.warning("[vg] extract-media 异常: %r", e)
        raise HTTPException(502, f"提取失败: {e}") from e
```

- [ ] **Step 3: 加 `POST /materials/ingest` 路由(下载远程媒体 → 落库)**

继续追加。用现有 `materials_store.create_material`(routes 里调用不需显式 session,跟 `delete_material` 一致):

```python
@video_generation_router.post(
    "/materials/ingest",
    summary="把远程媒体(在线搜索/链接结果)下载落地并登记进素材库",
    status_code=status.HTTP_201_CREATED,
)
def ingest_material(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    """body: {url:str, kind:'video'|'image', source:str}. 返回新建的 VgMaterial。"""
    from chayuan.server.video_generation.steps import materials as materials_step
    from chayuan.server.video_generation._helpers import storage_dir

    url = str(body.get("url") or "").strip()
    kind = str(body.get("kind") or "video").strip()
    source = str(body.get("source") or "online").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "url 必须是 http(s)")

    mat_dir = storage_dir("materials", create=True)
    if kind == "image":
        path = materials_step.save_image(url, save_dir=mat_dir)
        mime = "image/jpeg"
    else:
        path = materials_step.save_video(url, save_dir=mat_dir)
        mime = "video/mp4"
    if not path or not os.path.isfile(path):
        raise HTTPException(502, "下载失败或文件无效")

    row = materials_store.create_material(
        source=source,
        name=os.path.basename(path),
        path=path,
        owner_id=_owner_id_of(user),
        mime=mime,
        size=os.path.getsize(path),
        tags=["online", source],
    )
    return row
```

确认顶部已 import `Body`(`from fastapi import ... Body ...`);若缺,加进 import。

- [ ] **Step 4: 编译校验**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. python -m py_compile chayuan/server/video_generation/steps/materials.py chayuan/server/api_server/video_generation_routes.py`
Expected: 无输出(成功)

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/materials.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
git commit -m "feat(server/vg): save_image + /materials/extract-media + /materials/ingest"
```

---

## Task 3: 后端 `/materials/search` 自动英文化

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py:543-575`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_search_translate.py`

- [ ] **Step 1: Write the failing test**

Create `libs/chayuan-server/tests/unit_tests/test_vg_search_translate.py`:

```python
from chayuan.server.api_server import video_generation_routes as r


def test_maybe_translate_query_ascii_passthrough():
    # 纯英文/ASCII 直接原样返回,不调 LLM
    assert r._maybe_translate_query("spring flower", True) == "spring flower"


def test_maybe_translate_query_disabled():
    assert r._maybe_translate_query("春天的花", False) == "春天的花"


def test_maybe_translate_query_cjk_uses_terms(monkeypatch):
    # 含中文 + 开启 → 走 generate_terms,取首个英文词
    import chayuan.server.video_generation.steps.script as script
    monkeypatch.setattr(script, "generate_terms", lambda subj, scr, amount=1, **k: ["spring flower"])
    assert r._maybe_translate_query("春天的花", True) == "spring flower"


def test_maybe_translate_query_terms_empty_fallback(monkeypatch):
    import chayuan.server.video_generation.steps.script as script
    monkeypatch.setattr(script, "generate_terms", lambda subj, scr, amount=1, **k: [])
    # generate_terms 返空 → 回退原词
    assert r._maybe_translate_query("春天的花", True) == "春天的花"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_search_translate.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_maybe_translate_query'`

- [ ] **Step 3: 实现 `_maybe_translate_query` + 接到 `search_materials`**

在 `video_generation_routes.py` 的 `search_materials` 函数**之前**加 helper:

```python
def _maybe_translate_query(q: str, auto_translate: bool) -> str:
    """非 ASCII(含中文)且开启时,用 generate_terms 转英文取首词;否则原样返回。

    Pexels/Pixabay stock 库是英文标签索引,中文 query 命中率近 0。
    """
    if not auto_translate:
        return q
    if q.isascii():
        return q
    try:
        from chayuan.server.video_generation.steps import script as script_step
        terms = script_step.generate_terms(q, q, amount=1)
        if terms and isinstance(terms, list) and terms[0].strip():
            return terms[0].strip()
    except Exception as e:  # noqa: BLE001
        logger.warning("[vg] search 英文化失败,用原词: %r", e)
    return q
```

改 `search_materials` 签名 + body(line ~547):

```python
def search_materials(
    q: str = Query(..., min_length=1, max_length=120),
    source: str = Query("pexels", pattern="^(pexels|pixabay)$"),
    aspect: str = Query("9:16", pattern="^(16:9|9:16|1:1)$"),
    minimum_duration: int = Query(5, ge=1, le=120),
    auto_translate: bool = Query(True, description="非英文 query 自动转英文再搜"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.steps import materials as materials_step
    from chayuan.server.video_generation.schemas import VideoAspect
    effective_q = _maybe_translate_query(q, auto_translate)
    try:
        fn = (
            materials_step.search_videos_pexels if source == "pexels"
            else materials_step.search_videos_pixabay
        )
        items = fn(
            search_term=effective_q,
            minimum_duration=minimum_duration,
            video_aspect=VideoAspect(aspect),
        )
    except ValueError as e:
        raise HTTPException(412, str(e)) from e
    return {
        "count": len(items),
        "query": q,
        "translated_query": effective_q if effective_q != q else None,
        "items": [
            {"provider": it.provider, "url": it.url, "duration": it.duration}
            for it in items
        ],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_search_translate.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_search_translate.py
git commit -m "feat(server/vg): /materials/search auto_translate 中文自动转英文再搜"
```

---

## Task 4: 后端 BGM 试听 endpoint `GET /bgm/{name}/file`

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`(`list_bgm` 之后,line ~613)

- [ ] **Step 1: 加路由**

在 `list_bgm` 之后、`upload_bgm` 之前追加。按文件名在 bundled + 用户目录里查,杜绝路径遍历:

```python
@video_generation_router.get(
    "/bgm/{name}/file", summary="BGM 文件流式(试听/下载)",
)
def serve_bgm_file(
    name: str = FPath(..., max_length=255),
    download: bool = Query(False),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    from chayuan.server.video_generation import binaries
    from chayuan.server.video_generation._helpers import song_dir

    base = os.path.basename(name)  # 去路径分量,防遍历
    candidates: List[str] = []
    bundled = binaries.get_bgm_dir()
    if bundled:
        candidates.append(os.path.join(bundled, base))
    candidates.append(os.path.join(song_dir(), base))
    for p in candidates:
        if os.path.isfile(p):
            headers: Dict[str, str] = {}
            if download:
                headers["Content-Disposition"] = f'attachment; filename="{base}"'
            return FileResponse(p, headers=headers)
    raise HTTPException(404, f"BGM not found: {base}")
```

- [ ] **Step 2: 编译校验**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. python -m py_compile chayuan/server/api_server/video_generation_routes.py`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
git commit -m "feat(server/vg): /bgm/{name}/file 流式 endpoint(试听/下载)"
```

---

## Task 5: BGM seed 脚本(上游 29 首转码 96kbps)

**Files:**
- Create: `chayuan-server/scripts/seed_bgm.py`

- [ ] **Step 1: 写脚本**

Create `chayuan-server/scripts/seed_bgm.py`(参考 `seed_sherpa_voices.py` 风格;ffmpeg 转码,缺 ffmpeg 回退拷贝):

```python
#!/usr/bin/env python3
"""把上游 chayuan-video-generation/resource/songs/ 的 BGM 转码 96kbps 落到
vendor/bundled_bgm/,供打包/装机自带(full 版零下载)。

为什么转码:上游 29 首原始 56MB,96kbps 单声道足够当背景音 → ~20MB。
ffmpeg 不可用时回退直接拷贝(体积大但能用),并打印告警。

用法:
    python scripts/seed_bgm.py
    python scripts/seed_bgm.py --src /path/to/songs --bitrate 96k
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SRC = Path("/work/chayuan-video-generation/resource/songs")


def _bundled_bgm_dir() -> Path:
    here = Path(__file__).resolve()
    server_root = here.parents[1]  # chayuan-server/
    return server_root / "vendor" / "bundled_bgm"


def _have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _transcode(src: Path, dst: Path, bitrate: str) -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(src), "-vn", "-ac", "1",
             "-b:a", bitrate, str(dst)],
            check=True, capture_output=True,
        )
        return dst.is_file() and dst.stat().st_size > 0
    except Exception as e:  # noqa: BLE001
        print(f"[bgm] !! transcode {src.name} 失败: {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="seed bundled BGM")
    ap.add_argument("--src", default=str(DEFAULT_SRC))
    ap.add_argument("--bitrate", default="96k")
    args = ap.parse_args()

    src_dir = Path(args.src)
    dst_dir = _bundled_bgm_dir()
    if not src_dir.is_dir():
        print(f"[bgm] !! 源目录不存在: {src_dir}")
        return 1
    dst_dir.mkdir(parents=True, exist_ok=True)

    songs = sorted(p for p in src_dir.iterdir()
                   if p.suffix.lower() in (".mp3", ".wav", ".m4a", ".aac", ".ogg"))
    if not songs:
        print(f"[bgm] !! {src_dir} 无音频文件")
        return 1

    use_ffmpeg = _have_ffmpeg()
    if not use_ffmpeg:
        print("[bgm] ! 未找到 ffmpeg,回退直接拷贝(体积不压缩)")

    ok = 0
    for s in songs:
        dst = dst_dir / (s.stem + ".mp3")
        if dst.is_file() and dst.stat().st_size > 0:
            print(f"[bgm]    skip(已存在) {dst.name}")
            ok += 1
            continue
        if use_ffmpeg and _transcode(s, dst, args.bitrate):
            print(f"[bgm]    ok {dst.name}")
            ok += 1
        else:
            shutil.copy2(s, dst_dir / s.name)
            print(f"[bgm]    copied(未转码) {s.name}")
            ok += 1
    print(f"[bgm] done: {ok}/{len(songs)} → {dst_dir}")
    return 0 if ok == len(songs) else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 编译校验 + 试跑**

Run: `cd /work/chayuan-desktop/chayuan-server && python -m py_compile scripts/seed_bgm.py && python scripts/seed_bgm.py`
Expected: 编译无输出;试跑打印 `[bgm] done: 29/29`(ffmpeg 在则转码,缺则拷贝)。`vendor/bundled_bgm/` 出现 29 个 .mp3。

> 注:`vendor/bundled_bgm/*.mp3` 应被 `.gitignore` 忽略(跟字体/模型一致,不进 git,打包时 seed)。确认 `chayuan-server/.gitignore` 已含 `vendor/bundled_bgm/*.mp3` 或等价规则;若没有则补一行再提交脚本。

- [ ] **Step 3: Commit(只提交脚本,不提交 mp3)**

```bash
cd /work/chayuan-desktop
git add chayuan-server/scripts/seed_bgm.py
git status --short   # 确认没有 .mp3 被 staged
git commit -m "feat(server/vg): seed_bgm.py 上游 29 首 BGM 转码 96kbps 落 vendor"
```

---

## Task 6: 前端 API client 扩展

**Files:**
- Modify: `chayuan-client/packages/api/src/videoGeneration.ts`

- [ ] **Step 1: 加类型 + 函数**

在 `vgSearchMaterials`(line ~515)处:返回类型加 `translated_query`,参数加 `auto_translate`:

```typescript
export async function vgSearchMaterials(args: {
  q: string;
  source?: 'pexels' | 'pixabay';
  aspect?: VgVideoAspect;
  minimum_duration?: number;
  auto_translate?: boolean;
}): Promise<{ count: number; items: VgMaterialInfo[]; query?: string; translated_query?: string | null }> {
  return rd('/api/v1/video-generation/materials/search', {
    method: 'GET',
    query: {
      q: args.q,
      source: args.source ?? 'pexels',
      aspect: args.aspect ?? '9:16',
      minimum_duration: args.minimum_duration ?? 5,
      auto_translate: args.auto_translate ?? true,
    },
  });
}
```

在 `vgSearchMaterials` 之后追加 extract-media / ingest / bgm 文件 url:

```typescript
export interface VgMediaItem {
  url: string;
  kind: 'image' | 'video';
  thumb?: string;
  title?: string;
  via?: string;
}
export interface VgExtractedMedia {
  items: VgMediaItem[];
  source_url: string;
}

export async function vgExtractMedia(url: string): Promise<VgExtractedMedia> {
  return rd<VgExtractedMedia>('/api/v1/video-generation/materials/extract-media', {
    method: 'GET',
    query: { url },
  });
}

/** 下载远程媒体落库,返回新建 VgMaterial。 */
export async function vgIngestMedia(args: {
  url: string;
  kind: 'image' | 'video';
  source?: string;
}): Promise<VgMaterial> {
  return rd<VgMaterial>('/api/v1/video-generation/materials/ingest', {
    method: 'POST',
    body: { url: args.url, kind: args.kind, source: args.source ?? 'online' },
  });
}

/** BGM 试听/下载 URL。 */
export function vgBgmFileUrl(name: string, download = false): string {
  const cfg = getApiConfig();
  const u = `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/video-generation/bgm/${encodeURIComponent(name)}/file`;
  return download ? `${u}?download=true` : u;
}
```

> 注:`getApiConfig` / `rd` 的具体名称以本文件顶部既有 import 为准(参考 `vgMaterialFileUrl` line ~619 怎么取 baseURL,照抄同一方式)。

- [ ] **Step 2: 注册到默认导出对象**

在文件底部 `videoGeneration` 聚合对象(`extractUrl: vgExtractUrl,` 附近,line ~653)加:

```typescript
  extractMedia: vgExtractMedia,
  ingestMedia: vgIngestMedia,
  bgmFileUrl: vgBgmFileUrl,
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck`
Expected: 无类型错误(若该 filter 无 typecheck 脚本,用 `pnpm --filter @chayuan/api exec tsc --noEmit`)

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/api): vgExtractMedia/vgIngestMedia/vgBgmFileUrl + search auto_translate"
```

---

## Task 7: 前端 MineTab — 缩略图 / 预览 / 删除

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx:120-185`

- [ ] **Step 1: 改 import + MineTab**

文件顶部 import 加 `useMutation` 已有;加 `Trash2`、`Eye`(lucide)、`vgMaterialFileUrl`、`confirmDialog`:

```typescript
import { Library, Search, Upload, Link2, X, CheckCircle2, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { videoGeneration, vgMaterialFileUrl, type VgMaterial, type VgMaterialInfo } from '@chayuan/api';
import { confirmDialog } from '../../../store/confirmDialog';
```

替换 `MineTab`(line 120-185)整段为:

```typescript
const MineTab: React.FC<{
  selected: VgMaterialInfo[];
  onToggle: (item: VgMaterialInfo) => void;
  qc: ReturnType<typeof useQueryClient>;
}> = ({ selected, onToggle, qc }) => {
  const [preview, setPreview] = React.useState<VgMaterial | null>(null);
  const q = useQuery({
    queryKey: ['vg.materials', { page: 1, page_size: 50 }],
    queryFn: () => videoGeneration.listMaterials({ page: 1, page_size: 50 }),
    staleTime: 30_000,
  });
  const delMut = useMutation({
    mutationFn: (id: string) => videoGeneration.deleteMaterial(id, { drop_file: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['vg.materials'] }); },
    onError: (e) => reportError(e as Error, '删除素材失败'),
  });

  if (q.isLoading) return <div className="text-xs text-[var(--cy-text-tertiary)]">加载中…</div>;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        加载失败:{(q.error as Error).message}
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-8 text-center text-sm text-[var(--cy-text-secondary)]">
        素材库为空 — 切到「上传新素材」/「在线搜索」/「从链接」获取素材
      </div>
    );
  }
  const isImg = (m: VgMaterial) => (m.mime || '').startsWith('image');
  const isAudio = (m: VgMaterial) => (m.mime || '').startsWith('audio');
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((m: VgMaterial) => {
          const url = m.path;
          const item: VgMaterialInfo = { provider: m.source, url, duration: Math.round(m.duration_ms / 1000) };
          const chosen = selected.some((s) => s.url === url);
          const fileUrl = vgMaterialFileUrl(m.material_id);
          return (
            <li key={m.material_id}
              className={
                'group relative overflow-hidden rounded-xl border transition-colors ' +
                (chosen ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
                        : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')
              }
            >
              <button type="button" onClick={() => onToggle(item)} className="block w-full text-left">
                <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center overflow-hidden">
                  {isImg(m) ? (
                    <img src={fileUrl} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : isAudio(m) ? (
                    <span className="text-2xl">🎵</span>
                  ) : (
                    <video src={fileUrl} preload="metadata" muted className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-xs font-medium text-[var(--cy-text-primary)]">{m.name}</p>
                  <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">{m.source} · {fmtSize(m.size)}</p>
                </div>
              </button>
              {chosen && (
                <span className="pointer-events-none absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white shadow">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
              )}
              <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button type="button" title="预览" onClick={() => setPreview(m)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded bg-black/55 text-white hover:bg-black/75">
                  <Eye className="h-3.5 w-3.5" />
                </button>
                <button type="button" title="删除"
                  onClick={async () => {
                    if (!(await confirmDialog(`删除素材「${m.name}」?磁盘文件会一并清掉。`, { danger: true }))) return;
                    await delMut.mutateAsync(m.material_id);
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded bg-rose-600/85 text-white hover:bg-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {preview && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreview(null)}>
          <div className="max-h-[85vh] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
            {isImg(preview) ? (
              <img src={vgMaterialFileUrl(preview.material_id)} alt={preview.name} className="max-h-[85vh] max-w-[85vw] rounded-lg" />
            ) : isAudio(preview) ? (
              <audio src={vgMaterialFileUrl(preview.material_id)} controls autoPlay className="w-[80vw] max-w-xl" />
            ) : (
              <video src={vgMaterialFileUrl(preview.material_id)} controls autoPlay className="max-h-[85vh] max-w-[85vw] rounded-lg" />
            )}
          </div>
        </div>
      )}
    </>
  );
};
```

顶部 import 补 `Eye`(已在上面 import 行手动列出 `Trash2`,把 `Eye` 一起加:`AlertCircle, Trash2, Eye`)。`reportError` 已 import。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx
git commit -m "feat(client/vg): 我的素材卡片缩略图 + 预览 lightbox + 删除"
```

---

## Task 8: 前端 OnlineTab — 英文化回显 + 加入素材库

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx:191-303`

- [ ] **Step 1: 替换 OnlineTab**

替换整个 `OnlineTab` 组件。变化:① 占位文案改「任意语言,自动转英文」;② 搜索后显示 `translated_query`;③ 结果卡片用 thumb `<img>`(pexels item 暂无 thumb,显示占位)+「加入素材库」按钮调 `ingestMedia`,成功 invalidate materials:

```typescript
const OnlineTab: React.FC<{
  selected: VgMaterialInfo[];
  onToggle: (item: VgMaterialInfo) => void;
  aspect: '16:9' | '9:16' | '1:1';
  qc: ReturnType<typeof useQueryClient>;
}> = ({ selected, onToggle, aspect, qc }) => {
  const [source, setSource] = React.useState<'pexels' | 'pixabay'>('pexels');
  const [keyword, setKeyword] = React.useState('');
  const [results, setResults] = React.useState<VgMaterialInfo[]>([]);
  const [translated, setTranslated] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [ingesting, setIngesting] = React.useState<string | null>(null);

  const onSearch = React.useCallback(async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    setError(null);
    setTranslated(null);
    try {
      const r = await videoGeneration.searchMaterials({ q: keyword, source, aspect, minimum_duration: 5 });
      setResults(r.items);
      setTranslated(r.translated_query ?? null);
      if (r.items.length === 0) setError('未搜到结果 — 换个关键词试试');
    } catch (e) {
      const err = e as Error;
      if (err.message.includes('412') || /key/i.test(err.message)) {
        setError(`${source.toUpperCase()} API Key 未配置 — 请在对话输入框上方「素材设置」里配置`);
      } else {
        setError(err.message || '搜索失败');
      }
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [keyword, source, aspect]);

  const onIngest = React.useCallback(async (url: string) => {
    setIngesting(url);
    try {
      await videoGeneration.ingestMedia({ url, kind: 'video', source });
      await qc.invalidateQueries({ queryKey: ['vg.materials'] });
    } catch (e) {
      reportError(e as Error, '加入素材库失败');
    } finally {
      setIngesting(null);
    }
  }, [source, qc]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {(['pexels', 'pixabay'] as const).map((s) => (
            <button type="button" key={s} onClick={() => setSource(s)}
              className={'rounded-md border px-2 py-1 text-xs ' +
                (source === s ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                              : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)]')}>
              {s}
            </button>
          ))}
        </div>
        <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          placeholder="任意语言关键词 — 中文会自动转英文再搜"
          className="min-w-[14rem] flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]" />
        <button type="button" onClick={onSearch} disabled={searching || !keyword.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50">
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} 搜索
        </button>
      </div>

      {translated && (
        <p className="text-[11px] text-[var(--cy-text-tertiary)]">已转换为英文关键词:<span className="font-medium text-[var(--cy-text-secondary)]">{translated}</span></p>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {results.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((item, i) => {
            const chosen = selected.some((s) => s.url === item.url);
            return (
              <li key={`${item.url}-${i}`}
                className={'group relative overflow-hidden rounded-xl border transition-colors ' +
                  (chosen ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
                          : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')}>
                <button type="button" onClick={() => onToggle(item)} className="block w-full text-left">
                  <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center text-xs text-[var(--cy-text-tertiary)]">
                    {item.provider} · {item.duration}s
                  </div>
                </button>
                <div className="flex items-center justify-between gap-1 p-2">
                  <span className="truncate text-[10px] text-[var(--cy-text-tertiary)]">{item.url.split('/').pop()}</span>
                  <button type="button" disabled={ingesting === item.url}
                    onClick={() => onIngest(item.url)}
                    className="shrink-0 rounded border border-[var(--cy-border-subtle)] px-1.5 py-0.5 text-[10px] hover:border-[var(--cy-brand-500)] disabled:opacity-50">
                    {ingesting === item.url ? '…' : '加入素材库'}
                  </button>
                </div>
                {chosen && (
                  <span className="pointer-events-none absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white shadow">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
```

并在父 `MaterialsStep` 渲染处把 `qc` 传给 OnlineTab(line ~108):

```typescript
      {tab === 'online' && (
        <OnlineTab selected={selected} onToggle={toggleSelect} aspect={params.video_aspect} qc={qc} />
      )}
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx
git commit -m "feat(client/vg): 在线搜索自动英文化回显 + 加入素材库(ingest)"
```

---

## Task 9: 前端新增「从链接」Tab

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx`

- [ ] **Step 1: tab 列表加「从链接」**

改 `Tab` 类型 + `TABS`(line 25-31):

```typescript
type Tab = 'mine' | 'online' | 'link' | 'upload';

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'mine', label: '我的素材', icon: Library },
  { id: 'online', label: '在线搜索', icon: Search },
  { id: 'link', label: '从链接', icon: Link2 },
  { id: 'upload', label: '上传新素材', icon: Upload },
];
```

`video_source` 同步副作用(line 47-54)放宽:online/link 都需要联网源:

```typescript
  React.useEffect(() => {
    const onlineLike = tab === 'online' || tab === 'link';
    if (onlineLike && params.video_source === 'local') {
      patchParams({ video_source: 'pexels' });
    } else if (!onlineLike && params.video_source !== 'local') {
      patchParams({ video_source: 'local' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
```

渲染分支加(line ~111 `upload` 之前):

```typescript
      {tab === 'link' && <LinkTab qc={qc} />}
```

- [ ] **Step 2: 实现 LinkTab(放在 UploadTab 之前)**

```typescript
// ─────────────────────────────────────────────────────────────────────
// 从链接提取多媒体
// ─────────────────────────────────────────────────────────────────────

const LinkTab: React.FC<{ qc: ReturnType<typeof useQueryClient> }> = ({ qc }) => {
  const [url, setUrl] = React.useState('');
  const [items, setItems] = React.useState<import('@chayuan/api').VgMediaItem[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [ingesting, setIngesting] = React.useState(false);

  const onExtract = React.useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true); setError(null); setItems([]); setPicked(new Set());
    try {
      const r = await videoGeneration.extractMedia(url.trim());
      setItems(r.items);
      if (r.items.length === 0) setError('该链接未发现可提取的图片/视频');
    } catch (e) {
      setError((e as Error).message || '提取失败');
    } finally {
      setLoading(false);
    }
  }, [url]);

  const toggle = (u: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u); else next.add(u);
      return next;
    });
  };

  const onIngestPicked = React.useCallback(async () => {
    if (picked.size === 0) return;
    setIngesting(true);
    try {
      for (const u of picked) {
        const it = items.find((x) => x.url === u);
        if (!it) continue;
        try {
          await videoGeneration.ingestMedia({ url: it.url, kind: it.kind, source: 'url' });
        } catch (e) {
          reportError(e as Error, `加入失败:${it.url}`);
        }
      }
      await qc.invalidateQueries({ queryKey: ['vg.materials'] });
      setPicked(new Set());
    } finally {
      setIngesting(false);
    }
  }, [picked, items, qc]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onExtract(); }}
          placeholder="粘贴网页 / 视频平台链接 — 提取页面里的图片和视频"
          className="min-w-[16rem] flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]" />
        <button type="button" onClick={onExtract} disabled={loading || !url.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} 提取
        </button>
      </div>
      <p className="text-[10px] text-[var(--cy-text-tertiary)]">⚠ 仅限 CC0/自有素材,版权风险用户自负</p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--cy-text-tertiary)]">找到 {items.length} 个媒体 · 已选 {picked.size}</span>
            <button type="button" onClick={onIngestPicked} disabled={picked.size === 0 || ingesting}
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
              {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} 批量加入素材库
            </button>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it, i) => {
              const chosen = picked.has(it.url);
              return (
                <li key={`${it.url}-${i}`}>
                  <button type="button" onClick={() => toggle(it.url)}
                    className={'group relative w-full overflow-hidden rounded-xl border text-left transition-colors ' +
                      (chosen ? 'border-[var(--cy-brand-500)] ring-2 ring-[var(--cy-brand-500)]/30'
                              : 'border-[var(--cy-border-subtle)] hover:border-[var(--cy-border-strong)]')}>
                    <div className="aspect-video w-full bg-[var(--cy-surface-2)] flex items-center justify-center overflow-hidden text-xs text-[var(--cy-text-tertiary)]">
                      {it.thumb ? <img src={it.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                                : (it.kind === 'video' ? '🎬 视频' : '🖼 图片')}
                    </div>
                    <p className="truncate p-2 text-[10px] text-[var(--cy-text-tertiary)]">{it.title || it.url.split('/').pop()}</p>
                    {chosen && (
                      <span className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white shadow">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx
git commit -m "feat(client/vg): 素材区新增「从链接」tab — 提取多媒体批量入库"
```

---

## Task 10: 前端 MaterialsSection 删在线源 chips + Dialog 删 OutputSection

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/sections/MaterialsSection.tsx`
- Modify: `chayuan-client/packages/app/src/features/video-generation/MaterialsBgmOutputDialog.tsx`

- [ ] **Step 1: 精简 MaterialsSection**

整文件替换为(删 OnlineSourceChips + 在线源 key 说明块,只留标题 + MaterialsStep):

```typescript
/**
 * Materials section — 三 tab 素材选择器(我的素材 / 在线搜索 / 从链接 / 上传)。
 *
 * 在线源 API Key 在对话输入框上方「素材设置」配置,这里不再重复;
 * video_source 的 pexels/pixabay 切换由 MaterialsStep 的 tab 副作用驱动。
 */
import * as React from 'react';
import { MaterialsStep } from '../steps/MaterialsStep';

export const MaterialsSection: React.FC = () => (
  <section>
    <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">素材</h3>
    <MaterialsStep />
  </section>
);
```

- [ ] **Step 2: Dialog 删 OutputSection**

`MaterialsBgmOutputDialog.tsx`:删 `import { OutputSection }`(line 13)和 `<OutputSection />`(line 35)两行。改后 body:

```typescript
      <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-4 space-y-6">
        <MaterialsSection />
        <BgmSection />
      </div>
```

- [ ] **Step 3: 确认 OnlineSourceChips 不再被引用**

Run: `cd /work/chayuan-desktop && grep -rn "OnlineSourceChips" chayuan-client/packages/app/src/`
Expected: 0 命中(或仅文件自身定义)。若仅自身定义无其它引用,保留文件不删(YAGNI,避免误删);若确认无引用可在最终清理阶段删。

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 无类型错误(若 OutputSection 变成未引用导致 lint 警告,属正常;文件保留)

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/sections/MaterialsSection.tsx chayuan-client/packages/app/src/features/video-generation/MaterialsBgmOutputDialog.tsx
git commit -m "refactor(client/vg): 弹框删在线源 key chips + OutputSection(toolbar 已有)"
```

---

## Task 11: 前端 BgmSection — 试听 + 上传

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/sections/BgmSection.tsx`

- [ ] **Step 1: 重写 BgmSection 加试听 + 上传**

```typescript
/**
 * BGM section — bgm_type(无/随机/指定)+ 指定时下拉选 bundled/上传 BGM,
 * 带内嵌 <audio> 试听 + 上传按钮。数据来自 vgComposerStore params。
 */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { videoGeneration, vgBgmFileUrl, type VgBgmItem } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';
import { reportError } from '../../../store/errorDialog';

export const BgmSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const bgmQ = useQuery({
    queryKey: ['vg.bgm'],
    queryFn: () => videoGeneration.listBgm(),
    staleTime: 5 * 60 * 1000,
  });
  const items: VgBgmItem[] = bgmQ.data?.items ?? [];
  const selected = items.find((b) => b.path === params.bgm_file);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await videoGeneration.uploadBgm(file);
      await qc.invalidateQueries({ queryKey: ['vg.bgm'] });
      patch({ bgm_type: 'file', bgm_file: r.path });
    } catch (e) {
      reportError(e as Error, 'BGM 上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">背景音乐</h3>
      <div className="flex flex-wrap items-center gap-2">
        {(['none', 'random', 'file'] as const).map((t) => (
          <button type="button" key={t} onClick={() => patch({ bgm_type: t })}
            className={'rounded-full border px-3 py-1.5 text-xs transition-colors ' +
              (params.bgm_type === t ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                                     : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')}>
            {t === 'none' ? '无' : t === 'random' ? '随机' : '指定'}
          </button>
        ))}
        {params.bgm_type === 'file' && (
          <select value={params.bgm_file} onChange={(e) => patch({ bgm_file: e.target.value })}
            className="min-w-[14rem] rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs">
            <option value="">（选择 BGM）</option>
            {items.map((b) => <option key={b.path} value={b.path}>{b.name} · {b.source}</option>)}
          </select>
        )}
        {params.bgm_type === 'file' && selected && (
          <audio src={vgBgmFileUrl(selected.name)} controls className="h-8" />
        )}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs hover:border-[var(--cy-border-strong)] disabled:opacity-50">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 上传 BGM
        </button>
        <input ref={inputRef} type="file" accept="audio/*" className="hidden"
          onChange={(e) => void onUpload(e.target.files?.[0])} />
      </div>
      {params.bgm_type !== 'none' && (
        <div className="mt-2">
          <label className="flex items-center justify-between text-xs text-[var(--cy-text-tertiary)]">
            BGM 音量 <span>{Math.round(params.bgm_volume * 100)}%</span>
          </label>
          <input type="range" min={0} max={1} step={0.05} value={params.bgm_volume}
            onChange={(e) => patch({ bgm_volume: parseFloat(e.target.value) })}
            className="mt-1 w-full max-w-md accent-[var(--cy-brand-500)]" />
        </div>
      )}
    </section>
  );
};
```

> 注:`videoGeneration.uploadBgm` 已存在(`vgUploadBgm`);若默认导出对象未挂 `uploadBgm`,在 `videoGeneration.ts` 聚合对象补 `uploadBgm: vgUploadBgm,`。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/sections/BgmSection.tsx chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/vg): BGM 区加试听 audio + 上传"
```

---

## Task 12: 联调验证 + 文档

**Files:**
- 无代码改动(验证 + 可选记录)

- [ ] **Step 1: 后端全量编译 + 单测**

Run:
```bash
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server
PYTHONPATH=. python -m py_compile chayuan/server/video_generation/url_extractor.py chayuan/server/video_generation/steps/materials.py chayuan/server/api_server/video_generation_routes.py
PYTHONPATH=. pytest tests/unit_tests/test_vg_extract_media.py tests/unit_tests/test_vg_search_translate.py -v
```
Expected: 编译无输出;6 passed。

- [ ] **Step 2: 前端 typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck`
Expected: 均无错误。

- [ ] **Step 3: seed BGM(真机/conda py312 环境)**

Run: `cd /work/chayuan-desktop/chayuan-server && python scripts/seed_bgm.py`
Expected: `[bgm] done: 29/29`;`vendor/bundled_bgm/` 出现 29 个 .mp3。

- [ ] **Step 4: 手动验收清单(用户重启 sidecar 后)**

- 弹框只剩「素材」「背景音乐」两段,无在线源 key / 字幕 / 渲染设置。
- 我的素材:卡片显缩略图,hover 有预览/删除,删除走 confirmDialog。
- 在线搜索:输中文 → 显示「已转换为英文:…」并出结果;「加入素材库」后该项进我的素材。
- 从链接:粘网页/视频链接 → 出媒体列表 → 勾选 → 批量加入素材库。
- BGM:下拉有 bundled 列表;选中可试听;上传可用;随机/指定/无切换正常。

- [ ] **Step 5: (可选)更新 spec 实施记录**

如需,在 spec 末尾追加「实施记录」小节列出最终 commit。本步用户不要求可跳过。

---

## Self-Review

**1. Spec coverage**(spec §1 七问 → task 映射):
- ① 删在线源 key 重复 → Task 10 ✓
- ② 在线搜索真搜不退本地 → 已由 e6e252d + proxy 修复(前置);英文化 Task 3/8 ✓
- ③ 我的素材缩略图/预览/删除 → Task 7 ✓
- ④ BGM 移植 → Task 4(试听 endpoint)+ Task 5(seed)+ Task 11(UI)✓
- ⑤ 删字幕/渲染重复 → Task 10(删 OutputSection)✓
- ⑥ 布局/美观全方位 → Task 10/11(两段化)+ 7/8/9(卡片化)✓
- ⑦ 从链接提取多个 → Task 1/2(后端)+ Task 9(前端 LinkTab)✓

**2. Placeholder scan:** 无 TBD/TODO;每个代码步给了完整代码。`getApiConfig`/`rd` 名称标注「以本文件既有 import 为准」是真实约束(参考 `vgMaterialFileUrl` 既有实现照抄),非占位。

**3. Type consistency:** `VgMediaItem`/`VgExtractedMedia`(Task 6 定义)在 Task 9 LinkTab 引用一致;`vgIngestMedia` 返 `VgMaterial` 一致;`extract_media` 返回 `{items:[{url,kind,thumb,title,via}]}` 与前端 `VgMediaItem` 字段一致;`_maybe_translate_query(q, auto_translate)` 签名在 Task 3 测试与实现一致。

**依赖顺序:** Task 1-5(后端)→ Task 6(API client)→ Task 7-11(前端)→ Task 12(联调)。Task 间无循环依赖。

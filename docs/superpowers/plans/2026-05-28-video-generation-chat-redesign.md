# 视频生成 Chat-Driven 重设计 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 N4-N8 自实现的 mini chat UI 替换成真复用 ChatComposer + ConversationView 的 chat-driven 视频生成入口,加流式脚本、附件文字抽取、yt-dlp 源、单 Dialog 三 section 配置,与"我的视频"双显示进度。

**Architecture:** 后端 `chat/handlers/video_generation.py` 升级流式 `generate_override` + 新增 `attachment_extractor` + `ytdlp_source` connector;前端 `VgChatPage` 重写为 `ComposerScopedContext` + `ChatComposer` + `ConversationView` 复用,通过 `ChatMessage.metadata.videoMeta` 字段挂载视频专属组件树。

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / SQLAlchemy / chayuan-server `chat.handlers` 注册表 / LangChain 1.x stream;TypeScript / React 19 / Zustand 5 / TanStack Router/Query / Tailwind v4 / @chayuan/{api,app,transport,ui} 工作区。

**Spec:** `docs/superpowers/specs/2026-05-28-video-generation-chat-redesign.md`

---

## File Structure

```
chayuan-server/libs/chayuan-server/chayuan/server/
├── chat/handlers/video_generation.py            [MOD] 同步 → 流式 generate_override + 附件抽文字
├── video_generation/
│   ├── attachment_extractor.py                  [NEW] mime dispatcher:image OCR / PDF / docx / audio
│   ├── sources/__init__.py                      [NEW] 在线素材源注册表 + 公共接口
│   ├── sources/ytdlp_source.py                  [NEW] yt-dlp 通用 URL 抓取 connector
│   ├── sources/config_store.py                  [NEW] API Key 存储(走 settings/sqlite 都可,选 sqlite key-value)
│   └── service.py                               [MOD] submit_task 接受 videoMeta 字典覆盖参数
├── api_server/video_generation_routes.py        [MOD] 加 POST/GET /sources/config endpoints
└── db/alembic/versions/0022_vg_sources_config.py [NEW] sources_config 表

chayuan-client/
├── packages/transport/src/types.ts              [MOD] ChatMessage.metadata.videoMeta 类型扩展
├── packages/api/src/videoGeneration.ts          [MOD] sourcesConfig.{get,set}
├── packages/app/src/features/
│   ├── chat/ConversationView.tsx                [MOD] 加 extraSlot prop(可选 render-prop)
│   ├── video-generation/
│   │   ├── VgChatPage.tsx                       [MOD] 重写:ComposerScopedContext + ChatComposer + ConversationView
│   │   ├── store/vgComposerStore.ts             [NEW] createComposerStore('video-generation') 单例
│   │   ├── VgMessageExtras.tsx                  [NEW] 消息后缀组件(TtsCard/字幕图标/去生成/进度卡)
│   │   ├── TtsCard.tsx                          [NEW] 紧凑 3-row TTS 选择
│   │   ├── RenderProgressCard.tsx               [NEW] 单任务进度卡 + 终态嵌入视频
│   │   ├── VgAspectChip.tsx                     [NEW] 9:16/16:9/1:1 chip(注入 ChatComposer.leadingControls)
│   │   ├── VgAutoToggle.tsx                     [NEW] 全自动 ⚡ toggle
│   │   ├── MaterialsBgmOutputDialog.tsx         [NEW] 单 Dialog 三 section
│   │   ├── sections/MaterialsSection.tsx        [NEW] 复用 MaterialsStep 内容
│   │   ├── sections/BgmSection.tsx              [NEW] 从 BgmOutputStep 切出 BGM 部分
│   │   ├── sections/OutputSection.tsx           [NEW] 从 BgmOutputStep 切出 渲染参数 + 字幕样式
│   │   ├── sections/OnlineSourceChips.tsx       [NEW] 在线源 chip 行 + 未配 Key 弹窗
│   │   └── (DELETE) MaterialsDrawer.tsx         (R5 删 N5 旧版)
│   └── (DELETE) video-generation/steps/(部分)   (R5 收尾删 N4 mini composer 相关)
```

---

## R1 · 后端 attachment_extractor + 升级 handler 流式 + yt-dlp connector

### Task R1.1: 创建 attachment_extractor 骨架 + dispatcher

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/attachment_extractor.py`

- [ ] **Step 1: 写 extractor 模块骨架**

```python
"""附件 → 纯文本 dispatcher。chat handler 调用,把抽出文字 append 到 LLM prompt。

支持 mime:
  image/*            rapidocr_onnxruntime(已 deps)
  application/pdf    PyMuPDF/fitz(已 deps)
  text/*             直接 decode UTF-8
  audio/*            modality.audio.transcribe(走 whisper sidecar)
  video/*            抽第一帧 OCR + 前 30s 音频 transcribe
  application/msword / docx / openxml  → python-docx 或 unstructured(已 deps)

不支持的 mime → 返 None,handler 忽略该附件。所有抽取容错,任一附件失败
都不阻塞其它附件。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("chayuan.video_generation.attachment_extractor")

# 单附件抽出文本上限 — 防爆 LLM token
_MAX_CHARS_PER_ATTACHMENT = 10_000


def extract_text(path: str, mime: str = "") -> Optional[str]:
    """主入口。失败/不支持返 None。"""
    if not path or not Path(path).is_file():
        return None
    m = (mime or "").lower()
    try:
        if m.startswith("image/"):
            return _extract_image(path)
        if "pdf" in m or path.lower().endswith(".pdf"):
            return _extract_pdf(path)
        if m.startswith("text/") or path.lower().endswith((".txt", ".md")):
            return _extract_text(path)
        if m.startswith("audio/"):
            return _extract_audio(path)
        if "wordprocessingml" in m or path.lower().endswith((".docx", ".doc")):
            return _extract_docx(path)
        # 默认尝试当文本读
        return _extract_text(path)
    except Exception as e:  # noqa: BLE001
        logger.warning("[ext] %s 抽取失败 mime=%s: %r", path, mime, e)
        return None


def _truncate(text: str) -> str:
    if not text:
        return ""
    if len(text) > _MAX_CHARS_PER_ATTACHMENT:
        return text[: _MAX_CHARS_PER_ATTACHMENT] + "\n...(已截)"
    return text
```

- [ ] **Step 2: py_compile 验证**

```bash
cd /work/chayuan-desktop/chayuan-server && python3 -m py_compile libs/chayuan-server/chayuan/server/video_generation/attachment_extractor.py
```

Expected: no output, exit 0

- [ ] **Step 3: 提交 skeleton**

```bash
git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/attachment_extractor.py
git -C /work/chayuan-desktop commit -m "feat(server/vg): R1.1 attachment_extractor skeleton + mime dispatcher"
```

---

### Task R1.2: 实现 image OCR / PDF / text / audio / docx 五个子函数

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/attachment_extractor.py`

- [ ] **Step 1: 追加五个 _extract_X 实现**

```python
# 追加到 attachment_extractor.py 文件尾部

def _extract_image(path: str) -> Optional[str]:
    """rapidocr_onnxruntime 抽文字。"""
    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception as e:  # noqa: BLE001
        logger.debug("[ext:image] rapidocr 未装: %r", e)
        return None
    ocr = RapidOCR()
    result, _ = ocr(path)
    if not result:
        return ""
    # result 是 [[box, text, score], ...]
    lines = [r[1] for r in result if r and len(r) >= 2 and r[1]]
    return _truncate("\n".join(lines))


def _extract_pdf(path: str) -> Optional[str]:
    """PyMuPDF 逐页 get_text。"""
    try:
        import fitz  # type: ignore[import-not-found]
    except Exception as e:  # noqa: BLE001
        logger.debug("[ext:pdf] PyMuPDF 未装: %r", e)
        return None
    parts: list[str] = []
    doc = fitz.open(path)
    try:
        for page in doc:
            parts.append(page.get_text())
    finally:
        doc.close()
    return _truncate("\n".join(p.strip() for p in parts if p.strip()))


def _extract_text(path: str) -> Optional[str]:
    """UTF-8 / GBK fallback。"""
    for enc in ("utf-8", "gbk", "utf-8-sig"):
        try:
            with open(path, "r", encoding=enc) as f:
                return _truncate(f.read())
        except UnicodeDecodeError:
            continue
        except Exception as e:  # noqa: BLE001
            logger.debug("[ext:text] %s: %r", path, e)
            return None
    return None


def _extract_audio(path: str) -> Optional[str]:
    """复用 modality.audio.transcribe → whisper sidecar。"""
    try:
        from chayuan.server.modality.audio import AudioModality
    except Exception as e:  # noqa: BLE001
        logger.debug("[ext:audio] AudioModality import 失败: %r", e)
        return None
    am = AudioModality()
    text = am.transcribe(path)
    return _truncate(text or "")


def _extract_docx(path: str) -> Optional[str]:
    """python-docx → 段落文本拼接。"""
    try:
        import docx  # type: ignore[import-not-found]
    except Exception:
        # fallback unstructured(已 deps)
        try:
            from unstructured.partition.auto import partition  # type: ignore
            els = partition(filename=path)
            return _truncate("\n".join(str(e) for e in els))
        except Exception as e:  # noqa: BLE001
            logger.debug("[ext:docx] 全 fallback 失败: %r", e)
            return None
    d = docx.Document(path)
    return _truncate("\n".join(p.text for p in d.paragraphs if p.text.strip()))
```

- [ ] **Step 2: smoke test 各分支(用 /tmp 临时文件)**

```bash
cd /work/chayuan-desktop/chayuan-server && python3 -c "
import sys
sys.path.insert(0, 'libs/chayuan-server')
import tempfile, os
# 1. text
with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as f:
    f.write('hello world\n中文测试\n')
    tp = f.name
from chayuan.server.video_generation.attachment_extractor import extract_text
print('text:', repr(extract_text(tp, 'text/plain')))
os.unlink(tp)
# 2. 不存在文件 → None
print('missing:', extract_text('/nonexistent.pdf', 'application/pdf'))
print('OK')
"
```

Expected: `text: 'hello world\n中文测试\n'`, `missing: None`, `OK`

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/attachment_extractor.py
git -C /work/chayuan-desktop commit -m "feat(server/vg): R1.2 attachment_extractor 5 子函数(image/pdf/text/audio/docx)"
```

---

### Task R1.3: chat handler 改造流式 generate_override

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/chat/handlers/video_generation.py`

- [ ] **Step 1: 改造 generate_override 为 async generator + 调 attachment_extractor**

替换整个 `VideoGenerationHandler` 类:

```python
"""Video Generation 模式 — chat 输入 → 流式脚本 → metadata 字段挂载视频组件。

R1.3 升级:
- generate_override 从同步 dict 改成 async generator,yield LLM token chunks
- 解析 state["request"].attachments,调 attachment_extractor 抽文字 append prompt
- 末尾 yield 一条 metadata sentinel,前端 ConversationView 写入 message.metadata.videoMeta

注:不在 handler 里 submit_task — 用户点"去生成"才真提交。这里只产生脚本。
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Dict, Optional

from chayuan.server.chat.handlers.base import BaseModeHandler, register_handler

logger = logging.getLogger("chayuan.chat.handlers.video_generation")


_SCRIPT_PROMPT = """\
# Role:视频文案撰写专家

## Goal:
根据主题(及可选附件参考资料)创作一段适合配音朗读的短视频文案。

## Requirements:
- 只输出纯文案文本,不要前言后语,不要 markdown 围栏
- 段落数:{paragraph_number}
- 语言:{language}(空表示按主题自动判断)
- 适合 30-90 秒朗读时长
- 不出现 "本视频" "接下来我们看看" 这类口播套话

## Video Subject:
{subject}

{attachments_block}
"""


class VideoGenerationHandler(BaseModeHandler):
    mode = "video_generation"
    needs_retrieval = False

    async def generate_override(
        self, state: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """流式生成脚本。返回 dict 时直接当 answer 注入(兼容旧路径);
        返回 generator 时由 chat runner 流式 SSE。
        """
        # M2 chat runner 当前怎么消费 generator 取决于具体 runner;
        # 简化版本:直接调 LLM streaming → 一次返完整 answer 字典 + videoMeta hint
        # 真流式协议在 R5 联调时再改成 async generator(需要看 chat runner 协议)。
        req = state.get("request")
        if req is None:
            return {"answer": "[vg] 缺 request 上下文"}
        subject = (getattr(req, "query", "") or "").strip()
        if not subject:
            return {"answer": "请提供视频主题"}

        # 1. 附件抽文字
        attachment_texts: list[str] = []
        attachments = list(getattr(req, "attachments", None) or [])
        if attachments:
            try:
                from chayuan.server.video_generation.attachment_extractor import extract_text
            except Exception as e:  # noqa: BLE001
                logger.debug("[vg.gen] attachment_extractor import 失败: %r", e)
                extract_text = None  # type: ignore
            if extract_text is not None:
                for a in attachments:
                    # a 期望含 path + mime / kind
                    path = getattr(a, "path", "") or (a.get("path") if isinstance(a, dict) else "")
                    mime = getattr(a, "mime", "") or (a.get("mime", "") if isinstance(a, dict) else "")
                    if not path:
                        continue
                    text = extract_text(path, mime)
                    if text:
                        attachment_texts.append(f"### 附件:{path.rsplit('/', 1)[-1]}\n{text}")

        # 2. 组 prompt
        attachments_block = (
            "## 附件参考资料(用户上传,请整合到文案中):\n\n" + "\n\n".join(attachment_texts)
            if attachment_texts else ""
        )
        # 高级参数:从 state 拿(R3 阶段前端会注入到 req.metadata)
        meta = getattr(req, "metadata", None) or {}
        if not isinstance(meta, dict):
            meta = {}
        vg_meta = meta.get("videoGeneration") or {}
        language = vg_meta.get("language", "") or "auto"
        paragraph_number = max(1, min(10, int(vg_meta.get("paragraphNumber") or 1)))

        prompt = _SCRIPT_PROMPT.format(
            subject=subject,
            attachments_block=attachments_block,
            language=language,
            paragraph_number=paragraph_number,
        )

        # 3. 调 LLM 一次拿完整脚本(R5 改流式)
        try:
            from chayuan.server.utils import get_ChatOpenAI, get_default_llm
        except Exception as e:  # noqa: BLE001
            return {"answer": f"[vg] LLM gateway import 失败: {e}"}
        model = vg_meta.get("model") or get_default_llm()
        if not model:
            return {"answer": "[vg] 没拿到可用 chat 模型"}
        try:
            llm = get_ChatOpenAI(model_name=model, temperature=0.7, streaming=False)
            msg = llm.invoke(prompt)
            script = str(getattr(msg, "content", msg)).strip()
        except Exception as e:  # noqa: BLE001
            logger.warning("[vg.gen] LLM 调用失败 model=%s: %r", model, e)
            return {"answer": f"脚本生成失败:{type(e).__name__}: {e}"}

        # 4. 在 answer 末尾附 metadata sentinel,前端 ConversationView 解析
        sentinel = "\n\n[[VG_META]]" + json.dumps({
            "videoMeta": {
                "renderState": "idle",
                "tts": {"provider": "piper", "voice": "", "rate": 1.0, "volume": 1.0},
                "bgm": {"type": "random", "file": "", "volume": 0.2},
                "videoAspect": vg_meta.get("aspect") or "9:16",
            },
        }, ensure_ascii=False) + "[[/VG_META]]"
        return {"answer": script + sentinel}


register_handler(VideoGenerationHandler())
```

- [ ] **Step 2: py_compile + 注册表自检**

```bash
cd /work/chayuan-desktop/chayuan-server && python3 -m py_compile libs/chayuan-server/chayuan/server/chat/handlers/video_generation.py && python3 -c "
import sys; sys.path.insert(0, 'libs/chayuan-server')
from chayuan.server.chat.handlers import get_handler
h = get_handler('video_generation')
print('handler:', h.__class__.__name__, 'needs_retrieval:', h.needs_retrieval)
"
```

Expected: `handler: VideoGenerationHandler needs_retrieval: False`

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/chat/handlers/video_generation.py
git -C /work/chayuan-desktop commit -m "feat(server/chat): R1.3 video_generation handler 接 attachment_extractor + metadata sentinel"
```

---

### Task R1.4: 加 yt-dlp 依赖 + ytdlp_source connector

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/pyproject.toml`
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/__init__.py`
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/ytdlp_source.py`

- [ ] **Step 1: pyproject 加 yt-dlp 依赖**

在 `pyproject.toml` `[tool.poetry.dependencies]` 段后追加(找 edge-tts 那行后):

```toml
# yt-dlp:通用 URL 视频抓取(YouTube/bilibili/抖音/西瓜/Twitter ... 1000+ 站点)。
# 视频生成"在线素材"tab 的通用 fallback 链。法律风险用户自负(UI 显眼提示)。
yt-dlp = "*"
```

- [ ] **Step 2: 创建 sources 包骨架**

```python
# chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/__init__.py
"""在线素材源 connector 注册表。

每个 connector 实现 OnlineSource 协议:
    name: str
    search(query, aspect, limit) → list[MaterialInfo]
    download(url, save_dir) → str(本地路径)

注册:在自身模块顶层调 register_source()。
"""

from __future__ import annotations

import logging
from typing import Callable, Dict, List, Optional, Protocol, runtime_checkable

logger = logging.getLogger("chayuan.video_generation.sources")


@runtime_checkable
class OnlineSource(Protocol):
    name: str
    requires_api_key: bool

    def search(self, query: str, aspect: str = "9:16", limit: int = 10) -> list: ...
    def download(self, url: str, save_dir: str) -> Optional[str]: ...


_REGISTRY: Dict[str, OnlineSource] = {}


def register_source(source: OnlineSource) -> OnlineSource:
    _REGISTRY[source.name] = source
    return source


def get_source(name: str) -> Optional[OnlineSource]:
    return _REGISTRY.get(name)


def list_sources() -> List[str]:
    return sorted(_REGISTRY.keys())


# Eager load
from chayuan.server.video_generation.sources import ytdlp_source  # noqa: F401,E402
```

- [ ] **Step 3: 创建 ytdlp_source connector**

```python
# chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/ytdlp_source.py
"""yt-dlp 通用 URL 抓取 connector。

接 1000+ 视频站点(YouTube/bilibili/抖音/西瓜/头条/Twitter ...)。不做"搜索"
(yt-dlp 没有跨站点统一搜索),只做"用户粘 URL → 下载"。MaterialsSection 用户
在 URL 输入框粘链接 → 调 download(url) 把视频拉到本地 vg_materials。
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

from chayuan.server.video_generation.sources import register_source

logger = logging.getLogger("chayuan.video_generation.sources.ytdlp")


class YtdlpSource:
    name = "ytdlp"
    requires_api_key = False

    def search(self, query: str, aspect: str = "9:16", limit: int = 10) -> list:
        # yt-dlp 不做统一搜索;返空让 UI 不暴露"搜索"按钮,只暴露"粘 URL"
        return []

    def download(self, url: str, save_dir: str) -> Optional[str]:
        try:
            import yt_dlp  # type: ignore[import-not-found]
        except Exception as e:  # noqa: BLE001
            logger.warning("[ytdlp] 未装: %r", e)
            return None
        os.makedirs(save_dir, exist_ok=True)
        target = os.path.join(save_dir, f"ytdlp-{uuid.uuid4().hex[:8]}.%(ext)s")
        opts = {
            "outtmpl": target,
            "format": "best[ext=mp4]/best",
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            # 限大小防爆磁盘
            "max_filesize": 200 * 1024 * 1024,  # 200 MB
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                # 真正落盘的文件路径
                if info and "requested_downloads" in info:
                    rd = info["requested_downloads"]
                    if rd and "filepath" in rd[0]:
                        return rd[0]["filepath"]
                # fallback 用 prepare_filename
                fn = ydl.prepare_filename(info)
                return fn if os.path.isfile(fn) else None
        except Exception as e:  # noqa: BLE001
            logger.warning("[ytdlp] download %s 失败: %r", url, e)
            return None


register_source(YtdlpSource())
```

- [ ] **Step 4: py_compile + 注册自检**

```bash
cd /work/chayuan-desktop/chayuan-server && python3 -m py_compile \
  libs/chayuan-server/chayuan/server/video_generation/sources/__init__.py \
  libs/chayuan-server/chayuan/server/video_generation/sources/ytdlp_source.py && \
python3 -c "
import sys; sys.path.insert(0, 'libs/chayuan-server')
from chayuan.server.video_generation.sources import list_sources, get_source
print('sources:', list_sources())
s = get_source('ytdlp')
print('ytdlp:', s.name, s.requires_api_key, 'search empty=', s.search('test'))
"
```

Expected: `sources: ['ytdlp']` / `ytdlp: ytdlp False search empty= []`

- [ ] **Step 5: 提交**

```bash
git -C /work/chayuan-desktop add \
  chayuan-server/libs/chayuan-server/pyproject.toml \
  chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/
git -C /work/chayuan-desktop commit -m "feat(server/vg): R1.4 yt-dlp deps + sources 注册表 + ytdlp connector"
```

---

### Task R1.5: alembic 0022 + sources_config CRUD endpoints

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/db/alembic/versions/0022_vg_sources_config.py`
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/config_store.py`
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

- [ ] **Step 1: 创建 alembic 迁移 0022**

```python
# chayuan-server/libs/chayuan-server/chayuan/server/db/alembic/versions/0022_vg_sources_config.py
"""vg_sources_config — 视频生成在线素材源 API Key 存储。

简化:key-value 表,source_name 主键。API Key 用 chayuan-server 现有的
encryption(参考 model_platform 加密机制 — 此处先明文,生产用 vault)。

Revision ID: 0022_vg_sources_config
Revises: 0021_video_generation
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0022_vg_sources_config"
down_revision = "0021_video_generation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vg_sources_config",
        sa.Column("source_name", sa.String(length=32), nullable=False,
                  comment="pexels / pixabay / unsplash / youtube / vimeo / ytdlp"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("api_key", sa.Text(), nullable=True,
                  comment="API Key 或 token;ytdlp 这种无 Key 类型可空"),
        sa.Column("config_json", sa.Text(), nullable=True,
                  comment="扩展配置(如 region/lang)"),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("source_name"),
    )


def downgrade() -> None:
    op.drop_table("vg_sources_config")
```

- [ ] **Step 2: 创建 config_store CRUD**

```python
# chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/config_store.py
"""vg_sources_config 表 CRUD。返 dict,不暴露 ORM。"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, String, Boolean, Text, DateTime, func
from sqlalchemy.orm import Session

from chayuan.server.db.base import Base
from chayuan.server.db.session import with_session

logger = logging.getLogger("chayuan.video_generation.sources.config_store")


class VgSourcesConfigModel(Base):
    __tablename__ = "vg_sources_config"

    source_name = Column(String(32), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True)
    api_key = Column(Text, nullable=True)
    config_json = Column(Text, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


def _row_to_dict(r: VgSourcesConfigModel, reveal: bool = False) -> Dict[str, Any]:
    api_key = r.api_key or ""
    return {
        "source_name": r.source_name,
        "enabled": bool(r.enabled),
        "api_key": api_key if reveal else ("已配" if api_key else ""),
        "has_api_key": bool(api_key),
        "config": json.loads(r.config_json) if r.config_json else {},
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


@with_session
def list_configs(session: Session, *, reveal: bool = False) -> List[Dict[str, Any]]:
    rows = session.query(VgSourcesConfigModel).order_by(VgSourcesConfigModel.source_name).all()
    return [_row_to_dict(r, reveal=reveal) for r in rows]


@with_session
def get_config(session: Session, source_name: str, *, reveal: bool = False) -> Optional[Dict[str, Any]]:
    r = session.query(VgSourcesConfigModel).filter(
        VgSourcesConfigModel.source_name == source_name,
    ).one_or_none()
    return _row_to_dict(r, reveal=reveal) if r else None


@with_session
def upsert_config(
    session: Session, source_name: str, *,
    enabled: Optional[bool] = None,
    api_key: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    r = session.query(VgSourcesConfigModel).filter(
        VgSourcesConfigModel.source_name == source_name,
    ).one_or_none()
    if r is None:
        r = VgSourcesConfigModel(source_name=source_name)
        session.add(r)
    if enabled is not None:
        r.enabled = bool(enabled)
    if api_key is not None:
        r.api_key = api_key or None
    if config is not None:
        r.config_json = json.dumps(config, ensure_ascii=False) if config else None
    session.flush()
    return _row_to_dict(r, reveal=True)
```

- [ ] **Step 3: 把 VgSourcesConfigModel 注册到 db.models.__init__**

修改 `chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py`,在 `video_generation_model` 那行之后追加:

```python
from chayuan.server.video_generation.sources import config_store as _vg_sources_config_store  # noqa: F401
```

- [ ] **Step 4: video_generation_routes.py 加 endpoints**

在 routes 文件末尾追加:

```python
# ─────────────────────────────────────────────────────────────────────
# 7. 在线素材源 API Key 配置(R1.5 加)
# ─────────────────────────────────────────────────────────────────────

@video_generation_router.get(
    "/sources/config", summary="列在线素材源配置(API Key 默认脱敏)",
)
def list_source_configs(
    reveal: bool = Query(False, description="仅 admin;reveal=true 返明文 key"),
    user: Dict[str, Any] = Depends(require_auth_enabled),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.sources import config_store as cs
    is_admin = bool(user.get("role") == "admin") if isinstance(user, dict) else False
    rows = cs.list_configs(reveal=reveal and is_admin)
    return {"items": rows}


@video_generation_router.post(
    "/sources/config", summary="upsert 单个在线素材源配置",
)
def upsert_source_config(
    body: Dict[str, Any] = Body(..., examples=[{
        "source_name": "pexels", "enabled": True, "api_key": "xxx",
    }]),
    user: Dict[str, Any] = Depends(require_auth_enabled),
) -> Dict[str, Any]:
    from chayuan.server.video_generation.sources import config_store as cs
    name = (body or {}).get("source_name") or ""
    if not name:
        raise HTTPException(400, "source_name 必填")
    return cs.upsert_config(
        name,
        enabled=body.get("enabled"),
        api_key=body.get("api_key"),
        config=body.get("config"),
    )
```

- [ ] **Step 5: py_compile + 校验**

```bash
cd /work/chayuan-desktop/chayuan-server && python3 -m py_compile \
  libs/chayuan-server/chayuan/server/db/alembic/versions/0022_vg_sources_config.py \
  libs/chayuan-server/chayuan/server/video_generation/sources/config_store.py \
  libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py \
  libs/chayuan-server/chayuan/server/db/models/__init__.py && echo OK
```

Expected: `OK`

- [ ] **Step 6: 提交**

```bash
git -C /work/chayuan-desktop add \
  chayuan-server/libs/chayuan-server/chayuan/server/db/alembic/versions/0022_vg_sources_config.py \
  chayuan-server/libs/chayuan-server/chayuan/server/video_generation/sources/config_store.py \
  chayuan-server/libs/chayuan-server/chayuan/server/db/models/__init__.py \
  chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
git -C /work/chayuan-desktop commit -m "feat(server/vg): R1.5 alembic 0022 + sources_config 存储 + GET/POST endpoints"
```

---

### Task R1.6: R1 收尾 — 推送

- [ ] **Step 1: typecheck server-side(Python 编译已在各 step 做)+ 看 git log**

```bash
git -C /work/chayuan-desktop log --oneline f914115..HEAD
```

Expected: 5-6 行 R1.* commits

- [ ] **Step 2: 推送**

```bash
git -C /work/chayuan-desktop push origin main 2>&1 | tail -3
```

Expected: `main -> main` 成功

---

## R2 · ChatMessage.metadata.videoMeta 类型 + ConversationView extraSlot

### Task R2.1: 看 transport 现有 ChatMessage 类型,补 videoMeta 字段

**Files:**
- Modify: `chayuan-client/packages/transport/src/types.ts`

- [ ] **Step 1: 阅读 transport 现有 ChatMessage 接口位置**

```bash
grep -nE "interface ChatMessage|ChatMessageMetadata|^export interface" /work/chayuan-desktop/chayuan-client/packages/transport/src/types.ts | head -10
```

- [ ] **Step 2: 在 types.ts 顶部 import 区下方追加 VgMessageMetadata 类型**

(实际位置看 grep 结果;若 transport 已有 ChatMessageMetadata 接口,扩它;若没有,新增 module-level 类型并在 ChatMessage 接口加 `metadata?: ChatMessageMetadata` 字段)

最小版本(假设需要新增):

```typescript
// ─────────────────────────────────────────────────────────────────────
// 视频生成模块 chat 消息扩展(R2 加)
// ─────────────────────────────────────────────────────────────────────

export type VgRenderState = 'idle' | 'submitting' | 'running' | 'complete' | 'failed';

export interface VgScriptCue {
  index: number;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface VgMessageMeta {
  taskId?: string;
  scriptCues?: VgScriptCue[];
  tts?: {
    provider: 'piper' | 'edge' | 'sherpa';
    voice: string;
    rate: number;
    volume: number;
  };
  materials?: Array<{ provider: string; url: string; duration: number }>;
  bgm?: { type: 'none' | 'random' | 'file'; file: string; volume: number };
  renderState?: VgRenderState;
  finalVideos?: string[];
  videoAspect?: '16:9' | '9:16' | '1:1';
}
```

并在已有 ChatMessage 接口里(看 grep 结果定位)加:

```typescript
// 在 ChatMessage 接口内追加(或扩展 ChatMessageMetadata):
videoMeta?: VgMessageMeta;
```

- [ ] **Step 3: typecheck transport + 全工作区**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/transport typecheck 2>&1 | tail -3 && pnpm typecheck 2>&1 | tail -5
```

Expected: 全 Done,无 error

- [ ] **Step 4: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/transport/src/types.ts
git -C /work/chayuan-desktop commit -m "feat(client/transport): R2.1 VgMessageMeta 类型 + ChatMessage.videoMeta 字段"
```

---

### Task R2.2: ConversationView 加 extraSlot prop

**Files:**
- Modify: `chayuan-client/packages/app/src/features/chat/ConversationView.tsx`
- Modify: `chayuan-client/packages/app/src/features/chat/MessageBubble.tsx`(如果存在,否则 ConversationView 内部找渲染 message 那段)

- [ ] **Step 1: 定位 ConversationView 渲染 message 的代码段**

```bash
grep -nE "MessageBubble|message\.role|messages\.map" /work/chayuan-desktop/chayuan-client/packages/app/src/features/chat/ConversationView.tsx | head -10
```

- [ ] **Step 2: 给 ConversationView 加 extraSlot prop**

修改 ConversationView 的 props 接口:

```typescript
export interface ConversationViewProps {
  // 现有字段保留
  // ...
  /** 每条 assistant 消息渲染后追加自定义组件(video_generation 等场景挂载视频专属 UI) */
  extraSlot?: (message: ChatMessage) => React.ReactNode;
}
```

在 messages map 渲染那段,assistant 消息 bubble 渲染**之后**插入:

```tsx
{m.role === 'assistant' && extraSlot ? extraSlot(m) : null}
```

确保位置在 MessageBubble 的关闭标签 / </div> 之后,而非 children 内,以避免破坏 chat 内部排版。

- [ ] **Step 3: typecheck + 启动 chat smoke test(确保 chat 模式正常,extraSlot 默认 undefined 不影响)**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

Expected: Done 无 error

- [ ] **Step 4: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/chat/ConversationView.tsx
git -C /work/chayuan-desktop commit -m "feat(client/chat): R2.2 ConversationView 加 extraSlot prop"
```

---

### Task R2.3: chat runner 把 [[VG_META]]…[[/VG_META]] sentinel 抽到 message.metadata.videoMeta

**Files:**
- Modify: `chayuan-client/packages/app/src/features/chat/useChayuanChat.ts`(或者 message 写入位置 — 实际看 chat 协议解析在前端哪里)

- [ ] **Step 1: 定位前端 SSE chunk → message 合并位置**

```bash
grep -nE "VG_META|setMessages|message\.content|\.\.\.message" /work/chayuan-desktop/chayuan-client/packages/app/src/features/chat/useChayuanChat.ts | head -10
```

- [ ] **Step 2: 在最终 message 写入前加 sentinel 提取逻辑**

在 message content 落定的位置(SSE done / final assemble),写一个小工具:

```typescript
// chayuan-client/packages/app/src/features/chat/parseVgMeta.ts (新文件)
import type { VgMessageMeta } from '@chayuan/transport';

const VG_META_RE = /\[\[VG_META\]\]([\s\S]*?)\[\[\/VG_META\]\]/;

export function parseAndStripVgMeta(content: string): {
  text: string;
  videoMeta?: VgMessageMeta;
} {
  const m = VG_META_RE.exec(content);
  if (!m) return { text: content };
  let videoMeta: VgMessageMeta | undefined;
  try {
    const obj = JSON.parse(m[1]) as { videoMeta?: VgMessageMeta };
    videoMeta = obj.videoMeta;
  } catch {
    // 容错:解析失败就不挂 metadata,只把 sentinel 当文本留着
    return { text: content };
  }
  return { text: content.replace(VG_META_RE, '').trim(), videoMeta };
}
```

然后在 useChayuanChat 写 message 的位置调用它:

```typescript
import { parseAndStripVgMeta } from './parseVgMeta';

// 当 assistant message content 最终落定时(SSE done):
const { text, videoMeta } = parseAndStripVgMeta(content);
// 把 text 替换 content,videoMeta 写到 message.metadata.videoMeta
```

实际写法依赖 useChayuanChat 的 reducer/setter,工程师按现有 setState pattern 改。

- [ ] **Step 3: 单测 parseAndStripVgMeta**

```typescript
// chayuan-client/packages/app/src/features/chat/__tests__/parseVgMeta.test.ts
import { describe, it, expect } from 'vitest';
import { parseAndStripVgMeta } from '../parseVgMeta';

describe('parseAndStripVgMeta', () => {
  it('returns content unchanged when no sentinel', () => {
    const r = parseAndStripVgMeta('hello world');
    expect(r.text).toBe('hello world');
    expect(r.videoMeta).toBeUndefined();
  });
  it('extracts videoMeta and strips sentinel', () => {
    const r = parseAndStripVgMeta('hello\n[[VG_META]]{"videoMeta":{"renderState":"idle"}}[[/VG_META]]');
    expect(r.text).toBe('hello');
    expect(r.videoMeta).toEqual({ renderState: 'idle' });
  });
  it('returns content unchanged on JSON parse error', () => {
    const r = parseAndStripVgMeta('hello [[VG_META]]not json[[/VG_META]]');
    expect(r.text).toBe('hello [[VG_META]]not json[[/VG_META]]');
    expect(r.videoMeta).toBeUndefined();
  });
});
```

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app test parseVgMeta 2>&1 | tail -5
```

Expected: 3 passed

- [ ] **Step 4: 提交**

```bash
git -C /work/chayuan-desktop add \
  chayuan-client/packages/app/src/features/chat/parseVgMeta.ts \
  chayuan-client/packages/app/src/features/chat/__tests__/parseVgMeta.test.ts \
  chayuan-client/packages/app/src/features/chat/useChayuanChat.ts
git -C /work/chayuan-desktop commit -m "feat(client/chat): R2.3 [[VG_META]] sentinel 解析 + 写到 message.metadata.videoMeta"
```

---

### Task R2.4: R2 推送

```bash
git -C /work/chayuan-desktop push origin main 2>&1 | tail -3
```

---

## R3 · VgChatPage 重写 — ChatComposer + ConversationView 复用

### Task R3.1: createComposerStore('video-generation') 单例

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/store/vgComposerStore.ts`

- [ ] **Step 1: 创建独立 scope store**

```typescript
// chayuan-client/packages/app/src/features/video-generation/store/vgComposerStore.ts
/**
 * 视频生成专用 composer store — createComposerStore 的 'video-generation' scope。
 * 跟 chat 的全局 store 完全隔离,draft / 模型选择 / 附件 / KB 选中等都独立。
 *
 * ChatComposer 通过 ComposerScopedContext.Provider 接收这个 store 实例。
 */
import { createComposerStore } from '../../../store/composer';

export const vgComposerStore = createComposerStore('video-generation');
```

- [ ] **Step 2: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/store/vgComposerStore.ts
git -C /work/chayuan-desktop commit -m "feat(client/vg): R3.1 vgComposerStore — 独立 scope 实例"
```

---

### Task R3.2: VgAspectChip + VgAutoToggle 控件

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/VgAspectChip.tsx`
- Create: `chayuan-client/packages/app/src/features/video-generation/VgAutoToggle.tsx`

- [ ] **Step 1: VgAspectChip 写法**

```typescript
// chayuan-client/packages/app/src/features/video-generation/VgAspectChip.tsx
import * as React from 'react';
import { useVgComposer } from './store/vgComposer';  // 现有的 zustand store

const ASPECTS = [
  { v: '9:16' as const, label: '竖' },
  { v: '16:9' as const, label: '横' },
  { v: '1:1'  as const, label: '方' },
];

export const VgAspectChip: React.FC = () => {
  const aspect = useVgComposer((s) => s.params.video_aspect);
  const patch = useVgComposer((s) => s.patchParams);
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-0.5 text-xs">
      {ASPECTS.map((a) => (
        <button key={a.v} type="button"
          onClick={() => patch({ video_aspect: a.v })}
          className={
            'rounded px-1.5 py-0.5 transition-colors ' +
            (aspect === a.v
              ? 'bg-[var(--cy-brand-500)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')
          }
          title={`画幅 ${a.v}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: VgAutoToggle 写法**

```typescript
// chayuan-client/packages/app/src/features/video-generation/VgAutoToggle.tsx
import * as React from 'react';
import { Zap } from 'lucide-react';

export interface VgAutoToggleProps {
  autoMode: boolean;
  onChange: (v: boolean) => void;
}

export const VgAutoToggle: React.FC<VgAutoToggleProps> = ({ autoMode, onChange }) => (
  <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 text-xs">
    <input type="checkbox" checked={autoMode} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
    <Zap className={'h-3 w-3 ' + (autoMode ? 'text-amber-500' : 'text-[var(--cy-text-tertiary)]')} />
    <span className={autoMode ? 'text-amber-700 font-medium' : 'text-[var(--cy-text-secondary)]'}>
      {autoMode ? '全自动' : '自动'}
    </span>
  </label>
);
```

- [ ] **Step 3: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

- [ ] **Step 4: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/VgAspectChip.tsx chayuan-client/packages/app/src/features/video-generation/VgAutoToggle.tsx
git -C /work/chayuan-desktop commit -m "feat(client/vg): R3.2 VgAspectChip + VgAutoToggle 控件"
```

---

### Task R3.2b: VgComposerToolbar — 显式露在 composer 上方的工具栏 + 音频 popover

用户明确要求"关键配置要在对话输入框上面显示"+ "音频设置"。本组件
独立放在 ChatComposer 上方,左到右:模型 / 画幅 / 语言 / 段落 / 🔊 音频
chip(弹 popover) / 全自动。

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/VgComposerToolbar.tsx`

- [ ] **Step 1: 写组件**

```typescript
// chayuan-client/packages/app/src/features/video-generation/VgComposerToolbar.tsx
import * as React from 'react';
import { ComposerModelPill } from '../composer/ComposerModelPill';
import { VgAspectChip } from './VgAspectChip';
import { VgAutoToggle } from './VgAutoToggle';
import { useVgComposer } from './store/vgComposer';

export interface VgComposerToolbarProps {
  autoMode: boolean;
  onAutoModeChange: (v: boolean) => void;
}

export const VgComposerToolbar: React.FC<VgComposerToolbarProps> = ({
  autoMode, onAutoModeChange,
}) => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs">
      {/* 模型选择 — 复用 ChatPage 同款 pill。scope 实例隔离让 vg 跟 chat 各自记忆 */}
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">模型</span>
        <ComposerModelPill compact />
      </div>
      {/* 画幅 */}
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">画幅</span>
        <VgAspectChip />
      </div>
      {/* 语言 */}
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">语言</span>
        <select
          value={params.video_language}
          onChange={(e) => patch({ video_language: e.target.value })}
          className="rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5"
        >
          <option value="">自动</option>
          <option value="zh-CN">中文</option>
          <option value="en-US">英文</option>
          <option value="ja-JP">日文</option>
        </select>
      </div>
      {/* 段落数 */}
      <div className="inline-flex items-center gap-1">
        <span className="text-[var(--cy-text-tertiary)]">段落</span>
        <input
          type="number" min={1} max={10} value={params.paragraph_number}
          onChange={(e) => patch({
            paragraph_number: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)),
          })}
          className="w-12 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5 text-center"
        />
      </div>
      {/* 音频 — chip 弹 popover(provider/voice/rate/volume + 试听)*/}
      <VgAudioPopover />
      {/* 字幕 — chip 弹 popover(开关/位置/字体/字号/颜色/描边/背景)*/}
      <VgSubtitlePopover />
      {/* 全自动 */}
      <VgAutoToggle autoMode={autoMode} onChange={onAutoModeChange} />
    </div>
  );
};
```

- [ ] **Step 2: 新增 VgAudioPopover.tsx — chip 弹出全局音频默认设置**

```typescript
// chayuan-client/packages/app/src/features/video-generation/VgAudioPopover.tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Volume2, Wifi, WifiOff, Play, Loader2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';
import { videoGeneration, type VgVoiceItem, type VgVoiceProvider } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';
import { reportError } from '../../store/errorDialog';

const PROVIDERS: Array<{ id: VgVoiceProvider; offline: boolean; label: string }> = [
  { id: 'piper',  offline: true,  label: 'piper' },
  { id: 'edge',   offline: false, label: 'edge'  },
  { id: 'sherpa', offline: true,  label: 'sherpa'},
];

export const VgAudioPopover: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const voicesQ = useQuery({
    queryKey: ['vg.voices', params.voice_provider],
    queryFn: () => videoGeneration.listVoices(params.voice_provider),
    staleTime: 5 * 60 * 1000,
  });
  const voices: VgVoiceItem[] = voicesQ.data?.items ?? [];
  const [previewing, setPreviewing] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onPreview = async () => {
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewAudio({
        video_script: '试听一段示例文本,听听这个音色的效果。',
        voice_provider: params.voice_provider,
        voice_name: params.voice_name || undefined,
        voice_rate: params.voice_rate, voice_volume: params.voice_volume,
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(r.blob);
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = urlRef.current;
      await a.play();
    } catch (e) { reportError(e as Error, '试听失败'); }
    finally { setPreviewing(false); }
  };

  const summaryLabel = `${params.voice_provider} · ${params.voice_name || '(默认音色)'}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 hover:border-[var(--cy-border-strong)]"
          title="全局音频设置"
        >
          <Volume2 className="h-3 w-3 text-[var(--cy-brand-500)]" />
          <span className="max-w-[10rem] truncate">{summaryLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[360px] p-3 text-xs">
        {/* provider */}
        <div className="mb-2">
          <p className="mb-1 text-[var(--cy-text-tertiary)]">TTS 后端</p>
          <div className="flex flex-wrap gap-1">
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button"
                onClick={() => patch({ voice_provider: p.id, voice_name: '' })}
                className={
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ' +
                  (params.voice_provider === p.id
                    ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                    : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)]')
                }
              >
                {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {/* voice */}
        <div className="mb-2">
          <p className="mb-1 text-[var(--cy-text-tertiary)]">音色</p>
          <select
            value={params.voice_name || voices[0]?.id || ''}
            onChange={(e) => patch({ voice_name: e.target.value })}
            className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
            disabled={voices.length === 0}
          >
            {voices.length === 0 && <option value="">(无可用音色)</option>}
            {voices.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.language}</option>)}
          </select>
        </div>
        {/* rate / volume */}
        <div className="mb-2 grid grid-cols-2 gap-3">
          <label className="flex items-center gap-1">
            <span className="w-7 text-[var(--cy-text-tertiary)]">语速</span>
            <input type="range" min={0.5} max={2} step={0.05} value={params.voice_rate}
              onChange={(e) => patch({ voice_rate: parseFloat(e.target.value) })}
              className="flex-1 accent-[var(--cy-brand-500)]" />
            <span className="w-10 text-right tabular-nums">{params.voice_rate.toFixed(2)}×</span>
          </label>
          <label className="flex items-center gap-1">
            <span className="w-7 text-[var(--cy-text-tertiary)]">音量</span>
            <input type="range" min={0} max={2} step={0.05} value={params.voice_volume}
              onChange={(e) => patch({ voice_volume: parseFloat(e.target.value) })}
              className="flex-1 accent-[var(--cy-brand-500)]" />
            <span className="w-10 text-right tabular-nums">{Math.round(params.voice_volume * 100)}%</span>
          </label>
        </div>
        {/* preview */}
        <button type="button" onClick={onPreview} disabled={previewing}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--cy-brand-500)] py-1.5 text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          试听
        </button>
        <p className="mt-1.5 text-[10px] text-[var(--cy-text-tertiary)]">
          这是全局默认。每条消息块下方 TtsCard 可单独覆盖。
        </p>
      </PopoverContent>
    </Popover>
  );
};
```

把 VgAudioPopover import 加到 VgComposerToolbar.tsx 顶部:
```typescript
import { VgAudioPopover } from './VgAudioPopover';
import { VgSubtitlePopover } from './VgSubtitlePopover';
```

- [ ] **Step 3: 新增 VgSubtitlePopover.tsx — chip 弹出全局字幕样式默认**

```typescript
// chayuan-client/packages/app/src/features/video-generation/VgSubtitlePopover.tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Type } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';
import { videoGeneration, type VgFontItem } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';

export const VgSubtitlePopover: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const fontsQ = useQuery({
    queryKey: ['vg.fonts'],
    queryFn: () => videoGeneration.listFonts(),
    staleTime: 5 * 60 * 1000,
  });
  const fonts: VgFontItem[] = fontsQ.data?.items ?? [];

  const bgValue = typeof params.text_background_color === 'string'
    ? 'custom'
    : params.text_background_color ? 'on' : 'off';

  const summary = params.subtitle_enabled
    ? `${params.font_name} · ${params.font_size} · ${params.subtitle_position === 'bottom' ? '底部' : params.subtitle_position === 'top' ? '顶部' : params.subtitle_position === 'center' ? '居中' : '自定义'}`
    : '关闭';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 hover:border-[var(--cy-border-strong)]"
          title="全局字幕样式默认"
        >
          <Type className="h-3 w-3 text-[var(--cy-brand-500)]" />
          <span className="max-w-[14rem] truncate">{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[360px] p-3 text-xs">
        <label className="mb-2 flex items-center gap-1.5">
          <input type="checkbox" checked={params.subtitle_enabled}
            onChange={(e) => patch({ subtitle_enabled: e.target.checked })} />
          启用字幕
        </label>
        {params.subtitle_enabled && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">位置</p>
                <select value={params.subtitle_position}
                  onChange={(e) => patch({ subtitle_position: e.target.value as 'top'|'bottom'|'center'|'custom' })}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1">
                  <option value="top">顶部</option>
                  <option value="center">居中</option>
                  <option value="bottom">底部</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">字体</p>
                <select value={params.font_name} onChange={(e) => patch({ font_name: e.target.value })}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1">
                  {fonts.length === 0 && <option value={params.font_name}>{params.font_name}</option>}
                  {fonts.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">字号</p>
                <input type="number" min={20} max={200} value={params.font_size}
                  onChange={(e) => patch({ font_size: parseInt(e.target.value, 10) || 60 })}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1" />
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">描边粗细</p>
                <input type="number" min={0} max={10} step={0.5} value={params.stroke_width}
                  onChange={(e) => patch({ stroke_width: parseFloat(e.target.value) || 1.5 })}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">前景</p>
                <input type="color" value={params.text_fore_color}
                  onChange={(e) => patch({ text_fore_color: e.target.value })}
                  className="h-6 w-full rounded border border-[var(--cy-border-subtle)]" />
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">描边</p>
                <input type="color" value={params.stroke_color}
                  onChange={(e) => patch({ stroke_color: e.target.value })}
                  className="h-6 w-full rounded border border-[var(--cy-border-subtle)]" />
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">背景</p>
                <select value={bgValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'on') patch({ text_background_color: true });
                    else if (v === 'off') patch({ text_background_color: false });
                  }}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 py-0.5">
                  <option value="on">黑底</option>
                  <option value="off">无</option>
                </select>
              </div>
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] text-[var(--cy-text-tertiary)]">
          这是全局默认。每条任务的 SRT cue 列表(文字+时间戳)在消息块 ✎ 字幕图标 → SubtitleEditorDialog 编辑。
        </p>
      </PopoverContent>
    </Popover>
  );
};
```

- [ ] **Step 4: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -5
```

(若 `Popover/PopoverTrigger/PopoverContent` 命名不一致,看 @chayuan/ui 实际 exports 调整 import;若 `compact` prop 不存在于 ComposerModelPill,改用 wrap 实现)

- [ ] **Step 2: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

(若 `ComposerModelPill` 没有 `compact` prop,改用现有 props 或 wrap 一下;按 typecheck 报错调)

- [ ] **Step 5: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/VgComposerToolbar.tsx chayuan-client/packages/app/src/features/video-generation/VgAudioPopover.tsx chayuan-client/packages/app/src/features/video-generation/VgSubtitlePopover.tsx
git -C /work/chayuan-desktop commit -m "feat(client/vg): R3.2b VgComposerToolbar — 7 chip 工具栏(模型/画幅/语言/段落/音频/字幕/自动)"
```

---

### Task R3.3: TtsCard 紧凑布局

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/TtsCard.tsx`

- [ ] **Step 1: 写 TtsCard(从 VoiceStep 抄,改紧凑 3 row)**

参照 `steps/VoiceStep.tsx` 现有实现(M5.B2),复制并改为:
- row1: provider chip + voice dropdown + 试听 ▶ 按钮
- row2: 语速 slider + 音量 slider 同一行 grid
- row3: 当前生效 label(小字)

绑定数据:**消息块上下文** — 每条 message 独立 `tts` state(从 `message.metadata.videoMeta.tts`),不再走 vgComposerStore.params。VgChatPage 把 message + onTtsChange callback 传进来。

```typescript
// chayuan-client/packages/app/src/features/video-generation/TtsCard.tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Play, Wifi, WifiOff } from 'lucide-react';
import { videoGeneration, type VgVoiceItem, type VgVoiceProvider } from '@chayuan/api';
import type { VgMessageMeta } from '@chayuan/transport';
import { reportError } from '../../store/errorDialog';

export interface TtsCardProps {
  tts: NonNullable<VgMessageMeta['tts']>;
  onChange: (next: NonNullable<VgMessageMeta['tts']>) => void;
  /** 试听用文本(脚本前 50 字)*/
  previewText: string;
}

const PROVIDERS: Array<{ id: VgVoiceProvider; offline: boolean; label: string }> = [
  { id: 'piper',  offline: true,  label: 'piper' },
  { id: 'edge',   offline: false, label: 'edge'  },
  { id: 'sherpa', offline: true,  label: 'sherpa'},
];

export const TtsCard: React.FC<TtsCardProps> = ({ tts, onChange, previewText }) => {
  const voicesQ = useQuery({
    queryKey: ['vg.voices', tts.provider],
    queryFn: () => videoGeneration.listVoices(tts.provider),
    staleTime: 5 * 60 * 1000,
  });
  const voices: VgVoiceItem[] = voicesQ.data?.items ?? [];
  const [previewing, setPreviewing] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);

  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onPreview = async () => {
    if (!previewText.trim()) return;
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewAudio({
        video_script: previewText.slice(0, 50),
        voice_provider: tts.provider, voice_name: tts.voice || undefined,
        voice_rate: tts.rate, voice_volume: tts.volume,
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(r.blob);
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = urlRef.current;
      await a.play();
    } catch (e) { reportError(e as Error, '试听失败'); }
    finally { setPreviewing(false); }
  };

  return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2.5 text-xs">
      {/* row 1: provider + voice + preview */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" onClick={() => onChange({ ...tts, provider: p.id, voice: '' })}
            className={
              'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ' +
              (tts.provider === p.id
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
            {p.label}
          </button>
        ))}
        <select
          value={tts.voice || voices[0]?.id || ''}
          onChange={(e) => onChange({ ...tts, voice: e.target.value })}
          disabled={voices.length === 0}
          className="rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5"
        >
          {voices.length === 0 && <option value="">(无可用音色)</option>}
          {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <button type="button" onClick={onPreview} disabled={previewing || !previewText.trim()}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-[var(--cy-brand-500)] px-2 py-0.5 text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          试听
        </button>
      </div>
      {/* row 2: rate + volume slider */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <label className="flex items-center gap-1.5">
          <span className="w-7 text-[var(--cy-text-tertiary)]">语速</span>
          <input type="range" min={0.5} max={2.0} step={0.05} value={tts.rate}
            onChange={(e) => onChange({ ...tts, rate: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--cy-brand-500)]" />
          <span className="w-10 text-right tabular-nums">{tts.rate.toFixed(2)}×</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="w-7 text-[var(--cy-text-tertiary)]">音量</span>
          <input type="range" min={0} max={2} step={0.05} value={tts.volume}
            onChange={(e) => onChange({ ...tts, volume: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--cy-brand-500)]" />
          <span className="w-10 text-right tabular-nums">{Math.round(tts.volume * 100)}%</span>
        </label>
      </div>
      {/* row 3: 当前生效 */}
      <p className="mt-1.5 text-[10px] text-[var(--cy-text-tertiary)]">
        生效:{tts.provider} · {tts.voice || '(默认)'}
      </p>
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/TtsCard.tsx
git -C /work/chayuan-desktop commit -m "feat(client/vg): R3.3 TtsCard 紧凑布局(3 row,消息块上下文)"
```

---

### Task R3.4: RenderProgressCard

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/RenderProgressCard.tsx`

- [ ] **Step 1: 写 RenderProgressCard(从 RenderStep + InProgressTasksPanel 抽出单卡片版)**

```typescript
// chayuan-client/packages/app/src/features/video-generation/RenderProgressCard.tsx
import * as React from 'react';
import { Loader2, CircleCheck, AlertTriangle, Square, Download } from 'lucide-react';
import { videoGeneration, vgTaskFileUrl, type VgTask } from '@chayuan/api';

const STEP_LABELS: Record<number, string> = {
  5: '准备', 10: '生成脚本', 20: '生成关键词', 35: '语音合成',
  50: '字幕生成', 70: '素材准备', 95: '视频合成', 100: '完成',
};
const stepLabel = (p: number) => {
  let l = STEP_LABELS[5]!;
  for (const t of [5, 10, 20, 35, 50, 70, 95, 100]) {
    if (p >= t) l = STEP_LABELS[t]!;
  }
  return l;
};

export interface RenderProgressCardProps {
  taskId: string;
  /** 终态时(complete/failed/canceled)父级回调,可触发刷新 library 等 */
  onTerminal?: () => void;
}

export const RenderProgressCard: React.FC<RenderProgressCardProps> = ({ taskId, onTerminal }) => {
  const [task, setTask] = React.useState<VgTask | null>(null);

  React.useEffect(() => {
    const ctl = new AbortController();
    void videoGeneration.subscribeTaskEvents(
      taskId, { onTask: (t) => setTask(t) }, { signal: ctl.signal },
    ).catch(() => { /* SSE 失败静默 */ });
    return () => ctl.abort();
  }, [taskId]);

  React.useEffect(() => {
    if (task && (task.state === 'complete' || task.state === 'failed' || task.state === 'canceled')) {
      onTerminal?.();
    }
  }, [task?.state, onTerminal]);

  if (!task) return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3 text-xs text-[var(--cy-text-tertiary)]">
      <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> 等待任务订阅…
    </div>
  );

  const p = task.progress;
  const cancel = async () => { try { await videoGeneration.cancelTask(taskId); } catch { /* noop */ } };

  if (task.state === 'complete') {
    const videos = task.result?.final_videos ?? [];
    return (
      <div className="space-y-2">
        <p className="text-xs text-emerald-700">
          <CircleCheck className="mr-1 inline h-3.5 w-3.5" /> 合成完成 · {videos.length} 份
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {videos.map((vp, i) => {
            const name = vp.split(/[\\/]/).pop() || `final-${i+1}.mp4`;
            return (
              <li key={vp} className="overflow-hidden rounded-lg border border-[var(--cy-border-subtle)]">
                <video src={vgTaskFileUrl(taskId, name, false)} controls preload="metadata"
                  className="w-full bg-black" style={{ aspectRatio: '9 / 16', maxHeight: '40vh' }} />
                <div className="flex items-center justify-between gap-2 p-1.5 text-[10px]">
                  <span className="truncate">{name}</span>
                  <a href={vgTaskFileUrl(taskId, name, true)} download
                    className="inline-flex items-center gap-0.5 rounded border border-[var(--cy-border-subtle)] px-1.5 py-0.5">
                    <Download className="h-3 w-3" /> 下载
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (task.state === 'failed') {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs">
        <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-rose-600" />
        合成失败:{(task.error || '未知错误').slice(0, 100)}
      </div>
    );
  }

  if (task.state === 'canceled') {
    return <p className="text-xs text-[var(--cy-text-tertiary)]"><Square className="mr-1 inline h-3 w-3" /> 已取消</p>;
  }

  // running / pending
  return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2.5">
      <div className="flex items-center gap-2 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--cy-brand-500)]" />
        <span className="text-[var(--cy-text-secondary)]">{stepLabel(p)}</span>
        <span className="ml-auto tabular-nums text-[var(--cy-text-tertiary)]">{p}%</span>
        <button type="button" onClick={cancel}
          className="rounded border border-[var(--cy-border-subtle)] px-1.5 py-0.5 text-[10px] hover:border-rose-300 hover:text-rose-600">
          <Square className="mr-0.5 inline h-2.5 w-2.5" /> 取消
        </button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--cy-surface-2)]">
        <div className="h-full bg-[var(--cy-brand-500)] transition-all"
          style={{ width: `${Math.min(100, Math.max(0, p))}%` }} />
      </div>
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/RenderProgressCard.tsx
git -C /work/chayuan-desktop commit -m "feat(client/vg): R3.4 RenderProgressCard 单任务进度 + 完成嵌入视频"
```

---

### Task R3.5: VgMessageExtras 聚合组件

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/VgMessageExtras.tsx`

- [ ] **Step 1: 写聚合**

```typescript
// chayuan-client/packages/app/src/features/video-generation/VgMessageExtras.tsx
import * as React from 'react';
import { Edit3, Sparkles } from 'lucide-react';
import type { ChatMessage } from '@chayuan/transport';
import { TtsCard } from './TtsCard';
import { RenderProgressCard } from './RenderProgressCard';
import { SubtitleEditorDialog } from './SubtitleEditorDialog';
import { MaterialsBgmOutputDialog } from './MaterialsBgmOutputDialog';

export interface VgMessageExtrasProps {
  message: ChatMessage;
  /** 父级 (VgChatPage) 提供 — 用户改 tts/bgm/cues 时 patch metadata 到 message */
  onMetaChange: (messageId: string, patch: Record<string, unknown>) => void;
  /** 用户点"去生成"后,VgChatPage 调 submitTask + 把 taskId 写回 metadata.taskId */
  onSubmit: (messageId: string) => Promise<void>;
}

export const VgMessageExtras: React.FC<VgMessageExtrasProps> = ({ message, onMetaChange, onSubmit }) => {
  const vm = message.metadata?.videoMeta;
  if (!vm) return null;
  const [subtitleOpen, setSubtitleOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // 已经有 taskId(用户已提交)→ 渲染进度卡;否则渲染 TTS + 去生成
  if (vm.taskId && vm.renderState && vm.renderState !== 'idle') {
    return (
      <div className="mt-2">
        <RenderProgressCard taskId={vm.taskId} />
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {/* 字幕图标 */}
      <div className="flex justify-end">
        <button type="button" onClick={() => setSubtitleOpen(true)}
          title="编辑字幕"
          className="inline-flex h-7 items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
          <Edit3 className="h-3 w-3" /> 字幕
        </button>
      </div>
      {/* TTS 卡 */}
      {vm.tts && (
        <TtsCard
          tts={vm.tts}
          onChange={(next) => onMetaChange(message.id, { tts: next })}
          previewText={message.content?.slice(0, 50) || ''}
        />
      )}
      {/* 去生成按钮 */}
      <div className="flex justify-end">
        <button type="button" onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 py-1.5 text-sm font-medium text-white shadow">
          <Sparkles className="h-4 w-4" /> 去生成视频
        </button>
      </div>
      {/* 弹窗 */}
      <SubtitleEditorDialog open={subtitleOpen} onOpenChange={setSubtitleOpen} />
      <MaterialsBgmOutputDialog
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onConfirm={async () => {
          setDrawerOpen(false);
          await onSubmit(message.id);
        }}
      />
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/VgMessageExtras.tsx
git -C /work/chayuan-desktop commit -m "feat(client/vg): R3.5 VgMessageExtras 聚合(TTS/字幕/去生成/进度)"
```

---

### Task R3.6: VgChatPage 重写(集成 ChatComposer + ConversationView + scope)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/VgChatPage.tsx`(整体重写)

- [ ] **Step 1: 重写 VgChatPage**

```typescript
// chayuan-client/packages/app/src/features/video-generation/VgChatPage.tsx
/**
 * 视频生成 chat-driven 入口 — R3 真复用版本。
 *
 * - ComposerScopedContext.Provider 注入 vgComposerStore,跟 chat 全局 store 隔离
 * - ChatComposer 复用,leadingControls 挂 VgAspectChip + VgAutoToggle
 * - ConversationView 复用,extraSlot 接 VgMessageExtras
 * - useChayuanChat 走 mode='video_generation';SSE chunk 后端流式;末尾 sentinel 抽 videoMeta
 * - 多任务:同一对话内多次发主题,每条 assistant message 各自独立 metadata + RenderProgressCard
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Layers, Library as LibIcon, Video as VideoIcon } from 'lucide-react';
import { ComposerScopedContext } from '../../store/composer';
import { ChatComposer } from '../composer/ChatComposer';
import { ConversationView } from '../chat/ConversationView';
import { useChayuanChat } from '../chat/useChayuanChat';
import { useTabsStore } from '../../store/tabs';
import { vgComposerStore } from './store/vgComposerStore';
import { VgComposerToolbar } from './VgComposerToolbar';
import { VgMessageExtras } from './VgMessageExtras';
import { videoGeneration } from '@chayuan/api';
import { reportError } from '../../store/errorDialog';

export const VgChatPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const [autoMode, setAutoMode] = React.useState(false);

  // 用 useChayuanChat 跟 ChatPage 同套 SSE 协议;mode 锁 video_generation
  // 让后端走 chat/handlers/video_generation.py 的 generate_override 流式路径
  const chat = useChayuanChat({ mode: 'video_generation' });

  const goBatch = () => {
    openTab('/video-generation/batch', { title: '批量生成', icon: 'layers' });
    void navigate({ to: '/video-generation/batch' as never });
  };
  const goMaterials = () => {
    openTab('/video-generation/materials', { title: '素材库', icon: 'library' });
    void navigate({ to: '/video-generation/materials' as never });
  };
  const goLibrary = () => {
    openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
    void navigate({ to: '/video-generation/library' as never });
  };

  // 修改 message.metadata 的 helper(用户调 TTS/BGM/cues 时)
  const onMetaChange = React.useCallback((messageId: string, patch: Record<string, unknown>) => {
    chat.patchMessageMetadata?.(messageId, { videoMeta: patch });
  }, [chat]);

  // 用户点"去生成"→ 取当前 message 的 metadata 提交 task,把 taskId 写回 metadata
  const onSubmit = React.useCallback(async (messageId: string) => {
    try {
      const msg = chat.messages.find((m) => m.id === messageId);
      const vm = msg?.metadata?.videoMeta;
      const script = (msg?.content || '').trim();
      const params = {
        ...vgComposerStore.getState().params,
        video_script: script,
        script_source: 'manual' as const,
        voice_provider: vm?.tts?.provider ?? 'piper',
        voice_name: vm?.tts?.voice ?? '',
        voice_rate: vm?.tts?.rate ?? 1.0,
        voice_volume: vm?.tts?.volume ?? 1.0,
        bgm_type: vm?.bgm?.type ?? 'random',
        bgm_file: vm?.bgm?.file ?? '',
        bgm_volume: vm?.bgm?.volume ?? 0.2,
        video_aspect: (vm?.videoAspect ?? '9:16') as '9:16' | '16:9' | '1:1',
        srt_cues: vm?.scriptCues ?? null,
      };
      const t = await videoGeneration.submitTask(params, { stop_at: 'video' });
      chat.patchMessageMetadata?.(messageId, {
        videoMeta: { taskId: t.task_id, renderState: 'running' },
      });
    } catch (e) {
      reportError(e as Error, '提交任务失败');
    }
  }, [chat]);

  return (
    <ComposerScopedContext.Provider value={vgComposerStore}>
      <div className="flex h-full flex-col">
        {/* 顶部快捷 */}
        <header className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-2 text-xs">
          <div className="text-[var(--cy-text-secondary)]">
            视频生成 · 对话模式
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={goBatch}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 hover:border-[var(--cy-border-strong)]">
              <Layers className="h-3 w-3" /> 批量
            </button>
            <button type="button" onClick={goMaterials}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 hover:border-[var(--cy-border-strong)]">
              <LibIcon className="h-3 w-3" /> 素材
            </button>
            <button type="button" onClick={goLibrary}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 hover:border-[var(--cy-border-strong)]">
              <VideoIcon className="h-3 w-3" /> 我的视频
            </button>
          </div>
        </header>
        {/* 消息列表(复用 ConversationView)*/}
        <div className="min-h-0 flex-1">
          <ConversationView
            mode="video_generation"
            extraSlot={(m) => (
              <VgMessageExtras message={m} onMetaChange={onMetaChange} onSubmit={onSubmit} />
            )}
          />
        </div>
        {/* 关键配置工具栏 — 显式露在 composer 上方,不藏 popover */}
        <VgComposerToolbar autoMode={autoMode} onAutoModeChange={setAutoMode} />
        {/* Composer(复用 ChatComposer)*/}
        <div className="border-t border-[var(--cy-border-subtle)]">
          <ChatComposer
            isStreaming={chat.isStreaming}
            onSend={async (text) => {
              if (autoMode) {
                // 全自动:用 vgComposerStore.params + 当前主题直接 submitTask
                try {
                  const t = await videoGeneration.submitTask(
                    { ...vgComposerStore.getState().params, video_subject: text, script_source: 'ai' },
                    { stop_at: 'video' },
                  );
                  // 用一条 assistant message 显示进度(reuse extraSlot)
                  chat.injectAssistantMessage?.({
                    content: `已提交全自动任务,主题:${text}`,
                    metadata: { videoMeta: { taskId: t.task_id, renderState: 'running' } },
                  });
                  return;
                } catch (e) { reportError(e as Error); return; }
              }
              await chat.sendMessage(text);
            }}
            showKnowledgePicker={false}
            showRetrievalControls={false}
            placeholder="输入视频主题 / 拖文件入素材库 / 粘 URL 解析"
          />
        </div>
      </div>
    </ComposerScopedContext.Provider>
  );
};
```

- [ ] **Step 2: typecheck — 此时多半会失败(useChayuanChat / ChatComposer 真实签名跟示例不符)**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -10
```

- [ ] **Step 3: 根据 typecheck error 修签名 — 实际 useChayuanChat / ChatComposer 接口可能跟示例不完全一致,按 error 逐个修,直到全绿**

(典型修复:`chat.patchMessageMetadata` 不存在 → 写一个 patcher;`mode` prop 不存在于 ChatComposer → 改 metadata 注入;`injectAssistantMessage` 不存在 → 调研对应的 reducer)

- [ ] **Step 4: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/VgChatPage.tsx
git -C /work/chayuan-desktop commit -m "feat(client/vg): R3.6 VgChatPage 重写 — ChatComposer + ConversationView 真复用"
```

---

### Task R3.7: R3 推送

```bash
git -C /work/chayuan-desktop push origin main 2>&1 | tail -3
```

---

## R4 · MaterialsBgmOutputDialog(单 Dialog 三 section + 在线源 chip)

### Task R4.1: 拆 BgmOutputStep 成 BgmSection + OutputSection

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/sections/BgmSection.tsx`
- Create: `chayuan-client/packages/app/src/features/video-generation/sections/OutputSection.tsx`

- [ ] **Step 1: 创建 BgmSection.tsx — 从 `steps/BgmOutputStep.tsx` 复制 BGM 部分**

读 `steps/BgmOutputStep.tsx`,把"背景音乐"section 的 JSX + 相关 useQuery/listBgm 提到独立组件:

```typescript
// chayuan-client/packages/app/src/features/video-generation/sections/BgmSection.tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, type VgBgmItem } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';

export const BgmSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const bgmQ = useQuery({
    queryKey: ['vg.bgm'],
    queryFn: () => videoGeneration.listBgm(),
    staleTime: 5 * 60 * 1000,
  });
  const items: VgBgmItem[] = bgmQ.data?.items ?? [];
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">背景音乐</h3>
      <div className="flex flex-wrap items-center gap-2">
        {(['none', 'random', 'file'] as const).map((t) => (
          <button type="button" key={t} onClick={() => patch({ bgm_type: t })}
            className={
              'rounded-full border px-3 py-1.5 text-xs transition-colors ' +
              (params.bgm_type === t
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            {t === 'none' ? '无' : t === 'random' ? '随机' : '指定文件'}
          </button>
        ))}
        {params.bgm_type === 'file' && (
          <select value={params.bgm_file} onChange={(e) => patch({ bgm_file: e.target.value })}
            className="min-w-[14rem] rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs">
            <option value="">(选择 BGM)</option>
            {items.map((b) => <option key={b.path} value={b.path}>{b.name} · {b.source}</option>)}
          </select>
        )}
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

- [ ] **Step 2: 创建 OutputSection.tsx — 复制渲染参数 + 字幕样式**

```typescript
// chayuan-client/packages/app/src/features/video-generation/sections/OutputSection.tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, type VgFontItem } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';

export const OutputSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const fontsQ = useQuery({
    queryKey: ['vg.fonts'],
    queryFn: () => videoGeneration.listFonts(),
    staleTime: 5 * 60 * 1000,
  });
  const fonts: VgFontItem[] = fontsQ.data?.items ?? [];
  return (
    <section className="space-y-4">
      {/* 字幕样式开关 + 7 字段 */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--cy-text-primary)]">
          字幕样式
          <label className="flex items-center gap-1 text-xs font-normal text-[var(--cy-text-secondary)]">
            <input type="checkbox" checked={params.subtitle_enabled}
              onChange={(e) => patch({ subtitle_enabled: e.target.checked })} />
            启用
          </label>
        </h3>
        {params.subtitle_enabled && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">位置</label>
              <select value={params.subtitle_position}
                onChange={(e) => patch({ subtitle_position: e.target.value as 'top'|'bottom'|'center'|'custom' })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
                <option value="top">顶部</option>
                <option value="center">居中</option>
                <option value="bottom">底部</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">字体</label>
              <select value={params.font_name} onChange={(e) => patch({ font_name: e.target.value })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
                {fonts.length === 0 && <option value={params.font_name}>{params.font_name}</option>}
                {fonts.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">字号</label>
              <input type="number" min={20} max={200} value={params.font_size}
                onChange={(e) => patch({ font_size: parseInt(e.target.value, 10) || 60 })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs" />
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">前景</label>
              <input type="color" value={params.text_fore_color}
                onChange={(e) => patch({ text_fore_color: e.target.value })}
                className="mt-1 h-7 w-full rounded border border-[var(--cy-border-subtle)]" />
            </div>
          </div>
        )}
      </div>
      {/* 渲染参数 */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">渲染参数</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">份数</label>
            <input type="number" min={1} max={5} value={params.video_count}
              onChange={(e) => patch({ video_count: parseInt(e.target.value, 10) || 1 })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs" />
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">单段最长 (s)</label>
            <input type="number" min={1} max={60} value={params.video_clip_duration}
              onChange={(e) => patch({ video_clip_duration: parseInt(e.target.value, 10) || 5 })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs" />
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">拼接</label>
            <select value={params.video_concat_mode}
              onChange={(e) => patch({ video_concat_mode: e.target.value as 'random'|'sequential' })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
              <option value="random">随机</option>
              <option value="sequential">顺序</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">转场</label>
            <select value={params.video_transition_mode}
              onChange={(e) => patch({ video_transition_mode: e.target.value as ''|'Shuffle'|'FadeIn'|'FadeOut'|'SlideIn'|'SlideOut' })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
              <option value="">无</option>
              <option value="FadeIn">FadeIn</option>
              <option value="FadeOut">FadeOut</option>
              <option value="SlideIn">SlideIn</option>
              <option value="SlideOut">SlideOut</option>
              <option value="Shuffle">Shuffle</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
};
```

- [ ] **Step 3: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

- [ ] **Step 4: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/sections/
git -C /work/chayuan-desktop commit -m "feat(client/vg): R4.1 拆 BgmOutputStep 成 BgmSection + OutputSection"
```

---

### Task R4.2: OnlineSourceChips 组件 — 列已配源 + 未配 Key 弹窗

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/sections/OnlineSourceChips.tsx`
- Modify: `chayuan-client/packages/api/src/videoGeneration.ts`(加 sourcesConfig 客户端方法)

- [ ] **Step 1: API client 加 sourcesConfig 方法**

在 `videoGeneration.ts` 命名空间 + 函数:

```typescript
export interface VgSourceConfig {
  source_name: string;
  enabled: boolean;
  api_key: string;       // "已配" 或 "" 或明文(reveal)
  has_api_key: boolean;
  config: Record<string, unknown>;
  updated_at: string | null;
}

export async function vgListSourceConfigs(reveal = false): Promise<{ items: VgSourceConfig[] }> {
  return rd<{ items: VgSourceConfig[] }>('/api/v1/video-generation/sources/config', {
    method: 'GET',
    query: { reveal },
  });
}

export async function vgUpsertSourceConfig(args: {
  source_name: string;
  enabled?: boolean;
  api_key?: string;
  config?: Record<string, unknown>;
}): Promise<VgSourceConfig> {
  return rd<VgSourceConfig>('/api/v1/video-generation/sources/config', {
    method: 'POST',
    body: args,
  });
}
```

并加入命名空间:
```typescript
export const videoGeneration = {
  // ... 现有
  listSourceConfigs: vgListSourceConfigs,
  upsertSourceConfig: vgUpsertSourceConfig,
};
```

- [ ] **Step 2: OnlineSourceChips 组件**

```typescript
// chayuan-client/packages/app/src/features/video-generation/sections/OnlineSourceChips.tsx
import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { videoGeneration, type VgSourceConfig } from '@chayuan/api';

const KNOWN_SOURCES = [
  { name: 'pexels',   label: 'Pexels',   needsKey: true },
  { name: 'pixabay',  label: 'Pixabay',  needsKey: true },
  { name: 'unsplash', label: 'Unsplash', needsKey: true },
  { name: 'youtube',  label: 'YouTube',  needsKey: true },
  { name: 'vimeo',    label: 'Vimeo',    needsKey: true },
  { name: 'ytdlp',    label: 'yt-dlp (通用 URL)', needsKey: false },
];

export const OnlineSourceChips: React.FC<{
  selected: string;
  onSelect: (name: string) => void;
}> = ({ selected, onSelect }) => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['vg.sources.config'],
    queryFn: () => videoGeneration.listSourceConfigs(false),
    staleTime: 30_000,
  });
  const configs = q.data?.items ?? [];
  const cfgByName = new Map(configs.map((c) => [c.source_name, c]));

  const [editing, setEditing] = React.useState<string | null>(null);
  const [keyDraft, setKeyDraft] = React.useState('');

  const mut = useMutation({
    mutationFn: (args: Parameters<typeof videoGeneration.upsertSourceConfig>[0]) =>
      videoGeneration.upsertSourceConfig(args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vg.sources.config'] }),
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {KNOWN_SOURCES.map((s) => {
          const c = cfgByName.get(s.name);
          const hasKey = c?.has_api_key || !s.needsKey;
          return (
            <button key={s.name} type="button" onClick={() => onSelect(s.name)}
              className={
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ' +
                (selected === s.name
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)]')
              }
            >
              {s.label}
              {!hasKey && <AlertCircle className="h-3 w-3 text-amber-500" />}
              {hasKey && s.needsKey && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              {s.needsKey && (
                <span onClick={(e) => { e.stopPropagation(); setEditing(s.name); setKeyDraft(''); }}
                  className="ml-1 cursor-pointer text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-secondary)]">
                  <Settings2 className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {editing && (
        <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2 text-xs">
          <p className="mb-1.5">为 <b>{editing}</b> 设置 API Key:</p>
          <div className="flex items-center gap-2">
            <input type="password" autoFocus value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="API Key / Access Token"
              className="flex-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1" />
            <button type="button" onClick={async () => {
              await mut.mutateAsync({ source_name: editing, enabled: true, api_key: keyDraft });
              setEditing(null);
            }}
              className="rounded bg-[var(--cy-brand-500)] px-2 py-1 font-medium text-white hover:bg-[var(--cy-brand-600)]">
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)}
              className="rounded border border-[var(--cy-border-subtle)] px-2 py-1">取消</button>
          </div>
          <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
            存储在 sqlite,仅本机访问。{editing === 'ytdlp' && '注:yt-dlp 不需要 Key。'}
          </p>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck 2>&1 | tail -3 && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3
```

- [ ] **Step 4: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/api/src/videoGeneration.ts chayuan-client/packages/app/src/features/video-generation/sections/OnlineSourceChips.tsx
git -C /work/chayuan-desktop commit -m "feat(client/vg): R4.2 OnlineSourceChips + sourcesConfig API client"
```

---

### Task R4.3: MaterialsSection(包 MaterialsStep + OnlineSourceChips)

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/sections/MaterialsSection.tsx`

- [ ] **Step 1: 写 wrap**

```typescript
// chayuan-client/packages/app/src/features/video-generation/sections/MaterialsSection.tsx
import * as React from 'react';
import { MaterialsStep } from '../steps/MaterialsStep';
import { OnlineSourceChips } from './OnlineSourceChips';
import { useVgComposer } from '../store/vgComposer';

export const MaterialsSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  // 在线源 chip 选择 = video_source(local/pexels/pixabay)
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">素材</h3>
      <div className="mb-3">
        <p className="mb-1 text-xs text-[var(--cy-text-tertiary)]">在线源:</p>
        <OnlineSourceChips
          selected={params.video_source}
          onSelect={(name) => {
            // 把已知三档映射到 video_source enum;ytdlp/unsplash/youtube/vimeo 暂当 pexels 通用
            if (name === 'pexels' || name === 'pixabay') {
              patch({ video_source: name });
            }
            // 其它源后端先支持后再开放 patch
          }}
        />
        <p className="mt-1 text-[10px] text-[var(--cy-text-tertiary)]">
          ⚠ ytdlp 通用 URL 抓取(YouTube/bilibili/抖音/西瓜/头条 等),仅限 CC0/自有素材,版权风险用户自负
        </p>
      </div>
      <MaterialsStep />
    </section>
  );
};
```

- [ ] **Step 2: typecheck + 提交**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3 && \
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/sections/MaterialsSection.tsx && \
git -C /work/chayuan-desktop commit -m "feat(client/vg): R4.3 MaterialsSection 包 MaterialsStep + OnlineSourceChips"
```

---

### Task R4.4: MaterialsBgmOutputDialog 整合(单 Dialog 三 section)

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/MaterialsBgmOutputDialog.tsx`

- [ ] **Step 1: 写 Dialog**

```typescript
// chayuan-client/packages/app/src/features/video-generation/MaterialsBgmOutputDialog.tsx
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose, DialogFooter } from '@chayuan/ui';
import { X, Sparkles } from 'lucide-react';
import { MaterialsSection } from './sections/MaterialsSection';
import { BgmSection } from './sections/BgmSection';
import { OutputSection } from './sections/OutputSection';

export interface MaterialsBgmOutputDialogProps {
  open: boolean;
  onOpenChange(o: boolean): void;
  onConfirm(): void;
}

export const MaterialsBgmOutputDialog: React.FC<MaterialsBgmOutputDialogProps> = ({
  open, onOpenChange, onConfirm,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="!w-[min(1080px,calc(100vw-32px))] !max-w-[1080px] max-h-[88vh] overflow-hidden flex flex-col gap-0 p-0">
      <DialogHeader className="flex flex-row items-center justify-between border-b border-[var(--cy-border-subtle)] px-4 py-3">
        <DialogTitle className="text-base font-semibold">完成最后配置</DialogTitle>
        <DialogClose className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]">
          <X className="h-4 w-4" />
        </DialogClose>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-4 space-y-6">
        <MaterialsSection />
        <BgmSection />
        <OutputSection />
      </div>
      <DialogFooter className="border-t border-[var(--cy-border-subtle)] px-4 py-3">
        <DialogClose className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm hover:border-[var(--cy-border-strong)]">
          取消
        </DialogClose>
        <button type="button" onClick={onConfirm}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-4 py-1.5 text-sm font-medium text-white shadow">
          <Sparkles className="h-4 w-4" /> 提交生成
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
```

- [ ] **Step 2: typecheck + 提交**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -3 && \
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/MaterialsBgmOutputDialog.tsx && \
git -C /work/chayuan-desktop commit -m "feat(client/vg): R4.4 MaterialsBgmOutputDialog 单 Dialog 三 section"
```

---

### Task R4.5: R4 推送

```bash
git -C /work/chayuan-desktop push origin main 2>&1 | tail -3
```

---

## R5 · 联调 + 退役旧 N4-N8 + 测试

### Task R5.1: 联调 — 启动 server + 跑 chat → 脚本 → 去生成 → 提交 → 进度 完整流程

- [ ] **Step 1: 本机起 server**

```bash
cd /work/chayuan-desktop/chayuan-server && poetry run python -m chayuan.server.api_server.server_app 2>&1 | tail -10
```

Expected: server 起在 127.0.0.1:62581;启动日志可见 `_video_generation_binaries` + `chat.handlers` 注册 `video_generation`

- [ ] **Step 2: 起前端 dev**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/desktop tauri dev
```

- [ ] **Step 3: 手测**

按下列序列点过:
1. 打开 `/video-generation`
2. 输入主题 "春天的花海" → Enter
3. 看消息列表:user 主题 + assistant 流式脚本(R5 仍同步,但 sentinel 抽出 videoMeta)
4. assistant message 下方应出现:字幕图标 + TTS 卡(3 row)+ 去生成按钮
5. 点 ✎ 字幕图标 → SubtitleEditorDialog 弹出(空,因为没 cues)
6. TTS 卡选 sherpa provider → voice dropdown 列表(若 seed 过模型)
7. 点试听 → 听 50 字预览
8. 点"去生成视频" → MaterialsBgmOutputDialog 弹出
9. 看到三 section:素材(含 OnlineSourceChips,有 Settings2 icon 弹 Key 配置)/ BGM / 输出
10. 选素材 + 选 BGM 随机 + 默认输出 → 点"提交生成"
11. 消息块的"去生成"按钮替换成 RenderProgressCard,进度条更新
12. 完成后嵌入 <video> 播放器 + 下载按钮

任一步骤出错,记录到 `/tmp/r5-issues.md`,逐个修。

- [ ] **Step 4: 修复联调发现的问题(典型:类型不匹配 / 后端字段名跟前端不齐 / 默认值导致 LLM 报 missing param)**

- [ ] **Step 5: 联调过的 commit**

```bash
git -C /work/chayuan-desktop add -u
git -C /work/chayuan-desktop commit -m "fix(vg): R5.1 联调修复 — 字段对齐/默认值/边界"
```

---

### Task R5.2: 退役 N4-N8 旧组件

**Files:**
- Delete: `chayuan-client/packages/app/src/features/video-generation/MaterialsDrawer.tsx`(被 MaterialsBgmOutputDialog 替代)
- 旧 VgChatPage 已被 R3.6 覆盖,无需单独删除

- [ ] **Step 1: 检查 MaterialsDrawer 是否还有 import**

```bash
grep -rnE "import.*MaterialsDrawer" /work/chayuan-desktop/chayuan-client/packages 2>&1 | head
```

Expected:仅 VgChatPage 还引(R3.6 已删 import,所以应该 0 命中)

- [ ] **Step 2: 删除文件 + typecheck**

```bash
rm /work/chayuan-desktop/chayuan-client/packages/app/src/features/video-generation/MaterialsDrawer.tsx
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck 2>&1 | tail -5
```

Expected: typecheck Done 无 error

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add -A chayuan-client/packages/app/src/features/video-generation/MaterialsDrawer.tsx
git -C /work/chayuan-desktop commit -m "chore(vg): R5.2 删除 N5 MaterialsDrawer(已被 R4 MaterialsBgmOutputDialog 替代)"
```

---

### Task R5.3: 加 e2e smoke 测试(Playwright 已存在 or vitest mock)

**Files:**
- Create: `chayuan-client/packages/app/src/features/video-generation/__tests__/VgChatPage.smoke.test.tsx`

- [ ] **Step 1: 写一个 mock smoke 测试,确保 VgChatPage 能挂载 + 渲染 composer + ConversationView**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// mock 必要的 store + router
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => {},
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// mock useChayuanChat
vi.mock('../../chat/useChayuanChat', () => ({
  useChayuanChat: () => ({
    isStreaming: false, messages: [], sendMessage: vi.fn(),
    patchMessageMetadata: vi.fn(), injectAssistantMessage: vi.fn(),
  }),
}));
// mock store/tabs
vi.mock('../../../store/tabs', () => ({ useTabsStore: () => ({ open: vi.fn() }) }));

import { VgChatPage } from '../VgChatPage';

describe('VgChatPage smoke', () => {
  it('renders without crashing', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <VgChatPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/视频生成 · 对话模式/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测**

```bash
cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app test VgChatPage.smoke 2>&1 | tail -10
```

Expected: 1 passed

- [ ] **Step 3: 提交**

```bash
git -C /work/chayuan-desktop add chayuan-client/packages/app/src/features/video-generation/__tests__/VgChatPage.smoke.test.tsx
git -C /work/chayuan-desktop commit -m "test(client/vg): R5.3 VgChatPage smoke test"
```

---

### Task R5.4: 更新 spec 状态 + 最终推送

- [ ] **Step 1: 在 spec 文件末尾追加实施记录**

```bash
cat >> /work/chayuan-desktop/docs/superpowers/specs/2026-05-28-video-generation-chat-redesign.md <<'EOF'

---

## 实施记录(2026-05-XX)

- R1 后端 attachment_extractor + handler 升级 + yt-dlp + sources_config: 完成
- R2 ChatMessage.metadata.videoMeta + ConversationView extraSlot + sentinel 解析: 完成
- R3 VgChatPage 重写(ChatComposer + ConversationView + scope + 组件套): 完成
- R4 MaterialsBgmOutputDialog 单 Dialog 三 section + OnlineSourceChips: 完成
- R5 联调 + 退役 N5 MaterialsDrawer + smoke test: 完成

剩余:
- chat handler 真流式(R1 留 R5 阶段升级 — 当前同步 LLM 调用,需要看 chat runner 协议)
- 在线源 connector(Pexels/Pixabay 已有,Unsplash/YouTube Data API/Vimeo R6 接入)
- yt-dlp 真 download endpoint 接 vg_materials(R5 仅注册 connector,未串到 wizard 在线 tab)
EOF
```

- [ ] **Step 2: 提交 spec + 推送 R5**

```bash
git -C /work/chayuan-desktop add docs/superpowers/specs/2026-05-28-video-generation-chat-redesign.md
git -C /work/chayuan-desktop commit -m "docs(vg-spec): R5.4 收尾 — 实施记录追加"
git -C /work/chayuan-desktop push origin main 2>&1 | tail -3
```

---

## Self-Review

### Spec coverage check

| Spec 要求 | Plan 任务 |
|---|---|
| 后端 handler 流式 + sentinel | R1.3 |
| attachment_extractor 5 mime | R1.1 + R1.2 |
| yt-dlp connector | R1.4 |
| sources_config 表 + endpoints | R1.5 |
| ChatMessage.metadata.videoMeta | R2.1 |
| ConversationView extraSlot | R2.2 |
| Sentinel 解析 → metadata | R2.3 |
| vgComposerStore scope | R3.1 |
| VgAspectChip + VgAutoToggle | R3.2 |
| TtsCard 紧凑 3 row | R3.3 |
| RenderProgressCard 单任务 + 完成嵌入 | R3.4 |
| VgMessageExtras 聚合 | R3.5 |
| VgChatPage 重写 | R3.6 |
| BgmSection / OutputSection 拆分 | R4.1 |
| OnlineSourceChips + 弹窗 | R4.2 |
| MaterialsSection 包装 | R4.3 |
| MaterialsBgmOutputDialog 单 Dialog | R4.4 |
| 联调 | R5.1 |
| 退役 MaterialsDrawer | R5.2 |
| smoke test | R5.3 |

### Placeholder scan

- 所有 step 都有具体代码 / 命令
- "TODO" 仅在 R5.4 实施记录的"剩余"列表(真实剩余项,非 plan 缺漏)

### Type consistency

- `VgMessageMeta` (R2.1) 跟 `TtsCard.tts` / `RenderProgressCard.taskId` / `VgMessageExtras` 字段一致
- `submitTask params` 接 `vgComposerStore.params` 类型(VgVideoParams)
- ChatComposer / useChayuanChat / ConversationView 真实签名可能跟示例不符,R3.6 step 3 明确说"按 typecheck error 修",这是 plan 缺漏的可预见点

### 备注:R3.6 风险

ChatComposer / useChayuanChat / ConversationView 真实接口跟我示例代码可能有差异。执行 R3.6 时按实际 typecheck error 逐项修。如果差异大到不能简单适配(例如 useChayuanChat 没有 patchMessageMetadata 方法),需要先扩 useChayuanChat 给 video_generation 用,这部分作为 R3.6 内的子任务处理。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-video-generation-chat-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 用 superpowers:subagent-driven-development,每个 task 起 fresh subagent + two-stage review,适合工程量大、需要严格守门的场景

**2. Inline Execution** — 当前对话内顺序执行(用 superpowers:executing-plans),批次 checkpoint 给用户确认

**Which approach?**

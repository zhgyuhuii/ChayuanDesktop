"""桌面版「轻量版 / 全量版」打包清单的**单一真源**。

谁用:
  * ``chayuan-server/packaging/pyinstaller/build.py``
      sync_bundled_models(lite=True)  → 只拷 LITE_CAPS 列出的 cap 目录
      sync_bundled_models(lite=False) → 拷 FULL_CAPS 全部
  * ``scripts/install-bundled-models.py``
      ``--lite`` flag → 只跑 LITE_CAPS 子集

谁不用:
  * ``chayuan_packaging`` 包(``--release lite/standard/pro``)是另一套 layout.yaml
    驱动的 release matrix,跟桌面打包链路独立,不复用本清单。

设计:
  * "lite installer" ≈ ~0.9 GB 安装包,自带:文本嵌入 + 重排 + 语音识别 + OCR;
    对话(chat) 由用户运行时按需下载(或对接云端 LLM),图像嵌入同理。
  * "full installer" ≈ ~3.7 GB,全 6 类能力本地化。
  * cap 名称跟 ``install-bundled-models.py`` 的 MANIFEST key 一致:
    chat / embedding / rerank / asr / ocr / image (=image-embedding)。

未来调整(比如把 image-embedding 也归 lite)只改这里,build.py 和
install-bundled-models 都跟着走。
"""
from __future__ import annotations

#: 轻量版安装包随包嵌入的 capability(磁盘 ~ 990 MB)
LITE_CAPS: tuple[str, ...] = (
    "embedding",
    "rerank",
    "asr",
    "ocr",
)

#: 全量版安装包随包嵌入的 capability(磁盘 ~ 3.5 GB,含 chat 主力模型)
FULL_CAPS: tuple[str, ...] = LITE_CAPS + (
    "chat",
    "image",          # 图像嵌入(image-embedding 的短名,跟 install-bundled-models MANIFEST 一致)
)

#: 集成清单 alias 表,便于按 flavor 字符串拿对应清单
FLAVOR_CAPS: dict[str, tuple[str, ...]] = {
    "lite": LITE_CAPS,
    "full": FULL_CAPS,
}


def caps_for(flavor: str) -> tuple[str, ...]:
    """`flavor` ∈ {'lite','full'};未知值抛 ValueError。"""
    if flavor not in FLAVOR_CAPS:
        raise ValueError(
            f"unknown flavor {flavor!r}; expected one of {sorted(FLAVOR_CAPS)}"
        )
    return FLAVOR_CAPS[flavor]


__all__ = ["LITE_CAPS", "FULL_CAPS", "FLAVOR_CAPS", "caps_for"]

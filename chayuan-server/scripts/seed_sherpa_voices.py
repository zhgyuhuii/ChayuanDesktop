#!/usr/bin/env python3
"""下载 sherpa-onnx 中文 TTS 模型到 vendor/bundled_models/tts/sherpa-onnx/,
补齐「语音设置 → sherpa」的音色(含多说话人,如 aishell3 174 个)。

为什么 sherpa 下拉是空的:
  /voices?provider=sherpa 扫 <CHAYUAN_ROOT>/models/bundled/tts/sherpa-onnx/
  和 vendor/bundled_models/tts/sherpa-onnx/ 两档目录里含 model.onnx + tokens.txt
  的子目录。没下过模型 → 0 个 → 下拉空。本脚本把模型下到 vendor,打包/装机带上。

模型来源:k2-fsa/sherpa-onnx GitHub release 的 tar.bz2(官方,稳定 URL)。
  默认集:
    vits-zh-hf-fanchen-C  单说话人女声 ~115MB(小,快)
    vits-zh-aishell3      多说话人 174 音色 ~120MB(/voices 会展开成 174 条)
  endpoint 走 CHAYUAN_SHERPA_BASE(默认 GitHub release);国内不通可设镜像,
  或手动从 release 页下 tar.bz2 解压到目标目录(脚本失败时打印路径)。

落地布局(_scan_sherpa_voices + _build_sherpa_tts 要求):
    vendor/bundled_models/tts/sherpa-onnx/<name>/{model.onnx, tokens.txt, lexicon.txt, ...}

用法:
    python scripts/seed_sherpa_voices.py            # 默认 2 个中文模型
    python scripts/seed_sherpa_voices.py --models vits-zh-aishell3
    python scripts/seed_sherpa_voices.py --list
"""
from __future__ import annotations

import argparse
import os
import sys
import tarfile
import tempfile
from pathlib import Path

# 模型名 → release tar.bz2 文件名(同名解压出的目录即 voice 目录)。
# CATALOG 里的名字都已对 k2-fsa/sherpa-onnx release 实测可下(HTTP 200)。
# 更多模型见 release 页 tts-models 与官方文档 pretrained_models(TTS)。
CATALOG = {
    "zh": ["vits-zh-hf-fanchen-C", "vits-zh-aishell3"],
    "en": ["vits-piper-en_US-amy-low", "vits-piper-en_US-libritts_r-medium", "vits-ljs"],
    "de": ["vits-piper-de_DE-thorsten-low"],
    "fr": ["vits-piper-fr_FR-siwis-medium"],
}
# 一键多语言起步集(中+英各一,体积适中)
STARTER_MULTILANG = ["vits-zh-hf-fanchen-C", "vits-piper-en_US-amy-low"]
DEFAULT_MODELS = ["vits-zh-hf-fanchen-C", "vits-zh-aishell3"]
DEFAULT_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
# 国内 GitHub release 镜像前缀(2026-05-31 实测可用;mirror.ghproxy.com 已挂故不列)。
# 用 --mirror <key> 选,免手敲长 URL。值会拼到 DEFAULT_BASE 前。
MIRRORS = {
    "ghproxy": "https://ghproxy.net/",
    "ghfast": "https://ghfast.top/",
    "gh-proxy": "https://gh-proxy.com/",
}


def _bundled_sherpa_dir() -> Path:
    here = Path(__file__).resolve()
    server_root = here.parents[1]  # chayuan-server/
    return server_root / "vendor" / "bundled_models" / "tts" / "sherpa-onnx"


def _has_model(voice_dir: Path) -> bool:
    # sherpa release 里 onnx 不一定叫 model.onnx(中文 hf-fanchen=<name>.onnx、
    # piper=<voice>.onnx),所以认 tokens.txt + 任意 *.onnx。
    if not (voice_dir / "tokens.txt").is_file():
        return False
    return (voice_dir / "model.onnx").is_file() or any(voice_dir.glob("*.onnx"))


def _fetch_to_tmp(url: str, retries: int = 3):
    """下载 url 到临时文件,带重试 + 完整性校验(content-length)。成功返回路径,失败 None。"""
    import httpx
    for attempt in range(1, retries + 1):
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".tar.bz2", delete=False) as tf:
                tmp = tf.name
            with httpx.Client(timeout=600.0, follow_redirects=True) as client:
                with client.stream("GET", url) as r:
                    r.raise_for_status()
                    total = int(r.headers.get("content-length") or 0)
                    with open(tmp, "wb") as out:
                        for chunk in r.iter_bytes(1 << 20):
                            out.write(chunk)
            got = os.path.getsize(tmp)
            if total and got < total:
                raise IOError(f"不完整 {got}/{total} 字节")
            return tmp
        except Exception as e:  # noqa: BLE001
            print(f"[sherpa]    尝试 {attempt}/{retries} 失败: {type(e).__name__}: {e}")
            if tmp and os.path.isfile(tmp):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
    return None


def _extract(archive: str, name: str, voice_dir: Path, dest_root: Path) -> bool:
    """解压 tar.bz2 到 dest_root(包内即 <name>/...),校验出 model+tokens。"""
    try:
        print(f"[sherpa]    解压 {name} → {dest_root}")
        with tarfile.open(archive, "r:bz2") as tar:
            tar.extractall(dest_root)
    except Exception as e:  # noqa: BLE001
        print(f"[sherpa]    解压失败: {type(e).__name__}: {e}")
        return False
    if _has_model(voice_dir):
        print(f"[sherpa]    ok {name}(含 model.onnx + tokens.txt)")
        return True
    print(f"[sherpa] !! 解压后 {voice_dir} 缺 model.onnx / tokens.txt — 检查包结构")
    return False


def _download_extract(name: str, bases: "list[str]", dest_root: Path) -> bool:
    """复用优先:已解压→跳过;目标目录已有 <name>.tar.bz2(手动下的)→直接解压不下载;
    都没有→主源优先逐个换镜像下载(每源 3 次重试 + 完整性校验)。"""
    voice_dir = dest_root / name
    # 1) 已解压 → 跳过
    if _has_model(voice_dir):
        print(f"[sherpa]    skip(已解压) {name}")
        return True
    dest_root.mkdir(parents=True, exist_ok=True)
    # 2) 目录里已有 <name>.tar.bz2(用户手动下的)→ 直接解压,绝不重新下载
    local = dest_root / f"{name}.tar.bz2"
    if local.is_file() and local.stat().st_size > 0:
        print(f"[sherpa]    发现本地归档 {local.name}({local.stat().st_size} 字节)→ 跳过下载,直接解压")
        if _extract(str(local), name, voice_dir, dest_root):
            return True
        print(f"[sherpa] !! 本地 {local.name} 解压失败(可能不完整);删掉它或重下后再跑")
        return False
    # 3) 都没有 → 多源下载(下到临时文件,解压后删)
    try:
        import httpx  # noqa: F401
    except ImportError:
        print("[sherpa] !! 需要 httpx:pip install httpx")
        return False
    for base in bases:
        url = f"{base.rstrip('/')}/{name}.tar.bz2"
        print(f"[sherpa]    GET {url}")
        tmp = _fetch_to_tmp(url)
        if not tmp:
            print("[sherpa]    × 此源失败,换下一个…")
            continue
        try:
            ok = _extract(tmp, name, voice_dir, dest_root)
            return ok  # 下到了就不再换源(换源也是同一个包,结构不对换了没用)
        finally:
            if os.path.isfile(tmp):
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
    print(
        f"[sherpa] !! 所有源都失败 {name};手动下 {name}.tar.bz2 放到 {dest_root} 后重跑"
        f"(会自动解压),或设 CHAYUAN_SHERPA_BASE 换源"
    )
    return False


def _detect_num_speakers(voice_dir: Path):
    """读 sherpa VITS onnx metadata 里的 n_speakers(多说话人才 >1)。

    只读 onnx 模型元数据、不做推理;读不到返 None(不写旁路文件,留给运行时
    自愈)。这样 /voices 枚举(_sherpa_num_speakers 路径 1)能直接读文件,
    frozen 下不依赖 import sherpa_onnx。
    """
    onnx = voice_dir / "model.onnx"
    if not onnx.is_file():
        cands = sorted(voice_dir.glob("*.onnx"))
        if not cands:
            return None
        onnx = cands[0]
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(str(onnx), providers=["CPUExecutionProvider"])
        meta = sess.get_modelmeta().custom_metadata_map or {}
        for k in ("n_speakers", "num_speakers"):
            if k in meta:
                return max(1, int(meta[k]))
    except Exception:  # noqa: BLE001
        pass
    return None


def _ensure_num_speakers_file(voice_dir: Path) -> None:
    """给 voice 目录写 num_speakers 旁路文件(已存在则跳过)。"""
    f = voice_dir / "num_speakers"
    if f.is_file():
        return
    n = _detect_num_speakers(voice_dir)
    if n is None:
        print(f"[sherpa]    -- {voice_dir.name}: 未读出 num_speakers(留给运行时自愈)")
        return
    try:
        f.write_text(str(n), encoding="utf-8")
        print(f"[sherpa]    -- {voice_dir.name}: num_speakers={n} 已写旁路文件")
    except OSError as e:
        print(f"[sherpa]    !! 写 num_speakers 失败 {voice_dir}: {e}")


def _runtime_sherpa_roots():
    """/voices 实际扫描的两档目录(vendor + CHAYUAN_ROOT/models/bundled)。"""
    roots = [_bundled_sherpa_dir()]
    try:
        from chayuan.settings import CHAYUAN_ROOT
        roots.append(Path(str(CHAYUAN_ROOT)) / "models" / "bundled" / "tts" / "sherpa-onnx")
    except Exception:  # noqa: BLE001
        pass
    return roots


def _backfill_num_speakers() -> int:
    """给两档目录里所有已装 sherpa 模型补 num_speakers 旁路文件。返回处理数。"""
    n = 0
    for root in _runtime_sherpa_roots():
        if not root.is_dir():
            continue
        for vd in sorted(p for p in root.iterdir() if p.is_dir()):
            if _has_model(vd):
                _ensure_num_speakers_file(vd)
                n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description="seed sherpa-onnx Chinese TTS models")
    ap.add_argument("--models", default="", help="逗号分隔模型名;缺省用默认集(中文)")
    ap.add_argument("--all", action="store_true", help="下中+英多语言起步集(STARTER_MULTILANG)")
    ap.add_argument("--list", action="store_true", help="按语言列出可下模型目录(CATALOG)")
    ap.add_argument("--mirror", default="", help="国内镜像: ghproxy / ghfast / gh-proxy(免手设环境变量)")
    ap.add_argument("--backfill", action="store_true",
                    help="只给已装 sherpa 模型补 num_speakers 旁路文件(修 174 音色塌成 1),不下载")
    args = ap.parse_args()

    if args.list:
        print("sherpa 可下模型(按语言;名字均已实测可下):")
        for lang, ms in CATALOG.items():
            print(f"  [{lang}]")
            for m in ms:
                print(f"    {m}")
        print("用法: python scripts/seed_sherpa_voices.py --models <名1>,<名2>")
        print("     python scripts/seed_sherpa_voices.py --all   # 中+英起步集")
        print("国内慢/不通,加镜像(任选其一,实测可用): --mirror ghproxy | ghfast | gh-proxy")
        print("     例: python scripts/seed_sherpa_voices.py --all --mirror ghproxy")
        return 0

    if args.backfill:
        n = _backfill_num_speakers()
        print(f"[sherpa] backfill done: 处理 {n} 个已装模型")
        return 0

    # 提醒装运行时包(只是模型 seed,推理还需 sherpa-onnx)
    try:
        import sherpa_onnx  # noqa: F401
    except Exception:  # noqa: BLE001
        print("[sherpa] !! 未检测到 sherpa-onnx 包,推理时用不了。先装: "
              "pip install sherpa-onnx (国内: pip install sherpa-onnx -i "
              "https://pypi.tuna.tsinghua.edu.cn/simple)")

    if args.all:
        models = list(STARTER_MULTILANG)
    elif args.models:
        models = [m.strip() for m in args.models.split(",") if m.strip()]
    else:
        models = list(DEFAULT_MODELS)
    if args.mirror:
        prefix = MIRRORS.get(args.mirror, args.mirror)  # 也允许直接传前缀 URL
        primary = prefix.rstrip("/") + "/" + DEFAULT_BASE
    else:
        primary = os.environ.get("CHAYUAN_SHERPA_BASE") or DEFAULT_BASE
    # 候选源:主源优先,然后自动兜底所有内置镜像(GitHub 国内常断,逐个换)。
    # "".join(x.split()) 去掉粘贴长 URL 时被终端折行带进来的 \n / 空格。
    bases = ["".join(primary.split())]
    for _pref in MIRRORS.values():
        _m = "".join((_pref.rstrip("/") + "/" + DEFAULT_BASE).split())
        if _m not in bases:
            bases.append(_m)
    dest = _bundled_sherpa_dir()
    print(f"[sherpa] 候选源 {len(bases)} 个(主 + 兜底镜像):")
    for _b in bases:
        print(f"[sherpa]   - {_b}")
    print(f"[sherpa] dest = {dest}")
    print(f"[sherpa] models = {models}")

    ok = 0
    for name in models:
        print(f"[sherpa] -- {name}")
        if _download_extract(name, bases, dest):
            ok += 1
    # 写 num_speakers 旁路文件,让 /voices 枚举不依赖运行时 import sherpa_onnx
    for name in models:
        vd = dest / name
        if _has_model(vd):
            _ensure_num_speakers_file(vd)
    print(f"[sherpa] done: {ok}/{len(models)} 成功")
    return 0 if ok == len(models) else 1


if __name__ == "__main__":
    sys.exit(main())

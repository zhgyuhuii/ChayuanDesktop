"""macOS:在 _ssl 被 import 前用 ctypes 预加载 libcrypto / libssl。

爆量诊断版 ── 之前几次失败完全不知道这个 hook 有没有跑、bundle 里到底
有没有 libssl,这一版把所有关键步骤打到 stderr,下次失败时贴 log 就能定位。
"""
from __future__ import annotations

import ctypes
import os
import sys


def _log(msg: str) -> None:
    sys.stderr.write(f"[chayuan-rthook-openssl] {msg}\n")
    sys.stderr.flush()


# 顶层 print:只要 hook 被加载,这条就会出现。如果失败 stderr 里看不到这一行,
# 说明 hook 根本没被打包/没被执行。
_log("=== runtime hook entered ===")
_log(f"sys.platform = {sys.platform}")
_log(f"sys._MEIPASS = {getattr(sys, '_MEIPASS', '<not set>')}")

if sys.platform == "darwin":
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        _log("WARN: 没有 sys._MEIPASS,非 PyInstaller bundle?跳过。")
    else:
        # 1) 走遍整个 bundle 找 libssl/libcrypto,打印每一个命中
        targets = ("libcrypto.3.dylib", "libssl.3.dylib")
        all_hits: list[str] = []
        for dirpath, _dirnames, filenames in os.walk(meipass):
            for fn in filenames:
                if fn.startswith("libssl.") or fn.startswith("libcrypto."):
                    all_hits.append(os.path.join(dirpath, fn))

        _log(f"bundle 内 libssl/libcrypto 命中 {len(all_hits)} 个:")
        for p in all_hits:
            _log(f"  · {p}")

        if not all_hits:
            _log("ERROR: bundle 里完全没有 libssl/libcrypto,_ssl 必挂。")
            _log(f"  作为兜底,把 _MEIPASS 加到 DYLD_FALLBACK_LIBRARY_PATH:{meipass}")
            os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
                meipass + ":" + os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
            )
        else:
            # 2) 把 bundle 内所有目录加到 DYLD_FALLBACK_LIBRARY_PATH。
            #    dyld 解析 @rpath 失败后会再查 DYLD_FALLBACK_LIBRARY_PATH;
            #    把含 libssl 的目录都加进去,加大命中概率。
            extra_dirs = sorted({os.path.dirname(p) for p in all_hits})
            old_fallback = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
            os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
                ":".join(extra_dirs) + (":" + old_fallback if old_fallback else "")
            )
            _log(f"已设 DYLD_FALLBACK_LIBRARY_PATH={os.environ['DYLD_FALLBACK_LIBRARY_PATH']}")

            # 3) 用 ctypes 预加载,RTLD_GLOBAL。
            #    顺序很重要:libssl 依赖 libcrypto,先 load libcrypto。
            for canonical in ("libcrypto.3.dylib", "libssl.3.dylib"):
                # 优先 bundle 根的 canonical 名
                root_candidate = os.path.join(meipass, canonical)
                # 次选 bundle 内任意目录下的 canonical 名
                other_candidates = [p for p in all_hits if os.path.basename(p) == canonical]
                # 兜底:basename 以 prefix 开头的(eg libssl.3.5.dylib)
                prefix = canonical.rsplit(".", 2)[0] + "."  # "libssl." / "libcrypto."
                fallback_candidates = [p for p in all_hits if os.path.basename(p).startswith(prefix)]

                tried: list[str] = []
                if os.path.isfile(root_candidate):
                    tried.append(root_candidate)
                tried.extend(p for p in other_candidates if p != root_candidate)
                tried.extend(p for p in fallback_candidates if p not in tried)

                loaded = False
                for path in tried:
                    try:
                        ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
                        _log(f"OK  预加载 {canonical} ← {path}")
                        loaded = True
                        break
                    except OSError as e:
                        _log(f"FAIL 加载 {path}:{e}")
                if not loaded:
                    _log(f"ERROR: {canonical} 全部候选都加载失败:{tried}")
elif sys.platform != "darwin":
    _log("非 macOS,跳过预加载(Linux ld.so / Windows PATH 各有规则)")

_log("=== runtime hook done ===")

"""macOS:在 _ssl 被 import 前用 ctypes 预加载 libcrypto / libssl + 全套诊断。

之前几次 ctypes.CDLL 失败都被 PyInstaller wrapper 吞掉了真实 dlerror。这一版:
1) 走遍 _MEIPASS 找到 libssl/libcrypto;
2) 对每个文件 stat/读 magic/跑 otool -D/-L、xattr、codesign、file ── 把所有
   能拿到的元信息都打到 stderr;
3) 用 ctypes 直接拿 libdyld 的 dlopen,绕开 PyInstaller wrapper,拿真实 dlerror;
4) 最后再做正常 RTLD_GLOBAL 预加载。

任何一条诊断里出现异常(0 字节 / 错架构 / quarantine xattr / 签名校验失败)
都直接给定位答案。
"""
from __future__ import annotations

import ctypes
import os
import subprocess
import sys


def _log(msg: str) -> None:
    sys.stderr.write(f"[chayuan-rthook-openssl] {msg}\n")
    sys.stderr.flush()


def _run(cmd: list[str], timeout: int = 5) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out = (r.stdout or "") + (r.stderr or "")
        return out.strip() or "(empty output)"
    except Exception as e:
        return f"(failed: {e})"


def _diagnose_file(path: str) -> None:
    _log(f"--- 诊断 {path} ---")
    # 1) 文件元数据
    try:
        st = os.stat(path)
        _log(f"  size={st.st_size}  mode={oct(st.st_mode)}  uid={st.st_uid}")
    except Exception as e:
        _log(f"  os.stat 失败:{e}")
        return
    # 2) Mach-O magic(头 4 字节)
    try:
        with open(path, "rb") as f:
            magic = f.read(8).hex()
        _log(f"  头 8 字节 = {magic}  (期望 cffaedfe / cafebabe / cafebabf)")
    except Exception as e:
        _log(f"  打开文件读 magic 失败:{e}")
    # 3) file(1)
    _log(f"  file: {_run(['/usr/bin/file', path])}")
    # 4) otool -D(install_name)
    _log(f"  otool -D:\n{_run(['/usr/bin/otool', '-D', path])}")
    # 5) otool -L(依赖)
    _log(f"  otool -L:\n{_run(['/usr/bin/otool', '-L', path])}")
    # 6) xattr(quarantine 等)
    _log(f"  xattr -l: {_run(['/usr/bin/xattr', '-l', path])}")
    # 7) codesign 状态
    _log(f"  codesign -dv: {_run(['/usr/bin/codesign', '-dv', '--verbose=2', path])}")
    # 8) 原生 dlopen 拿真实 dlerror
    try:
        libdyld = ctypes.CDLL("/usr/lib/system/libdyld.dylib", mode=ctypes.RTLD_GLOBAL)
        dlopen = libdyld.dlopen
        dlopen.argtypes = [ctypes.c_char_p, ctypes.c_int]
        dlopen.restype = ctypes.c_void_p
        dlerror = libdyld.dlerror
        dlerror.argtypes = []
        dlerror.restype = ctypes.c_char_p
        # RTLD_NOW=2, RTLD_GLOBAL=8
        handle = dlopen(path.encode("utf-8"), 2 | 8)
        if handle:
            _log(f"  原生 dlopen OK,handle=0x{handle:x}")
        else:
            err = dlerror()
            _log(f"  原生 dlopen 失败,真实 dlerror:{err.decode('utf-8') if err else '<none>'}")
    except Exception as e:
        _log(f"  原生 dlopen 调用本身异常:{e}")


_log("=== runtime hook entered ===")
_log(f"sys.platform = {sys.platform}")
_log(f"sys._MEIPASS = {getattr(sys, '_MEIPASS', '<not set>')}")

if sys.platform == "darwin":
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        _log("WARN: 没有 sys._MEIPASS,非 PyInstaller bundle?跳过。")
    else:
        all_hits: list[str] = []
        for dirpath, _dirnames, filenames in os.walk(meipass):
            for fn in filenames:
                if fn.startswith("libssl.") or fn.startswith("libcrypto."):
                    all_hits.append(os.path.join(dirpath, fn))

        _log(f"bundle 内 libssl/libcrypto 命中 {len(all_hits)} 个:")
        for p in all_hits:
            _log(f"  · {p}")

        if not all_hits:
            _log("ERROR: bundle 里完全没有 libssl/libcrypto。")
        else:
            # 全套诊断 ── 每个文件都看一遍
            for path in all_hits:
                _diagnose_file(path)

            # DYLD_FALLBACK_LIBRARY_PATH 兜底(对子进程有效)
            extra_dirs = sorted({os.path.dirname(p) for p in all_hits})
            old_fallback = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
            os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = (
                ":".join(extra_dirs) + (":" + old_fallback if old_fallback else "")
            )

            # 正常预加载尝试(用 PyInstaller-wrap 过的 ctypes.CDLL)
            for canonical in ("libcrypto.3.dylib", "libssl.3.dylib"):
                candidates = [p for p in all_hits if os.path.basename(p) == canonical]
                loaded = False
                for path in candidates:
                    try:
                        ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
                        _log(f"OK CDLL 预加载 {canonical} ← {path}")
                        loaded = True
                        break
                    except OSError as e:
                        _log(f"FAIL CDLL 加载 {path}:{e}")
                if not loaded:
                    _log(f"ERROR: {canonical} CDLL 全失败")
elif sys.platform != "darwin":
    _log("非 macOS,跳过预加载")

_log("=== runtime hook done ===")

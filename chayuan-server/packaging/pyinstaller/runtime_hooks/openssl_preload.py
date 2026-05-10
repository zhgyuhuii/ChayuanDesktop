"""macOS:在 _ssl 被 import 前用 ctypes 预加载 libcrypto / libssl。

背景:PyInstaller onefile 把 ``libssl.3.dylib`` / ``libcrypto.3.dylib`` 放到
``_MEIxxx/python3.12/lib-dynload/`` 等子目录(_ssl.so 兄弟位置),不是 bundle 根。
但 ``_ssl.cpython-312-darwin.so`` 内嵌的 LC_LOAD_DYLIB 是
``@rpath/libssl.3.dylib``,而 _ssl.so 自身唯一的 LC_RPATH 解析为
``@loader_path/../..`` = bundle 根 ── 根没有就找不到,挂:

    Library not loaded: @rpath/libssl.3.dylib

通过 spec 的 a.binaries 注入屡次失败(PyInstaller 6.20 对 a.binaries 有
未公开的归一化/dedup 行为,3-tuple append 不可靠)。

这里换一个一定能赢的路子:用 ctypes 在 _ssl 被 import 之前**手动**找到
bundle 内的 libcrypto / libssl,以 RTLD_GLOBAL 预加载到进程内存。这样后续
``import _ssl`` 时 dyld 直接命中已加载镜像里的符号,不再走 @rpath 解析。

runtime hook 在 PyInstaller bootloader 设好 ``sys._MEIPASS`` 之后、用户代码
之前执行,正好赶在第一次 ``import ssl`` / ``import _ssl`` 之前。
"""
from __future__ import annotations

import ctypes
import os
import sys


def _preload_openssl_in_bundle() -> None:
    meipass = getattr(sys, "_MEIPASS", None)
    if not meipass:
        return  # 非 PyInstaller bundle 环境(开发态),跳过
    if sys.platform != "darwin":
        return  # 仅 macOS 需要这套(Linux ld.so / Windows PATH 各有规则)

    # 在 bundle 里递归找 libcrypto.3.dylib / libssl.3.dylib;无论 PyInstaller 把它
    # 放到 _MEIxxx/、python3.12/lib-dynload/、还是别的子目录,都能命中。
    targets = ("libcrypto.3.dylib", "libssl.3.dylib")
    found: dict[str, str] = {}
    for dirpath, _dirnames, filenames in os.walk(meipass):
        for fn in filenames:
            if fn in targets and fn not in found:
                found[fn] = os.path.join(dirpath, fn)
        if len(found) == len(targets):
            break

    if not found:
        # 一个都没找到:让后续 _ssl import 直接挂出原本的错误,这里不抢戏
        sys.stderr.write(
            "[chayuan-rthook-openssl] WARN: bundle 里没找到 libcrypto/libssl,"
            "_ssl 大概率会挂。\n"
        )
        return

    # 顺序很重要:libssl 依赖 libcrypto,先 load libcrypto。
    # RTLD_GLOBAL 让符号注册到全局命名空间,后续 dyld 解析 @rpath/libssl.3.dylib
    # 时会直接命中已加载的镜像,不再去文件系统找 ── 这正是绕开 @rpath 解析的关键。
    order = ("libcrypto.3.dylib", "libssl.3.dylib")
    for name in order:
        path = found.get(name)
        if not path:
            continue
        try:
            ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
        except OSError as e:
            sys.stderr.write(
                f"[chayuan-rthook-openssl] WARN: 预加载 {path} 失败:{e}\n"
            )


_preload_openssl_in_bundle()

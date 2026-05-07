"""PyInstaller runtime hook: 最早期初始化 ── multiprocessing 引导 + UTF-8 stdio。

为什么需要
----------
1. ``multiprocessing.freeze_support()``
   Windows 上 Python multiprocessing 默认用 ``spawn`` 模式 —— 父进程派生子进程时
   把 ``--multiprocessing-fork ...`` 等内部参数追加到 argv,再 re-exec 同一个 exe。
   PyInstaller 打包后,这个 exe 是用 Click(或其它 CLI 框架)解析 argv 的;它看到
   ``--multiprocessing-fork`` 这个未知 option,会直接报错 ``No such option`` 退出。
   ``freeze_support()`` 检测到子进程时完成引导即退出,主进程是 no-op。

2. ``sys.stdout / sys.stderr`` 强制 UTF-8
   Windows OEM 控制台默认 GBK,Python frozen exe 写 UTF-8 字符串会显示为乱码
   (典型表现:中文日志变 ``???``)。在 user code 之前重配 stdio 编码,任何后续
   loguru / logging handler attach 都基于 UTF-8 stream,从根上避免乱码。

两者都必须在 CLI 解析 argv 之前执行。runtime hook 由 PyInstaller bootloader
在 user code 之前注入运行,正好满足这个条件。

参考
----
- https://docs.python.org/3/library/multiprocessing.html#multiprocessing.freeze_support
- https://pyinstaller.org/en/stable/feature-notes.html#mp-on-windows
"""
import multiprocessing
import sys

# 1) UTF-8 stdio:reconfigure 是 Python 3.7+ 原地重配,不会断链下游 handler
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream is not None:
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass

# 2) multiprocessing 子进程引导(检测到 --multiprocessing-fork 时不返回)
multiprocessing.freeze_support()

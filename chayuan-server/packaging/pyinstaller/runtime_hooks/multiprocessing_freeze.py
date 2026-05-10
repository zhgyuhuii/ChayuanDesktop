"""PyInstaller runtime hook: 子进程 spawn 协议拦截 + UTF-8 stdio。

为什么需要
----------
chayuan-server 在 startup.py 里:
- ``mp.set_start_method("spawn")`` 强制 spawn(macOS Python 3.8+ 默认就是 spawn)
- ``mp.Process(run_api_server)`` / ``mp.Process(run_config_panel)`` 起子进程
- ``uvicorn.run(workers=N)`` 多 worker(N>1 时 uvicorn 内部用 subprocess)
- ``ProcessPoolExecutor`` 也走 spawn

frozen bundle 下,所有 spawn 路径都会**重新 invoke 同一个 exe**,argv 形如:
- 标准 mp:``[exe, --multiprocessing-fork, tracker_fd=N, pipe_handle=N, ...]``
- loky / uvicorn reload / 非冻结 mp 分支:``[exe, -B, -S, -I, -O, -c, <prog>, ...]``

如果在 user code(Click) 之前不拦截,Click 会报 ``No such option`` 直接退。

兜底分三层
----------
1. ``multiprocessing.freeze_support()``:Python 标准库的拦截器,处理 spawn 主路径
2. 手工捕获 ``--multiprocessing-fork``:freeze_support 偶尔会因 argv / 模块加载顺序
   漏抓(已观测到),手工再确认一遍
3. ``-B / -S / -I / -O ... -c <prog>`` 模式:loky / uvicorn reload 等不走标准
   multiprocessing.spawn 的 spawner 用这种调用约定。我们解析 ``-c`` 后的源码并
   ``exec()``,保留剩余 argv 给被 exec 的代码自己处理。

诊断
----
hook 头会打 argv 和 sys.frozen,以便后续问题定位。出问题时直接 grep
``[mp-freeze]`` 看运行轨迹。
"""
from __future__ import annotations

import sys


def _log(msg: str) -> None:
    sys.stderr.write(f"[mp-freeze] {msg}\n")
    sys.stderr.flush()


# ──────────────────────────────────────────────────────────────
# 1) UTF-8 stdio:reconfigure 是 Python 3.7+ 原地重配,不会断链下游 handler。
#    Windows OEM 控制台默认 GBK,frozen exe 写 UTF-8 会乱码。
# ──────────────────────────────────────────────────────────────
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream is not None:
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


_log(f"argv={sys.argv!r}  frozen={getattr(sys, 'frozen', False)}  exe={sys.executable!r}")


# ──────────────────────────────────────────────────────────────
# 2) 标准 multiprocessing.freeze_support()
#    捕获 ``[exe, --multiprocessing-fork, kwd=val, ...]`` 调用,run worker 后 exit。
# ──────────────────────────────────────────────────────────────
try:
    import multiprocessing
    multiprocessing.freeze_support()
    _log("freeze_support 返回(主进程或非 mp 子进程)")
except SystemExit:
    raise
except BaseException as _e:  # noqa: BLE001
    _log(f"freeze_support 抛异常:{_e!r}")


# ──────────────────────────────────────────────────────────────
# 3) 兜底 1:手工捕获 --multiprocessing-fork
#    freeze_support 偶尔漏抓(已在本项目 frozen bundle 上观测到),再确认一遍。
# ──────────────────────────────────────────────────────────────
_argv = sys.argv
if len(_argv) >= 2 and _argv[1] == "--multiprocessing-fork":
    _log("freeze_support 没拦住 --multiprocessing-fork,手工调 spawn_main")
    from multiprocessing import spawn as _mp_spawn

    _kwds: dict = {}
    for _a in _argv[2:]:
        _n, _, _v = _a.partition("=")
        if _v == "None":
            _kwds[_n] = None
        else:
            try:
                _kwds[_n] = int(_v)
            except ValueError:
                _kwds[_n] = _v
    _mp_spawn.spawn_main(**_kwds)
    sys.exit(0)


# ──────────────────────────────────────────────────────────────
# 4) 兜底 2:Python 解释器 flag + ``-c <prog>`` 模式
#    loky / 非冻结 mp 分支 / uvicorn --reload 用 ``[exe, -B, -S, -I, -O, -c, <prog>, ...]``
#    把 frozen exe 当 python 用。我们解析 -c 后的源码 exec 之。
# ──────────────────────────────────────────────────────────────
_PY_FLAGS = {"-B", "-S", "-I", "-O", "-OO", "-E", "-u", "-v", "-q", "-d", "-bb"}
if len(_argv) >= 2 and (
    _argv[1] in _PY_FLAGS or _argv[1].startswith("-X") or _argv[1].startswith("-W")
):
    # 顺序扫过 python flags,找 -c
    _i = 1
    while _i < len(_argv):
        if _argv[_i] == "-c":
            break
        if not _argv[_i].startswith("-"):
            break
        _i += 1
    if _i < len(_argv) - 1 and _argv[_i] == "-c":
        _prog = _argv[_i + 1]
        _rest = _argv[_i + 2 :]
        _log(f"intercept -c prog (源码 {len(_prog)} 字符,rest_argv={_rest!r})")
        # 模拟 ``python -c <prog> [args...]``:argv[0] = '-c',后面是用户 args
        sys.argv = ["-c"] + _rest
        try:
            exec(_prog, {"__name__": "__main__"})  # noqa: S102
        except SystemExit:
            raise
        except BaseException as _e:  # noqa: BLE001
            _log(f"-c 路径 exec 失败:{_e!r}")
            import traceback as _tb

            _tb.print_exc()
            sys.exit(1)
        sys.exit(0)
    else:
        _log(
            f"argv[1]={_argv[1]!r} 看着像 python flag,但没找到 -c。argv={_argv!r}"
        )


_log("没拦截任何 spawn 协议,继续 user code")

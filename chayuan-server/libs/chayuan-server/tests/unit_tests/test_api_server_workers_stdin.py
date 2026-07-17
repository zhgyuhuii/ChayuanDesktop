"""回归 chayuan/startup.py:run_api_server 多 worker 下的 stdin fd 处理。

历史 bug(网络/docker 部署自初始 bundle 起就有,从没跑通过):

`init_prod_profile` 给网络形态写 UVICORN_WORKERS=4 → `run_api_server` 走
`uvicorn.run(..., workers=4)`。而 `run_api_server` 本身是被 `mp.Process` 以
spawn 方式起的子进程,mp 的 `_bootstrap` 会调 `util._close_stdin()`:因为 CPython
建 `sys.stdin` 时用的是 closefd=False,它关不掉 fd 0,于是退而 `os.open(devnull)`
拿到一个高位 fd(实测 6)并把 `sys.stdin` 挂上去。

接着 uvicorn 的 `get_subprocess()` 把 `sys.stdin.fileno()`(=6)传给 worker,而
worker 由 `spawnv_passfds` 起 —— 所有 >=3 的 fd 都被关掉,于是 worker 里
`os.fdopen(6)` 抛 `OSError: [Errno 9] Bad file descriptor`,起一个死一个,
supervisor 无限重启(日志里 SpawnProcess-2:1..200+),62581 永远不监听,
nginx 报 `connect() failed (111: Connection refused)`。

注意:这跟容器有没有 stdin 无关。实测管道(`stdin_open: true`)、/dev/null
(`up -d` 默认)两种情况**都**复现 —— 因为出事的是高位 fd 6,不是 fd 0。
compose 里加 `stdin_open` 修不了它。

uvicorn 自己允许 `sys.stdin is None`(见 `uvicorn/_subprocess.py` 里
`except (AttributeError, OSError)` 那个分支),置 None 即让 worker 跳过 reopen。
"""
from __future__ import annotations

import sys

import pytest

from chayuan.startup import _detach_stdin_if_not_inheritable


class _FakeStdin:
    def __init__(self, fileno: int):
        self._fileno = fileno

    def fileno(self) -> int:
        return self._fileno


# ---------------------------------------------------------------------------
# _detach_stdin_if_not_inheritable:本次 bug 的核心原语
# ---------------------------------------------------------------------------

def test_detaches_stdin_when_fd_would_not_survive_spawn(monkeypatch):
    """fd>=3 的 stdin 在 spawnv_passfds 里会被关掉 → 必须置 None。"""
    monkeypatch.setattr(sys, "stdin", _FakeStdin(6))

    _detach_stdin_if_not_inheritable()

    assert sys.stdin is None, (
        "mp spawn 子进程里 sys.stdin 挂在高位 fd(实测 6)上,worker 继承不到;"
        "必须置 None 让 uvicorn 跳过 os.fdopen,否则 worker 起一个死一个"
    )


def test_keeps_stdin_when_fd_zero(monkeypatch):
    """fd 0 会被 worker 正常继承,不该动它(uvicorn 靠它支持调试环境)。"""
    fake = _FakeStdin(0)
    monkeypatch.setattr(sys, "stdin", fake)

    _detach_stdin_if_not_inheritable()

    assert sys.stdin is fake, "stdin 在 fd 0 上时 worker 能继承,不该置 None"


def test_none_stdin_is_noop(monkeypatch):
    """stdin 已经是 None(容器 fd 0 关闭)时不该抛。"""
    monkeypatch.setattr(sys, "stdin", None)

    _detach_stdin_if_not_inheritable()

    assert sys.stdin is None


def test_unusable_stdin_is_detached(monkeypatch):
    """fileno() 抛 OSError 的 stdin 同样传不给 worker → 置 None。"""

    class _Broken:
        def fileno(self):
            raise OSError(9, "Bad file descriptor")

    monkeypatch.setattr(sys, "stdin", _Broken())

    _detach_stdin_if_not_inheritable()

    assert sys.stdin is None


# ---------------------------------------------------------------------------
# run_api_server 多 worker 分支必须真的用上它
# ---------------------------------------------------------------------------

@pytest.fixture
def _stub_run_api_server_deps(monkeypatch, tmp_path):
    """把 run_api_server 里跟本测试无关的重活(httpx/日志/模板审计)打桩掉。

    `run_api_server` 在函数体内才 `from chayuan.server.utils import set_httpx_config`,
    而那个模块会拖进 sqlalchemy/langchain/jwt 一整条依赖链 —— 跟 stdin fd 无关。
    这里往 sys.modules 塞桩,让那句 import 直接命中,测试不依赖整套运行时依赖。
    """
    import logging.config
    import types

    import chayuan.startup as startup_mod
    import chayuan.utils as chayuan_utils

    stub_utils = types.ModuleType("chayuan.server.utils")
    stub_utils.set_httpx_config = lambda *a, **k: None
    monkeypatch.setitem(sys.modules, "chayuan.server.utils", stub_utils)

    monkeypatch.setattr(startup_mod, "_audit_prompt_templates", lambda *a, **k: None)
    monkeypatch.setattr(logging.config, "dictConfig", lambda *a, **k: None)
    monkeypatch.setattr(
        chayuan_utils, "get_log_file", lambda *a, **k: str(tmp_path / "api.log")
    )


def test_run_api_server_multiworker_detaches_stdin(monkeypatch, _stub_run_api_server_deps):
    """workers>1 时,uvicorn.run 被调用的那一刻 sys.stdin 必须已经是 None。

    这是 worker 能不能活下来的判据:uvicorn 在 run() 内部立刻读 sys.stdin.fileno()
    并传给每个 worker。
    """
    import uvicorn

    from chayuan.settings import Settings
    from chayuan.startup import run_api_server

    monkeypatch.setattr(sys, "stdin", _FakeStdin(6))

    # `Settings.basic_settings` 是 property → `_cached_settings()`,auto_reload 为真时
    # 每次访问都会 `settings.__init__()` 原地重置字段,把这里设的 4 冲回默认值 1
    # (那样就会走去单 worker 分支,测不到本 bug)。先关掉 auto_reload 再设值。
    basic = Settings.basic_settings
    monkeypatch.setattr(basic, "auto_reload", False)
    monkeypatch.setattr(basic, "UVICORN_WORKERS", 4)

    seen = {}

    def _fake_run(app, **kwargs):
        # 照抄 uvicorn.get_subprocess() 的取值方式
        try:
            seen["stdin_fileno"] = sys.stdin.fileno()
        except (AttributeError, OSError):
            seen["stdin_fileno"] = None
        seen["workers"] = kwargs.get("workers")
        seen["app"] = app

    monkeypatch.setattr(uvicorn, "run", _fake_run)

    run_api_server()

    assert seen["workers"] == 4, "UVICORN_WORKERS=4 必须走多 worker 分支"
    assert seen["stdin_fileno"] is None, (
        "uvicorn 会把这个 fileno 传给每个 worker;不是 None 的话 worker 里 "
        "os.fdopen(它) 会抛 EBADF,起一个死一个,端口永远不监听"
    )

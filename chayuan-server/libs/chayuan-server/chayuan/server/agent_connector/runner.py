from __future__ import annotations
import subprocess
from dataclasses import dataclass
from typing import Iterator, Sequence, Set


class DisallowedCommand(ValueError):
    """子命令不在白名单。"""


@dataclass
class RunResult:
    returncode: int
    stdout: str
    stderr: str


class AgentCliRunner:
    """对外部 agent CLI 的最小封装：argv list、绝不 shell=True、子命令白名单。
    约定：argv = [bin_path] + args；args[0] 同时用于白名单校验（须在 allowed 内）。"""

    def __init__(self, *, bin_path: str, allowed_subcommands: Set[str], timeout: float = 120.0):
        self.bin_path = bin_path
        self.allowed = set(allowed_subcommands)
        self.timeout = timeout

    def _argv(self, args: Sequence[str]) -> list[str]:
        if not args or args[0] not in self.allowed:
            raise DisallowedCommand(f"disallowed subcommand: {args[:1]}")
        return [self.bin_path, *list(args)]

    def run(self, args: Sequence[str], *, timeout: float | None = None) -> RunResult:
        proc = subprocess.run(self._argv(args), capture_output=True, text=True,
                              timeout=timeout or self.timeout)
        return RunResult(proc.returncode, proc.stdout, proc.stderr)

    def stream(self, args: Sequence[str]) -> Iterator[str]:
        proc = subprocess.Popen(self._argv(args), stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, bufsize=1)
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                yield line.rstrip("\n")
        finally:
            if proc.stdout:
                proc.stdout.close()
            proc.wait()

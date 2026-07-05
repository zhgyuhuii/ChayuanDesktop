from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


class Workspace:
    """Per-job volume. Dir named by `code` (§6.4). Done-marker written atomically (§C9)."""

    def __init__(self, root: Path) -> None:
        self._root = Path(root)

    def job_dir(self, code: str) -> Path:
        return self._root / code

    def ensure_job_dir(self, job_id: str, code: str) -> Path:
        d = self.job_dir(code)
        (d / "input").mkdir(parents=True, exist_ok=True)
        (d / "output").mkdir(parents=True, exist_ok=True)
        return d

    def _done_path(self, code: str) -> Path:
        return self.job_dir(code) / "output" / ".done"

    def mark_done(self, job_id: str, code: str, meta: dict[str, Any]) -> None:
        target = self._done_path(code)
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps({"job_id": job_id, **meta}))
        os.replace(tmp, target)  # atomic rename (write-then-atomic-rename, §C9)

    def is_done(self, job_id: str, code: str) -> bool:
        return self._done_path(code).exists()

    def read_done(self, job_id: str, code: str) -> dict[str, Any]:
        return json.loads(self._done_path(code).read_text())

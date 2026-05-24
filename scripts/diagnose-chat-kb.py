"""End-to-end diagnostic for "KB selected in chat but no chunks returned".

This script does in one shot:

  1. Autodiscover the active sidecar log file (no manual path needed)
  2. Sanity GET /knowledge_base/list_knowledge_bases (does sidecar see the KB)
  3. POST /knowledge_base/search_docs (direct retrieval still works?)
  4. POST /chat/v2/chat with ku_ids + kb_names + kb_name (mimics frontend
     buildRequest payload)
  5. After both POSTs, tail-grep the log file from the offset marked
     BEFORE step 3 -- so we only see lines emitted during these calls
  6. Print VERDICT pointing to root cause

Usage:
    python scripts\\diagnose-chat-kb.py
    python scripts\\diagnose-chat-kb.py --kb-name xxx
    python scripts\\diagnose-chat-kb.py --kb-name xxx --sidecar http://127.0.0.1:62581
    python scripts\\diagnose-chat-kb.py --log-file "D:\\some\\sidecar.log"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


# ---------------------------------------------------------------------------
# console: utf-8
# ---------------------------------------------------------------------------

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass


# ---------------------------------------------------------------------------
# small color helpers (best-effort, ANSI; Windows 10+ supports by default)
# ---------------------------------------------------------------------------

def _c(s, code):
    return f"\x1b[{code}m{s}\x1b[0m"
def red(s):    return _c(s, "31")
def green(s):  return _c(s, "32")
def yellow(s): return _c(s, "33")
def cyan(s):   return _c(s, "36")


# ---------------------------------------------------------------------------
# log file autodiscovery
# ---------------------------------------------------------------------------

def find_recent_log(explicit: str | None, hours: int = 4) -> Path | None:
    """Search common chayuan log locations for the most recently modified .log."""
    if explicit:
        p = Path(explicit)
        if p.is_file():
            return p
        print(red(f"--log-file does not exist: {p}"), file=sys.stderr)
        return None

    candidates: list[Path] = []
    roots = [
        Path(os.environ.get("CHAYUAN_ROOT") or "D:/chayuan-data") / "logs",
        Path(os.environ.get("CHAYUAN_ROOT") or "D:/chayuan-data"),
        Path(os.path.expanduser("~/.chayuan")) / "logs",
        Path(os.path.expanduser("~/.chayuan")),
        Path(os.environ.get("LOCALAPPDATA") or "") / "chayuan",
        Path(os.environ.get("LOCALAPPDATA") or "") / "chayuan-desktop",
        Path(os.environ.get("TEMP") or "/tmp"),
        Path("C:/Program Files/chayuan-test/chayuan-server"),
    ]
    cutoff = time.time() - hours * 3600
    for root in roots:
        if not root.is_dir():
            continue
        try:
            for p in root.rglob("*.log"):
                try:
                    if p.stat().st_mtime >= cutoff and "chayuan" in p.name.lower() + str(p.parent).lower():
                        candidates.append(p)
                except OSError:
                    continue
        except (PermissionError, OSError):
            continue
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def http_json(url: str, *, method: str = "GET", body: dict | None = None,
              timeout: int = 120) -> tuple[int, str]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json; charset=utf-8"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        return -1, f"REQUEST FAILED: {type(e).__name__}: {e}"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sidecar", default="http://127.0.0.1:62581")
    ap.add_argument("--kb-name", default="xxx")
    ap.add_argument("--query", default="api key.txt is what")
    ap.add_argument("--log-file", default="",
                    help="Path to sidecar log. If empty, autodiscover.")
    ap.add_argument("--log-wait", type=float, default=3.0,
                    help="Seconds to wait after POSTs for log to flush")
    args = ap.parse_args()

    print(cyan("=" * 64))
    print(cyan(f"sidecar : {args.sidecar}"))
    print(cyan(f"kb_name : {args.kb_name}"))
    print(cyan(f"query   : {args.query}"))

    # 1. log file
    log_path = find_recent_log(args.log_file or None)
    if log_path:
        print(cyan(f"log file: {log_path}"))
        try:
            log_size_before = log_path.stat().st_size
        except OSError:
            log_size_before = 0
    else:
        print(yellow("log file: NOT FOUND (will skip log scan; check sidecar console output instead)"))
        log_size_before = None
    print(cyan("=" * 64))

    # 2. list_knowledge_bases
    print(cyan("\n[1/4] list_knowledge_bases"))
    status, body = http_json(args.sidecar + "/knowledge_base/list_knowledge_bases")
    kb_names_seen: list[str] = []
    if status == 200:
        try:
            data = json.loads(body)
            kbs = data.get("data") or []
            for kb in kbs:
                kb_names_seen.append(kb.get("kb_name") or "")
            print(f"  sidecar lists {len(kbs)} KBs: {kb_names_seen}")
            if args.kb_name not in kb_names_seen:
                print(red(f"  >>> KB '{args.kb_name}' NOT in list. Use --kb-name <real>."))
        except Exception as e:
            print(red(f"  parse failed: {e!r}"))
            print(f"  raw: {body[:300]}")
    else:
        print(red(f"  status={status} body={body[:300]}"))

    # 3. search_docs direct
    print(cyan("\n[2/4] /knowledge_base/search_docs (direct retrieval)"))
    status, body = http_json(
        args.sidecar + "/knowledge_base/search_docs",
        method="POST",
        body={
            "query": args.query,
            "knowledge_base_name": args.kb_name,
            "top_k": 5,
            "score_threshold": 2.0,
        },
    )
    direct_hits = -1
    if status == 200:
        try:
            arr = json.loads(body)
            direct_hits = len(arr) if isinstance(arr, list) else len(arr.get("data") or arr.get("value") or [])
            if direct_hits > 0:
                print(green(f"  direct search_docs returned {direct_hits} chunks  [OK]"))
            else:
                print(red(f"  direct search_docs returned 0 chunks"))
        except Exception as e:
            print(red(f"  parse failed: {e!r}"))
            print(f"  raw: {body[:300]}")
    else:
        print(red(f"  status={status} body={body[:300]}"))

    # 4. chat /v2/chat
    print(cyan("\n[3/4] /chat/v2/chat (full chat with mode=kb + ku_ids + kb_names + kb_name)"))
    status, body = http_json(
        args.sidecar + "/chat/v2/chat",
        method="POST",
        body={
            "query": args.query,
            "mode": "kb",
            "ku_ids": [f"doc:{args.kb_name}"],
            "kb_names": [args.kb_name],
            "kb_name": args.kb_name,
            "top_k": 5,
            "score_threshold": 2.0,
            "stream": False,
            "history": [],
            "temperature": 0.3,
        },
    )
    chat_sources_count = -1
    chat_chunks_count = -1
    chat_answer = ""
    chat_mode = ""
    if status == 200:
        try:
            j = json.loads(body)
            d = j.get("data") or {}
            chat_mode = d.get("mode") or ""
            chat_sources_count = len(d.get("sources") or [])
            chat_chunks_count = len(d.get("chunks") or [])
            chat_answer = d.get("answer") or ""
            print(f"  resolved_mode  : {chat_mode!r}")
            print(f"  sources count  : {chat_sources_count}")
            print(f"  chunks count   : {chat_chunks_count}")
            print(f"  answer preview : {chat_answer[:200]!r}")
            markers = ["deepseek", "ollama", "sk-", "apikey", "bce-v3", "api key.txt"]
            mentioned = [m for m in markers if m.lower() in chat_answer.lower()]
            if mentioned:
                print(green(f"  >>> answer mentions KB markers {mentioned}  CHAT USED KB [OK]"))
            else:
                print(red(f"  >>> answer mentions NO KB markers  CHAT DID NOT USE KB [FAIL]"))
        except Exception as e:
            print(red(f"  parse failed: {e!r}"))
            print(f"  raw: {body[:500]}")
    else:
        print(red(f"  status={status} body={body[:500]}"))

    # 5. wait then tail-grep log
    print(cyan(f"\n[4/4] scanning log for chat traces (waiting {args.log_wait}s for flush)..."))
    time.sleep(args.log_wait)
    if log_path is None or log_size_before is None:
        print(yellow("  no log file -- skip"))
    else:
        try:
            with open(log_path, "rb") as f:
                f.seek(log_size_before)
                new_bytes = f.read()
            new_text = new_bytes.decode("utf-8", errors="replace")
            print(f"  scanned {len(new_bytes)} new bytes from {log_path.name}")
            patterns = [
                r"_process_one_ku",
                r"_process_ku_safe",
                r"kb handler",
                r"MultiSourceRetriever",
                r"node_retrieve",
                r"HandlerNotFound",
                r"register_handler",
                r"handlers.*注册失败",
                r"search_doc.*fail",
                r"Traceback",
                r"ERROR",
                r"未找到 mode",
                r"embed-probe",
            ]
            rgx = re.compile("|".join(patterns), re.IGNORECASE)
            hits: list[str] = []
            current_traceback: list[str] = []
            in_tb = False
            for line in new_text.splitlines():
                if "Traceback" in line:
                    in_tb = True
                    current_traceback = [line]
                    continue
                if in_tb:
                    current_traceback.append(line)
                    if line and not line[0].isspace() and not line.startswith("  "):
                        # traceback finished by a non-indented line
                        hits.extend(current_traceback)
                        in_tb = False
                        current_traceback = []
                        # also include this terminator line if relevant
                        if rgx.search(line):
                            hits.append(line)
                    continue
                if rgx.search(line):
                    hits.append(line)
            if in_tb and current_traceback:
                hits.extend(current_traceback)
            if hits:
                print(red(f"  >>> {len(hits)} relevant log lines:"))
                for line in hits[-100:]:
                    print(f"    {line}")
            else:
                print(yellow("  no relevant lines matched in this window."))
                print(yellow("  (try increasing --log-wait, or check if sidecar logs to a different location)"))
        except Exception as e:
            print(red(f"  log scan failed: {type(e).__name__}: {e}"))

    # 6. verdict
    print(cyan("\n" + "=" * 64))
    print(cyan("VERDICT"))
    print(cyan("=" * 64))

    if direct_hits > 0 and chat_chunks_count == 0 and chat_sources_count == 0:
        print(red("[FAIL] direct search_docs WORKS but chat retrieve returns NOTHING."))
        print(red("       node_retrieve_async -> KBHandler.retrieve -> MultiSourceRetriever"))
        print(red("       chain is silently producing empty chunks."))
        print(red("       Check the log lines above:"))
        print(red("         - HandlerNotFound -> KBHandler not registered (import failed)"))
        print(red("         - Traceback in _process_one_ku -> some lazy import or call inside"))
        print(red("           _process_one_ku failed (rewriter/fuser/get_service_by_name)"))
        print(red("         - empty log -> chat handler took a short-circuit branch"))
        print(red("           (ku_ids empty? kb_names empty? mode mis-classified?)"))
    elif direct_hits == 0:
        print(red("[FAIL] even direct search_docs returns 0 chunks."))
        print(red("       KB has no data OR retrieval pipeline itself broken."))
        print(red("       Run scripts\\probe-kb-xxx.ps1 for filesystem-level inspection."))
    elif chat_chunks_count > 0:
        print(green("[OK] chat retrieve returned chunks. KB chain works."))
        print(green("     If your app still cannot chat with KB, the bug is in CLIENT"))
        print(green("     (composer.selectedKuIds not set, or buildRequest skips KB fields)."))
    elif chat_answer and any(m in chat_answer.lower() for m in ("deepseek", "ollama", "sk-")):
        print(green("[OK] answer mentions KB content even though sources/chunks count=0."))
        print(green("     (response shape may strip metadata but prompt still inj. KB chunks)"))
    else:
        print(yellow("[?] unknown state -- inspect raw outputs above."))

    return 0


if __name__ == "__main__":
    sys.exit(main())

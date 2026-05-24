"""Real chat probe -- direct urllib POST, no PS / curl quoting traps.

Usage:
    python scripts\probe-chat-real.py
    python scripts\probe-chat-real.py --kb-name xxx --query "your question"

Output: full server JSON written to stdout (UTF-8 safe).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sidecar", default="http://127.0.0.1:62581")
    ap.add_argument("--kb-name", default="xxx")
    ap.add_argument("--query", default="api key.txt is what")
    ap.add_argument("--endpoint", default="/chat/v2/chat",
                    help="/chat/v2/chat or /chat/chat etc.")
    args = ap.parse_args()

    body = {
        "query":           args.query,
        "mode":            "kb",
        "ku_ids":          [f"doc:{args.kb_name}"],
        "kb_names":        [args.kb_name],
        "kb_name":         args.kb_name,
        "top_k":           5,
        "score_threshold": 2.0,
        "stream":          False,
        "history":         [],
        "temperature":     0.3,
    }
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

    url = args.sidecar + args.endpoint
    print(f"POST {url}", file=sys.stderr)
    print(f"body: {json.dumps(body, ensure_ascii=False)}", file=sys.stderr)
    print("-" * 60, file=sys.stderr)

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            status = r.status
            text = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        text = e.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"REQUEST FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        return 2

    print(f"status: {status}", file=sys.stderr)
    print("-" * 60, file=sys.stderr)
    # Try to pretty-print response
    try:
        parsed = json.loads(text)
        # Highlight key fields
        data = parsed.get("data") if isinstance(parsed, dict) else None
        if isinstance(data, dict):
            print("=== KEY FIELDS ===", file=sys.stderr)
            print(f"mode:            {data.get('mode')!r}", file=sys.stderr)
            print(f"sources count:   {len(data.get('sources') or [])}", file=sys.stderr)
            print(f"chunks count:    {len(data.get('chunks') or [])}", file=sys.stderr)
            mounted = data.get("mounted") or {}
            print(f"mounted:         {mounted}", file=sys.stderr)
            ans = data.get("answer") or ""
            preview = ans[:300] + ("..." if len(ans) > 300 else "")
            print(f"answer preview:  {preview}", file=sys.stderr)
            print("=" * 60, file=sys.stderr)
            # Did the LLM mention chunk content?
            markers = ["deepseek", "ollama", "sk-", "apikey", "bce-v3"]
            hits = [m for m in markers if m.lower() in ans.lower()]
            if hits:
                print(f">>> answer mentions KB chunk markers: {hits} <<<", file=sys.stderr)
                print(">>> CHAT IS USING KB CONTENT [OK] <<<", file=sys.stderr)
            else:
                print(">>> answer does NOT reference any KB chunk markers <<<", file=sys.stderr)
                print(">>> CHAT IS NOT USING KB [FAIL] <<<", file=sys.stderr)
        # Full body to stdout
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
    except json.JSONDecodeError:
        print("=== NON-JSON BODY ===", file=sys.stderr)
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

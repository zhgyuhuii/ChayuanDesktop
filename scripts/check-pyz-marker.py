"""Read PyInstaller PYZ archive in an installed bundle and verify whether
the chayuan.server.chat.handlers patch markers actually made it in.

If patch is in: prints OK for every marker.
If patch missing: rebuild/robocopy didn't propagate the change.

Usage:
    python scripts\\check-pyz-marker.py
    python scripts\\check-pyz-marker.py "C:\\Program Files\\chayuan-test\\chayuan-server\\_internal\\PYZ-00.pyz"
"""
from __future__ import annotations

import sys
from pathlib import Path


DEFAULT_PYZ = r"C:\Program Files\chayuan-test\chayuan-server\_internal\PYZ-00.pyz"
DEFAULT_MOD = "chayuan.server.chat.handlers"

MARKERS = [
    "_load_builtins",
    "[_load_builtins] try",
    "[_load_builtins] OK",
    "[_load_builtins] FAIL",
    "sys.stdout.write",        # only in patched version
    "exc_info",                # only in patched version
    "chayuan.chat.handlers",
]


def walk_strings(code, out: list[str]) -> None:
    """Recursively collect all string constants from a code object."""
    try:
        consts = code.co_consts
    except AttributeError:
        return
    for c in consts:
        if isinstance(c, str):
            out.append(c)
        elif hasattr(c, "co_consts"):  # nested code object
            walk_strings(c, out)


def main() -> int:
    pyz = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_PYZ)
    mod = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MOD

    print(f"PYZ : {pyz}")
    print(f"MOD : {mod}")
    print("-" * 60)

    if not pyz.is_file():
        print(f"ERR: PYZ does not exist: {pyz}")
        return 2

    try:
        from PyInstaller.archive.readers import ZlibArchiveReader
    except Exception as e:
        print(f"ERR: can't import PyInstaller ZlibArchiveReader: {e}")
        print("    run via:  poetry run python scripts\\check-pyz-marker.py")
        return 2

    try:
        reader = ZlibArchiveReader(str(pyz))
    except Exception as e:
        print(f"ERR: ZlibArchiveReader open failed: {e}")
        return 2

    # First, list all module names containing 'handlers'
    toc = list(reader.toc)
    print(f"toc total entries: {len(toc)}")
    related = [n for n in toc if "chat" in n and "handlers" in n]
    print(f"chat handlers related modules in PYZ ({len(related)}):")
    for n in sorted(related):
        print(f"  - {n}")
    print("-" * 60)

    if mod not in toc:
        print(f"ERR: requested mod {mod!r} NOT in PYZ toc at all.")
        return 2

    try:
        item = reader.extract(mod)
    except Exception as e:
        print(f"ERR: extract({mod}) failed: {e}")
        return 2

    # PyInstaller returns (typ, contents). For Python modules, contents is a
    # code object (marshal-loaded). Walk co_consts.
    if isinstance(item, tuple) and len(item) == 2:
        typ, code = item
        print(f"extracted typ={typ}, code type={type(code).__name__}")
    else:
        code = item
        print(f"extracted (no typ), type={type(code).__name__}")

    strings: list[str] = []
    if hasattr(code, "co_consts"):
        walk_strings(code, strings)
    else:
        # could be bytes (uncompiled .py)
        try:
            text = code.decode("utf-8", errors="replace") if isinstance(code, bytes) else str(code)
            strings = [text]
            print(f"(treating as raw bytes/text, len={len(text)})")
        except Exception:  # noqa: BLE001
            print(f"ERR: cannot interpret code: {type(code)}")
            return 2

    haystack = "\n".join(strings)
    print("-" * 60)
    print("Marker presence:")
    ok = True
    for m in MARKERS:
        present = m in haystack
        mark = "[OK]  " if present else "[MISS]"
        print(f"  {mark} {m!r}")
        if not present:
            ok = False
    print("-" * 60)
    if ok:
        print(">>> PATCH IS IN THE INSTALLED PYZ.")
        print(">>> If sidecar startup stdout still has no [_load_builtins] line,")
        print(">>> sys.stdout might be redirected, or _load_builtins ran in a")
        print(">>> different process whose stdout is not the one you captured.")
    else:
        print(">>> PATCH NOT FULLY IN INSTALLED PYZ.")
        print(">>> rebuild or robocopy didn't propagate the change.")
        print(">>> Things to try:")
        print(">>>   1. delete chayuan-server/build/ and dist/ then rebuild")
        print(">>>   2. verify dist mtime is fresh, then robocopy /MIR again")
        print(">>>   3. uninstall chayuan-server in venv, then reinstall -e")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

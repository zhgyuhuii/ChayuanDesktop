"""最小 fake openclaw：被 OpenClawAdapter 当作 bin 调用。
支持 v1 子命令并打印契约化输出。用环境变量 FAKE_OPENCLAW_RUNNING 控制运行态。"""
import json
import os
import sys


def main() -> int:
    argv = sys.argv[1:]
    running = os.environ.get("FAKE_OPENCLAW_RUNNING") == "1"
    if argv[:1] == ["--version"]:
        print("openclaw 0.22.0")
        return 0
    if argv[:1] == ["status"] and "--json" in argv:
        print(json.dumps({"running": running, "version": "0.22.0",
                          "pid": 4242 if running else None,
                          "uptimeMs": 60000 if running else 0,
                          "health": "ok" if running else "unknown"}))
        return 0
    if argv[:2] == ["config", "get"]:
        print(json.dumps({"agents": {"defaults": {"model": "local"}}}))
        return 0
    if argv[:2] == ["config", "set"]:
        return 0
    if argv[:1] == ["onboard"]:
        for line in ("resolving install", "downloading", "installed daemon"):
            print(line)
        return 0
    if argv[:2] in (["gateway", "start"], ["gateway", "stop"], ["gateway", "restart"]):
        return 0
    if argv[:1] == ["logs"] and "--follow" in argv:
        for line in ("[info] gateway up", "[info] channel ready"):
            print(line)
        return 0
    if argv[:2] == ["skills", "list"]:
        print(json.dumps([{"slug": "web-search", "name": "Web Search", "version": "1.2",
                           "description": "search web", "requires": ["net"], "verified": True}]))
        return 0
    if argv[:2] == ["skills", "search"]:
        print(json.dumps([{"slug": "todo", "name": "Todo", "version": "0.3",
                           "description": "todo", "requires": [], "verified": False}]))
        return 0
    if argv[:2] in (["skills", "install"], ["skills", "uninstall"]):
        if argv[1] == "install":
            print("downloading"); print("installed")
        return 0
    if argv[:1] == ["uninstall"]:
        return 0
    print(f"unknown args: {argv}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

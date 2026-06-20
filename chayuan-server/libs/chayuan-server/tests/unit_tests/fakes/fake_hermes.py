import json, os, sys

def main() -> int:
    a = sys.argv[1:]
    running = os.environ.get("FAKE_HERMES_RUNNING") == "1"
    if a[:2] == ["gateway", "status"]:
        print("running" if running else "stopped"); return 0
    if a[:1] == ["status"] and "--all" in a:
        print(json.dumps({"version": "1.0.0", "gateway": running})); return 0
    if a[:2] == ["config", "show"]:
        print(json.dumps({"model": {"provider": "custom"}})); return 0
    if a[:2] == ["config", "set"]:
        return 0
    if a[:1] == ["setup"] and "--non-interactive" in a:
        print("setup ok"); print("installed daemon"); return 0
    if a[:2] in (["gateway", "start"], ["gateway", "stop"], ["gateway", "restart"]):
        return 0
    if a[:1] == ["uninstall"]:
        return 0
    if a[:2] == ["skills", "list"]:
        print(json.dumps([{"id": "weather", "name": "Weather", "version": "1.0",
                           "description": "weather tool", "permissions": ["net"], "installed": True}])); return 0
    if a[:2] == ["skills", "search"]:
        print(json.dumps([{"id": "calendar", "name": "Calendar", "version": "2.1",
                           "description": "calendar", "permissions": ["fs"], "installed": False}])); return 0
    if a[:2] in (["skills", "install"], ["skills", "uninstall"]):
        return 0
    print(f"unknown {a}", file=sys.stderr); return 2

if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env bash
# Installs statusline.py as Claude Code's status line (~/.claude/settings.json).
set -euo pipefail
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
src="$(cd "$(dirname "$0")" && pwd)/statusline.py"
mkdir -p "$dir"
cp "$src" "$dir/statusline.py"
settings="$dir/settings.json"
[ -f "$settings" ] && cp "$settings" "$settings.bak"
python3 - "$settings" "$dir/statusline.py" <<'PY'
import json, os, sys
path, script = sys.argv[1], sys.argv[2]
settings = json.load(open(path)) if os.path.exists(path) else {}
settings["statusLine"] = {"type": "command", "command": f"python3 {script}", "refreshInterval": 60}
with open(path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PY
echo "Installed $dir/statusline.py and set statusLine in $settings"

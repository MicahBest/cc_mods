# cc_mods

My [Claude Code](https://claude.com/claude-code) usage line, for both the terminal and the desktop app. It shows context fill and your 5-hour and weekly limit usage, plus reset countdowns.

| Mod | Where | What it does |
| --- | --- | --- |
| [`statusline.py`](statusline.py) | Terminal | A status line script: the grey usage line, then `user@host:cwd`. Installed into `settings.json`. |
| [`usage-line`](plugins/usage-line) | Desktop app | The same grey usage line, drawn above the prompt, without `user@host:cwd`. Draws nothing in the terminal, so it never doubles up with the script. |

Terminal:

```
Context: 21% used (42k/200k)  │  5-hour limit: 38% used, resets in 1h 40m  │  Weekly limit: 12% used, resets in 2d 5h

user@host:/path/to/project
```

Desktop app:

```
Context: 21% used (42k/200k)  │  5-hour limit: 38% used, resets in 1h 40m  │  Weekly limit: 12% used, resets in 2d 5h
```

## Install

### Terminal: statusline.py

You need Python 3.

```
git clone https://github.com/MicahBest/cc_mods.git
./cc_mods/install.sh
```

The script copies `statusline.py` to `~/.claude/` and sets `statusLine` in `~/.claude/settings.json`. It saves the old file as `settings.json.bak` first. Restart Claude Code to see the line.

### Desktop app: usage-line

In the desktop app, click **+** next to the prompt box, choose **Plugins**, then **Add marketplace** with `MicahBest/cc_mods`, then **Add plugin** and pick `usage-line`.

Or type this at the prompt in a Claude Code terminal session. Installed at the user scope, it also loads in the desktop app's sessions:

```
/plugin install usage-line --marketplace MicahBest/cc_mods
```

Answer `y` to add the marketplace, then press Enter to choose the user scope.

## Developing

Load the mod straight from its folder:

```
claude --plugin-dir plugins/usage-line
claude plugin validate plugins/usage-line
```

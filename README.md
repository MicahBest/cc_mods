# cc_mods

My [Claude Code](https://claude.com/claude-code) mods.

| Mod | What it does |
| --- | --- |
| [`usage-status`](plugins/usage-status) | A grey line under the prompt showing context fill plus 5-hour and weekly limit usage, with reset countdowns and an "on pace to max out" warning. Shortens itself on narrow terminals. |
| [`statusline`](statusline) | The same usage figures as a status line script, drawn above `user@host:cwd`. Not a plugin; installed into `settings.json`. |

Use one or the other. If you install both, you'll see the usage line twice.

## Install

### usage-status (plugin)

Type this at the prompt in a Claude Code terminal session:

```
/plugin install usage-status --marketplace MicahBest/cc_mods
```

Answer `y` to add the marketplace, then press Enter to choose the user scope.

From a shell:

```
claude plugin install usage-status --marketplace MicahBest/cc_mods
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, choose **Plugins**, then **Add marketplace** with `MicahBest/cc_mods`, then **Add plugin**.

### statusline (script)

You need Python 3.

```
git clone https://github.com/MicahBest/cc_mods.git
./cc_mods/statusline/install.sh
```

The script copies `statusline.py` to `~/.claude/` and sets `statusLine` in `~/.claude/settings.json`. It saves the old file as `settings.json.bak` first. Restart Claude Code to see the line.

## Developing

Load a mod straight from its folder:

```
claude --plugin-dir plugins/usage-status
claude plugin test plugins/usage-status
```

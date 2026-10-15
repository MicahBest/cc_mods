# cc_mods

My [Claude Code](https://claude.com/claude-code) status line. It shows a grey usage line with context fill and your 5-hour and weekly limit usage, plus reset countdowns. Below that it shows `user@host:cwd`.

```
Context: 21% used (42k/200k)  │  5-hour limit: 38% used, resets in 1h 40m  │  Weekly limit: 12% used, resets in 2d 5h

user@host:/path/to/project
```

## Install

You need Python 3.

```
git clone https://github.com/MicahBest/cc_mods.git
./cc_mods/install.sh
```

The script copies `statusline.py` to `~/.claude/` and sets `statusLine` in `~/.claude/settings.json`. It saves the old file as `settings.json.bak` first. Restart Claude Code to see the line.

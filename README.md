# cc_mods

My [Claude Code](https://claude.com/claude-code) mods: a usage line for the terminal and the desktop app, and a live git changes line.

| Mod | Where | What it does |
| --- | --- | --- |
| [`statusline.py`](statusline.py) | Terminal | A status line script: the grey usage line, then `user@host:cwd`. Installed into `settings.json`. |
| [`usage-line`](plugins/usage-line) | Desktop app | The same grey usage line, drawn above the prompt, without `user@host:cwd`. Draws nothing in the terminal, so it never doubles up with the script. |
| [`git-diff-panel`](plugins/git-diff-panel) | Desktop app and terminal | A line above the prompt: how many files changed this session, the branch, and lines added and deleted. |

## The usage line

Terminal:

```
Context: 21% used (42k/200k)  │  5-hour limit: 38% used, resets in 1h 40m  │  Weekly limit: 12% used, resets in 2d 5h

user@host:/path/to/project
```

Desktop app:

```
Context: 21% used (42k/200k)  │  5-hour limit: 38% used, resets in 1h 40m  │  Weekly limit: 12% used, resets in 2d 5h
```

## The git changes line

One line above the prompt that updates as the agent works:

```
4 files changed on main  +54 −37
```

- It counts what changed since the session started, so you see only what changed while you worked.
- `+54` (green) is lines added and `−37` (red) is lines deleted, across all the changed files.
- New, untracked files count. Files your `.gitignore` excludes don't.
- Outside a git repository it draws nothing.
- With `usage-line` installed too, both lines show, one under the other.

It checks the repository every 4 seconds, and right after each tool call that may write. It uses a private git index of its own (`.git/git-diff-panel.index`), so it never changes your staging area. It does write git objects for the files it looks at, which `git gc` cleans up.

## Install

### Terminal: statusline.py

You need Python 3.

```
git clone https://github.com/MicahBest/cc_mods.git
./cc_mods/install.sh
```

The script copies `statusline.py` to `~/.claude/` and sets `statusLine` in `~/.claude/settings.json`. It saves the old file as `settings.json.bak` first. Restart Claude Code to see the line.

### The mods: usage-line and git-diff-panel

In the desktop app, click **+** next to the prompt box, choose **Plugins**, then **Add marketplace** with `MicahBest/cc_mods`, then **Add plugin** and pick `usage-line` or `git-diff-panel`.

Or type this at the prompt in a Claude Code terminal session. Installed at the user scope, a mod also loads in the desktop app's sessions:

```
/plugin install usage-line --marketplace MicahBest/cc_mods
/plugin install git-diff-panel --marketplace MicahBest/cc_mods
```

Answer `y` to add the marketplace, then press Enter to choose the user scope.

## Developing

Load a mod straight from its folder:

```
claude --plugin-dir plugins/git-diff-panel
claude plugin validate plugins/git-diff-panel
claude plugin test plugins/git-diff-panel
```

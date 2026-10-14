#!/usr/bin/env python3
"""Claude Code status line: grey usage line, a blank line, then user@host:cwd."""
import json
import os
import socket
import sys
import time

GREY, GREEN, BLUE, RESET = "\033[90m", "\033[01;32m", "\033[01;34m", "\033[0m"
WINDOWS = {"five_hour": "5-hour limit", "seven_day": "Weekly limit"}


def duration(seconds):
    minutes = max(0, -(-int(seconds) // 60))
    d, h, m = minutes // 1440, minutes % 1440 // 60, minutes % 60
    return f"{d}d {h}h" if d else f"{h}h {m}m" if h else f"{m}m"


def tokens(n):
    return f"{n / 1e6:.1f}M".replace(".0M", "M") if n >= 1e6 else f"{round(n / 1000)}k"


def context_part(ctx):
    pct = ctx.get("used_percentage")
    if pct is None:
        return "Context: --"
    used, size = ctx.get("total_input_tokens"), ctx.get("context_window_size")
    fill = f" ({tokens(used)}/{tokens(size)})" if used is not None and size else ""
    return f"Context: {round(pct)}% used{fill}"


def limit_part(kind, limits, now):
    label = WINDOWS[kind]
    limit = limits.get(kind) or {}
    pct = limit.get("used_percentage")
    if pct is None:
        return f"{label}: --"
    resets_at = limit.get("resets_at")
    left = None if resets_at is None else resets_at - now
    resets = "" if left is None else f", resets in {duration(left)}"
    if pct >= 100:
        return f"{label}: REACHED{resets}"
    return f"{label}: {round(pct)}% used{resets}"


def main():
    data = json.load(sys.stdin)
    now = time.time()
    limits = data.get("rate_limits") or {}
    usage = "  │  ".join(
        [context_part(data.get("context_window") or {})]
        + [limit_part(kind, limits, now) for kind in WINDOWS]
    )
    user = os.environ.get("USER") or os.getlogin()
    host = socket.gethostname().split(".")[0]
    print(f"{GREY}{usage}{RESET}")
    print(" ")
    print(f"{GREEN}{user}@{host}{RESET}:{BLUE}{data.get('cwd', '')}{RESET}")


if __name__ == "__main__":
    main()

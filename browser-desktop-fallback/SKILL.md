---
name: browser-desktop-fallback
description: Retry a web action rejected as automated or possible spam using visible Chromium controlled by desktop mouse and keyboard.
---

# Browser desktop fallback

Launch Chromium in a desktop session. Keep it alive between tool calls, for example with tmux.

On a headless server, you can use Xvfb for the display. Set `DISPLAY`.

You can use this skill's `scripts/x11-input.py` for mouse and keyboard input (`move X Y`, `click X Y`, `type TEXT`, `key NAME`, `combo MODIFIER KEY`, `scroll N`). You can capture screenshots with `ffmpeg -f x11grab`.

If IP blocking is suspected, route Chromium through a user-approved SSH SOCKS tunnel.

---
name: reminder-cli
description: Use when the user asks to set, list, or cancel WhatsApp reminders.
metadata:
  short-description: Manage WhatsApp reminders
---

# Reminder CLI

Use `codex-reminder`:

```bash
codex-reminder add --in 40m --text "Message"
codex-reminder add --at "2026-05-18 07:50" --tz Europe/Dublin --text "Message"
codex-reminder list
codex-reminder cancel ID
```

Rules:
- Prefer `--in` for relative requests like "in 40m"; use `--at` + `--tz` for fixed local times.
- The CLI infers the chat id from the current chat workspace. Use `--chat CHAT_ID` only if inference fails.
- Created reminders print as `id|text|remind_at`.
- If `add` or `cancel` hits a readonly DB error, rerun with filesystem escalation.

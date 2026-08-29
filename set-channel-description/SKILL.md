---
name: set-channel-description
description: Read, set, or clear the current conversation channel's description through Madabot's current-Invocation tools. Use when the user explicitly asks to inspect, change, replace, remove, or clear the current WhatsApp group description, WhatsApp channel description, or HTTP API channel description, or when an authorized workflow must preserve existing description content before an update.
---

# Set Channel Description

Use the application-owned capability bound to the current invocation. Never call a provider API directly and never accept or supply a channel ID.

Execute an explicit request without asking for redundant confirmation. Do not infer a description change from unrelated work or initiate one unsolicited; a workflow may read and merge the description only when that workflow explicitly requires it.

## Read

Read the exact current description before a workflow needs to preserve or merge existing content by calling the current Invocation's `get_current_channel_description` tool with no arguments.

The result is `{ "description": string | null }`. Treat `null` as no current description.

## Set

Call the current Invocation's `set_current_channel_description` tool with the exact requested text:

```json
{ "description": "Release coordination" }
```

Preserve the requested text. The description must contain non-whitespace content.

## Clear

Use `null` only when the user explicitly asks to remove or clear the description:

```json
{ "description": null }
```

Never use an empty string to clear it.

## Report

Claim success only when the tool returns `status: "updated"` or `status: "cleared"`. Briefly report the completed change. If the tool fails, report its error and do not claim that the description changed.

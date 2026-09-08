---
name: deploy-webpage
description: Use to learn how to put a webpage at a URL the user can open when they ask to publish, deploy, or share it, or when you need to show them an HTML page.
---

# Deploy Webpage

Use this when setting up a project so it is served at a browser-accessible URL.

Create or update `<project>/website.json`.

Single site:

```json
{ "subdomain": "app", "access": { "mode": "tailnet" }, "service": { "command": ["/usr/bin/node", "src/server.js"] } }
```

Multiple sites:

```json
[
  { "subdomain": "app", "access": { "mode": "tailnet" }, "service": { "command": ["/usr/bin/node", "src/server.js"] } },
  { "subdomain": "docs", "access": { "mode": "tailnet" }, "static": { "root": "./docs" } }
]
```

Each site needs one unique `subdomain` and exactly one target: `static.root`,
`proxy.target`, or `service.command`.

Deployments are private by default. Omit `access` or use
`"access": { "mode": "tailnet" }` when only the tailnet/private network should
see it. Use `"access": { "mode": "public" }` only when the user explicitly asks
for a public page. Use `"access": { "mode": "token" }` when the user needs a
clickable external link; get the share URL with `site-manager link
<subdomain-or-host>` and do not store token values in `website.json`.
`access.mode` can also be an array, such as `"access": { "mode": ["tailnet",
"token"] }`, when a site should be reachable both from private source ranges and
through a generated token link. Token access always uses the `token` query
parameter; do not add an `access.query` setting.

For `service`, let the manager assign `PORT` unless the app needs a fixed port.
Set a fixed port with `proxy.target`, `service.environment.PORT`, or both with
the same value.

If the deployed project needs future rebuilds, refreshes, restarts, or server
updates, add a minimal project-local skill. Static-only sites with no build step
do not need one. The skill should run the needed update command, redeploy this
manifest, and check the host.

Deploy and register the manifest:

```sh
site-manager deploy <project>/website.json
curl -I --max-time 15 https://<host>
```

## Publish URLs to the Current Channel

After deployment and URL validation succeed, collect the browser-accessible
URLs for the access modes the user authorized. Include a token/share URL only
when the user explicitly requested token access; anyone who can read the
channel description can use that bearer link.

Run the bundled publisher with each validated URL as a separate argument:

```sh
node <skill-directory>/scripts/publish-channel-urls.mjs <url> [<url> ...]
```

Replace `<skill-directory>` with the directory containing this `SKILL.md`. The
publisher reads the current invocation-bound description, preserves it exactly,
appends only URLs that are not already exact full lines, and calls the setter
only when the description changes. It emits a JSON result with `status`,
`description`, and `added` fields.

If description publication fails, the deployment remains successful. Report
the publication failure without claiming that the description was updated.

Say which path was used, which files changed, the served host/path/port, and
which validation or deploy commands passed. Also say which URLs were added to
the channel description, or that it was already current.

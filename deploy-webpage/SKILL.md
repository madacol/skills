---
name: deploy-webpage
description: Use when the user asks to deploy, publish, expose, or serve a webpage, website, static build, or small web app at a browser URL.
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
{
  "sites": [
    { "subdomain": "app", "access": { "mode": "tailnet" }, "service": { "command": ["/usr/bin/node", "src/server.js"] } },
    { "subdomain": "docs", "access": { "mode": "tailnet" }, "static": { "root": "./docs" } }
  ]
}
```

Each site needs one unique `subdomain` and exactly one target: `static.root`,
`proxy.target`, or `service.command`.

Deployments are private by default. Omit `access` or use
`"access": { "mode": "tailnet" }` when only the tailnet/private network should
see it. Use `"access": { "mode": "public" }` only when the user explicitly asks
for a public page. Use `"access": { "mode": "token", "query": "token" }` when
the user needs a clickable external link; get the share URL with
`site-manager.js link <subdomain-or-host>` and do not store token values in
`website.json`.

For `service`, let the manager assign `PORT` unless the app needs a fixed port.
Set a fixed port with `proxy.target`, `service.environment.PORT`, or both with
the same value.

If the deployed page will need future rebuilds, refreshes, restarts, or server
updates, add a minimal project-local skill for static sites and service sites.
It should run the needed update command, redeploy this manifest, and check the
host.

Deploy and register the manifest:

```sh
node site-manager.js deploy <project>/website.json
curl -I --max-time 15 https://<host>
```

Say which path was used, which files changed, the served host/path/port, and
which validation or deploy commands passed.

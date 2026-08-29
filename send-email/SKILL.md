---
name: send-email
description: Send email using this server's configured babyjarvis.com or madacol.com identities. Use when sending mail or configuring a local sender.
---

# Send Email

- Use `mail` for the simplest submission; `sendmail` and SMTP at
  `127.0.0.1:25` without authentication are also available.
- Set the sender explicitly to an address at `babyjarvis.com` or `madacol.com`.
  SPF and DKIM are configured for both domains.

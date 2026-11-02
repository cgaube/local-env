---
'local-env': patch
---

`setup` trusts the local certificate authority for your user, without sudo. This
works on managed Macs that block the system trust settings. If the CA cannot be
trusted, setup continues and shows the command to run. Restart Firefox if it
warns about a local-env site.

Dockhand now uses port 17300 on your Mac, not 3000. An app on port 3000, such as
Rails or Next.js, no longer stops `local-env start`. If another app uses port
17300, `start` tells you so.

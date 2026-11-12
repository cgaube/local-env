---
'local-env': patch
---

`local-env stop` keeps the `local-env` network. It removed it before, and the
apps that were stopped then could no longer start ("network … not found").
`local-env reset` still removes it.

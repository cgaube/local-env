---
'local-env': patch
---

A variable in a comment of a compose file (`# set ${GREETING:?…}`) is no longer
asked for at deploy, read from the vault or shown on the dashboard card: compose
doesn't read comments either.

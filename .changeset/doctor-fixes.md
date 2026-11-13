---
'local-env': patch
---

`local-env doctor` no longer says a token has expired when it hasn't, and reads
`${VAR:-default}` in mounted paths.

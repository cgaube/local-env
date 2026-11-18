---
'local-env': patch
---

`local-env update` now restarts the dashboard agent when local-env changed, so
the dashboard's Install and Update buttons run the new version without a
`local-env start`.

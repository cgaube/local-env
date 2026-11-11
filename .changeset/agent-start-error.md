---
'local-env': patch
---

When the dashboard agent can't start (its port is taken, or it crashes),
`local-env start` says so at once, with the end of the agent's log, instead of
waiting 10 seconds and pointing to the log.

---
'local-env': minor
---

A source can have a manifest, `local-env.yml` at the root of its repo, with a
unique `name` and a `label`. `local-env sources add` names the source after the
manifest, the same on every Mac, and skips a repo whose name is already added.
`sources list` and the dashboard show the label.

---
'local-env': minor
---

Pull private images from AWS ECR: a registry login with `login: <aws login>`
gets its tokens from your AWS session, and local-env renews them in Dockhand.
`local-env login` replaces `sources login` and fixes every login that does not
work; `local-env logout <source>/<name>` replaces `sources logout`.

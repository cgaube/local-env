---
'local-env': minor
---

Registries of private images move from `docker/registries.json` to the `logins`
of the source manifest (`local-env.yml`), as logins of `type: registry`.
`local-env sources login` and `logout` take `--login <name>`, the name of the
login in the manifest, in place of `--registry <host>`.

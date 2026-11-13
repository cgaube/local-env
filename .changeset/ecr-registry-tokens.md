---
'local-env': minor
---

A registry login can name a login that gets its tokens (`login: acme-dev`): an
`aws` login, to pull from AWS ECR. local-env asks for no token: it gets one with
the AWS session on `start`, `update`, `sources sync`, `deploy` and `install`,
when the one in Dockhand is 6 hours old or more, and saves it in Dockhand.

`local-env login` replaces `local-env sources login`: without a name, it fixes
every login that does not work, in every source (AWS and Vault sessions,
registry logins, ECR tokens). `local-env login acme/ghcr` logs in to one login
again, and `local-env logout acme/ghcr` replaces
`sources logout acme --login ghcr`. Every message names logins as
`<source>/<name>`.

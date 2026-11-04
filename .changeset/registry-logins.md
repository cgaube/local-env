---
'local-env': minor
---

Sources can list the registries of their private images in
`docker/registries.json`. local-env asks for a login for each registry that has
none, and Dockhand uses it to pull the images. New commands:
`local-env sources login` and `local-env sources logout`. Without a name,
`sources login` lists the sources that need a login, and their login.
`local-env sources list` shows whether each source is logged in.
`local-env doctor` tests each login.

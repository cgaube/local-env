# Log in to your accounts

A source can need you to be logged in to some accounts. Its manifest declares
them, and local-env asks you to log in at the right time. Today, these are the
registries of private images (`ghcr.io`) that the templates use: Dockhand keeps
the login and pulls the images.

## See your logins

```sh
local-env sources list
```

Each login of a source has a line: `✔` when you are logged in, `▲` with the
command to run when you are not. `local-env doctor` checks them too.

## Registries

When you add a source with private images, local-env asks for a username and a
token for each registry. `start`, `update` and `sources sync` ask again until
you log in, or pick "Don't ask again". Dockhand tests the login, then keeps it.

```sh
local-env sources login acme                  # every login of the source acme
local-env sources login acme --login ghcr     # only this one
local-env sources logout acme
```

For `ghcr.io`, create a classic personal access token with the `read:packages`
scope only. Do not use the token of `gh auth token`: it can also push code.

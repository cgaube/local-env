# Deploy apps

The Docker templates of your sources are apps that you deploy in Docker: a mail
catcher, a database, a wiki. Deploy them from the dashboard or in a terminal.

## From the dashboard

Open `https://local-env.dev.test/docker`. The page lists the templates of every
source, as cards. Search them, or filter them by source, category and status
(running, stopped or not deployed), as on the Tools page. Each card says what
the deploy needs:

- **Asks for**: values that only you can give (a password for the app). The
  terminal asks for them.
- **From your vault**: secrets that local-env reads from your company's vault
  with your session. You never type them.
- **Private images**: the registry login that the images need.

Click **Deploy**. The terminal opens and runs `local-env deploy` on your Mac. It
asks for the values, logs in to the registry when needed, reads the secrets,
then deploys the app and prints its address. Once its stack is in Dockhand, a
card says **Running**, with a link to the app, or **Stopped** while the app does
not run. Under the cards, **Other apps** lists the apps that no template
deployed: a stack that you made in Dockhand, or a container that you started
with a `VIRTUAL_HOST`.

The dashboard needs `local-env start` to run things on your Mac. Without it, use
the terminal.

## In a terminal

```sh
local-env deploy acme/mail   # <source>/<template>
local-env deploy mail        # the name alone, when only one source has it
local-env deploy             # pick one in a list
```

`--yes` deploys without asking first. A value that only you can give still needs
a terminal.

## After the deploy

- Dockhand, at `https://docker.dev.test`, manages the stack: its logs, its
  containers, its variables. Change the stack there.
- When your team changes the template, `local-env sources sync` (or
  `local-env update`) shows the change and applies it. Your own edits to the
  stack are kept.
- Secrets from the vault are read again before each template change: a rotated
  secret reaches the stack then.
- A template deploys once. To deploy it again, remove its stack in Dockhand
  first.

## Other catalogs

Dockhand's own **Templates** page is hidden: your sources' templates are
deployed from the dashboard, which gives them their secrets and keeps them up to
date. To use other catalogs (Lissy93, a vendor's list), show the page again: in
Dockhand, hover over the version at the bottom of the sidebar, click the pencil,
then the eye of **Templates**. Add the catalog under **Settings → Templates**.
Their stacks get Dockhand's image updates, not template updates.

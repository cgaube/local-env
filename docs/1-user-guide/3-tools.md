# Install tools

A **tool** is something that local-env installs on your Mac itself, not in
Docker: Git, Node.js, a database client, a CLI. Your sources hold the tools. A
**profile** is a set of tools for a job: Backend, Frontend…

## Pick your tools

- On the **Profiles** page of the dashboard, pick the profile of your job. Its
  card shows its tools and the Docker stacks that it needs.
- On the **Tools** page, pick other tools with their switch. The tools of your
  profile are already on.

Picking a tool does not install it. The **Install** button then stands out, with
the count of what the next install does.

## Install them

```sh
local-env install
```

Or click **Install** in the dashboard, which runs the same command in a terminal
on the page.

- When a tool needs sudo, local-env asks for your password first. It never
  writes it to the disk.
- When a tool needs a value from you (an email for git), local-env asks for it
  and keeps it for the next installs.
- When a tool reads a secret from your company's vault, local-env checks that
  you are logged in first: see [Log in to your accounts](4-logins.md).
- When a tool needs a Docker stack (a database, a mail catcher), local-env
  deploys it, after asking once.

Run `local-env install` again at any time. It installs what changed, and the
tools that are already in place do not change.

Other ways to install:

```sh
local-env install backend            # use the profile backend, and install it
local-env install backend --no-save  # install it once, and keep your profile
local-env install --dry-run          # only show what it would install
```

## Variables

The **Variables** button, beside **Install**, opens one form with the values
that your tools take. In a terminal:

```sh
local-env vars                  # the variables of your tools, and their values
local-env vars set git_email me@acme.io
local-env vars unset git_email
```

A new value applies at the next install.

## Remove a tool

local-env never uninstalls. When you unpick a tool, or your source removes it,
it stays on your Mac: remove it yourself if you want it gone. The next install
says which tools are no longer wanted.

---
'local-env': minor
---

Tools can come from Ansible collections: `ansible/<collection>/galaxy.yml` and
its `roles/`. Roles are named `<namespace>.<collection>.<role>` and depend on
each other by that name. `local-env install` gives Ansible every collection of
your sources. The dashboard and the CLI show the `label` of a role's
`local-env.yml`, or else its folder name, title-cased. `local-env install` takes
a profile's short name or full name, and shows it beside the label. Plain roles
in `ansible/<role>/` still work.

`local-env install` with no profile and no picked tools now asks for your
profile in the terminal, and no longer opens the dashboard.

The Tools page of the dashboard shows the Ansible role of each tool, in place of
the date it was installed.

Roles can now use roles from Galaxy collections. Add the collection and a
version range to the `dependencies` of your collection's `galaxy.yml`.
`local-env install` downloads it once, before it runs your tools, and
`local-env update` upgrades it to the newest version that the range allows.
local-env keeps these collections in its own folder and ignores
`~/.ansible/collections`, so every Mac runs the same versions. In the dashboard,
the details of a profile list its Galaxy roles, and mark a role that no source
or collection has as Missing.

The dashboard shows a toast at the top center while tools wait for
`local-env install`, with the command. Its Details button opens the list of
tools and the command to copy. It replaces the Install button of the header.

`local-env install <profile>` asks before it replaces your saved profile.
`--yes` switches without asking.

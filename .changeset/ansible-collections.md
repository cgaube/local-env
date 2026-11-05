---
'local-env': minor
---

Tools can come from Ansible collections: `ansible/<collection>/galaxy.yml` and
its `roles/`. Roles are named `<namespace>.<collection>.<role>` and depend on
each other by that name. `local-env install` gives Ansible every collection of
your sources. The dashboard and the CLI show the `label` of a role's
`local-env.yml`, or else its folder name, title-cased (`git_extras` shows as
`Git Extras`). `local-env install` also takes the label
(`local-env install Backend`). Plain roles in `ansible/<role>/` still work.

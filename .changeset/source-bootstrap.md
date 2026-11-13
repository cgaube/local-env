---
'local-env': minor
---

Sources can list a `bootstrap` in their manifest: roles that make the Mac ready
for their logins (a CLI, an AWS profile, a VPN client). local-env runs them
before the logins: `sources add` asks, `install` and `login` run them first when
they never ran or changed, `onboard` runs them after `start`, then logs in to
every login of the source before the install. `local-env sources bootstrap` runs
them on demand, and `doctor` reports them. A bootstrap role gets no secret,
names no login and needs no stack. `install` also gets a new ECR token after the
playbook, before the stacks deploy. The `--help` text describes local-env as it
is now.

---
'local-env': minor
---

Profiles: a source can group its tools into a profile, an Ansible role tagged
`profile`. Install one with `local-env install <profile>`, which saves it:
later, `local-env install` installs it again with the tools you picked
(`--no-save` installs it once). Pick your profile at the top of the dashboard's
sidebar; its tools are locked on in the Tools page.

A tool can also need Docker stacks (`local-env.yml`). `local-env install`
deploys the missing ones once, linked to their template, after one question
(`--yes` doesn't ask), and asks for the variables they can't start without.
`local-env install` also removes your sudo password when you stop it with
Ctrl-C.

The dashboard uses the sidebar-07 layout: the sidebar collapses to its icons,
and each page has its own header.

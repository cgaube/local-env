---
'local-env': minor
---

Say when a new version of local-env is out: the CLI checks the Homebrew formula
at most once a day, and the dashboard shows it in the version menu.
`local-env update` now installs it first, with Homebrew, then updates the rest
on the new version.

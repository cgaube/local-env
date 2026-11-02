---
'local-env': minor
---

Install tools on your Mac from the Ansible roles of your sources. The
dashboard's Tools page lists every role of every source: pick the ones you want
there, then run `local-env install`, which installs them with Ansible. Its
status filter shows what is installed and what changed since. `local-env setup`
now installs Ansible with the other Homebrew packages.

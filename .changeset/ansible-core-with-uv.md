---
'local-env': patch
---

local-env installs its own Ansible (about 100 MB) instead of Homebrew's
`ansible` (about 600 MB). After `local-env update`, `brew uninstall ansible`
frees the space. A role must list in its `galaxy.yml` every collection it uses
other than `ansible.builtin`.

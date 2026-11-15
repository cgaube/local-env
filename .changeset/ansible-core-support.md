---
'local-env': patch
---

`local-env install` works with `ansible-core`, not only the full `ansible`
package. It draws its output with its own Ansible callback, so it needs no
collection for it.

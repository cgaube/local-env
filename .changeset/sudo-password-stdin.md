---
'local-env': patch
---

`local-env install` gives the sudo password to Ansible on its stdin, so the
password is never written to the disk. A password that starts or ends with a
space now works, and an empty password asks again. When a role needs sudo but
local-env did not ask for the password, the install names the role.

---
'local-env': patch
---

Refuse source and template names that point outside the local-env folder, such
as `../` or an absolute path.

---
'local-env': patch
---

When `local-env setup` trusts the local certificate authority, it says to
restart Firefox if it is open: Firefox reads the trusted certificates when it
starts, and shows a warning for local-env sites until then.

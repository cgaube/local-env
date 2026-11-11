---
'local-env': minor
---

Deploy the Docker templates of your sources from the dashboard's Docker page, or
with `local-env deploy`. A deploy asks for the values only you can give, and
reads secrets from AWS Secrets Manager or HashiCorp Vault (the source's manifest
maps a compose variable to a secret). Dockhand's Templates page is hidden, and
your sources are no longer listed there. A template card and `local-env deploy`
say when Dockhand would show a secret in clear in its pages.

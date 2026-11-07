---
'local-env': minor
---

Tools can take variables, which their role declares in
`meta/argument_specs.yml`. Set them in the dashboard (Variables, beside Install)
or with `local-env vars set`, and `local-env install` asks for a required one
that has no value. A value that your profile sets wins. Secrets (`no_log`) are
not supported yet.

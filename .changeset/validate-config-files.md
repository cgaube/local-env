---
'local-env': patch
---

Check `config.json` and `template-links.json` when they are read. An invalid
domain or build port now stops with an error that names the file and the
`local-env config set` command that fixes it. An invalid link is ignored with a
warning, and the next sync links that stack again.

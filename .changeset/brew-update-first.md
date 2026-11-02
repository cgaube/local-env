---
'local-env': patch
---

`local-env update` runs `brew update` before `brew upgrade local-env`, so
Homebrew sees the new version. When Homebrew installs no new version, `update`
tells you.

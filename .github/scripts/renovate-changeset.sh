#!/bin/sh
# Writes a patch changeset for a Renovate branch, named after it
# (renovate/all: .changeset/renovate-all.md). Renovate runs it in the branch
# (postUpgradeTasks in .github/renovate.json5) and commits the file with the
# updates.
set -eu

name=$(printf '%s' "$1" | tr -c 'a-zA-Z0-9-' '-')

cat > ".changeset/$name.md" << 'EOF'
---
'local-env': patch
---

Update dependencies.
EOF

# Rulesets

The rules GitHub enforces on this repo, as the REST API defines them. GitHub
doesn't read this folder: a file here is a record, applied by hand (see Apply).
Change a ruleset here first, then apply it, so the file and GitHub stay the
same.

On a private repo, GitHub enforces rulesets only with a paid plan: without one,
create them in the browser and they apply once the repo is public. The API
refuses to create them on such a repo (HTTP 403).

## main.json: Protect main

Ruleset `26280399`: https://github.com/cgaube/local-env/settings/rules/26280399

On the default branch:

- Changes arrive through pull requests only, squash merged, with one approval.
- The CI job `check` must pass (`integration_id` 15368 is GitHub Actions, so
  only a workflow can report it).
- No force push, no deletion, linear history.
- Admins (`actor_id` 5, the Admin role) can bypass these rules when merging a
  pull request, never to push to `main` directly. The owner merges their own
  pull requests this way, since nobody can approve their own:
  `gh pr merge <number> --squash --admin`, or "bypass rules" in the browser.

The release workflow needs no exception: it pushes the `changeset-release/main`
branch and tags, never `main`.

## Apply

Create the ruleset once, in the browser (Settings → Rules → Rulesets → New
ruleset → Import a ruleset, then pick the file), or with the API:

```sh
gh api -X POST repos/cgaube/local-env/rulesets --input .github/rulesets/main.json
```

After a change to the file, update it by ID:

```sh
gh api repos/cgaube/local-env/rulesets --jq '.[] | "\(.id) \(.name)"'
gh api -X PUT repos/cgaube/local-env/rulesets/<id> --input .github/rulesets/main.json
```

A ruleset changed in the browser (Settings → Rules → Rulesets) can be exported
as JSON from its **⋯** menu: replace the file with the export.

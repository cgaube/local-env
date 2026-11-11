# Write tools and profiles

A tool is something installed on the Mac itself, not in Docker: Git, Node.js, a
CLI. Each tool is a plain Ansible role, and a tool in the dashboard's catalog
(`https://local-env.dev.test/tools`). People pick the ones they want there, then
run `local-env install`, which runs the picked roles on their Mac with
`ansible-playbook` (`connection: local`, as them).

Group the roles in Ansible collections: one folder of `ansible/` per collection,
with a `galaxy.yml` and its roles in `roles/`. The full name of a role is
`<namespace>.<collection>.<role>`.

```
ansible/dev_tools/
├── galaxy.yml            # namespace: acme, name: dev_tools
├── meta/runtime.yml      # requires_ansible
└── roles/git/
    ├── meta/main.yml     # the catalog's description and tags
    └── tasks/main.yml    # what installing does
```

```yaml
# ansible/dev_tools/galaxy.yml
namespace: acme
name: dev_tools
version: 1.0.0
authors: [Acme]
readme: README.md
```

```yaml
# ansible/dev_tools/roles/git/meta/main.yml
galaxy_info:
  description: Git, the version control system, from Homebrew
  galaxy_tags: [vcs]
dependencies: []
```

```yaml
# ansible/dev_tools/roles/git/tasks/main.yml
- name: Install git
  community.general.homebrew:
    name: git
    state: present
```

- Ansible allows only lowercase letters, digits and `_` in the namespace, the
  collection and the role: `git_extras`, not `git-extras`. A collection whose
  `galaxy.yml` has no valid `namespace` and `name` is not listed.
- The catalog shows the `label` of the role's `local-env.yml` (see below), or
  else its folder name, title-cased (`git_extras` shows as `Git Extras`),
  `galaxy_info.description` and `galaxy_tags`. A role without `meta/main.yml` is
  listed too, with no description.
- A folder of `ansible/` without `galaxy.yml` is a plain role, named by its
  folder (`ansible/git/`). It still works, but a collection is better: its roles
  have names that don't clash with the roles of other sources, and the
  collection installs without local-env
  (`ansible-galaxy collection install "git+<repo>#/ansible/<collection>"`).
- Write tasks that can run again: `local-env install` runs every picked tool
  each time, and Ansible only changes what isn't in the expected state.
- A task with `become: true` runs with sudo: `local-env install` then asks for
  the password first, and the catalog says so.
- `dependencies` name other roles, in any source, by their full name
  (`acme.dev_tools.git`). A role of the same collection can also be named by its
  short name (`git`). A role made of other roles can stand for a whole setup (a
  backend engineer's tools).
- A role can also depend on a role of a Galaxy collection
  (`geerlingguy.mac.dock`). Its collection then lists that collection in the
  `dependencies` of its `galaxy.yml`, with a version range:

  ```yaml
  # ansible/profiles/galaxy.yml
  namespace: acme
  name: profiles
  dependencies:
    geerlingguy.mac: '>=5.0.0,<6.0.0'
  ```

  `local-env install` installs the Galaxy collections of the roles it runs
  before the playbook, into `volumes/tools/collections/` in the home folder. It
  downloads each collection once: `local-env update` gets the latest version
  that the ranges allow, which the next `local-env install` applies. The
  dashboard lists a Galaxy role in the profile's details with a **Galaxy**
  badge, and a role that no source and no `galaxy.yml` has as **Missing**.

- Don't list the collections of your sources in the `dependencies` of
  `galaxy.yml`. local-env leaves them out, but `ansible-galaxy` outside
  local-env looks for them on Galaxy and fails. Role dependencies are enough.
- When a role's files change, the dashboard shows its tool as **Update
  available** until the next `local-env install`.
- Unpicking a tool doesn't uninstall it: local-env only adds. The next
  `local-env install` forgets it, and the dashboard no longer lists it as
  installed.

To try a role, commit it, run `local-env sources sync`, pick it in the catalog
and run `local-env install`.

### Profiles

A profile is a whole setup, picked at once: a role tagged `profile`, made of
other roles. It can include other profiles.

```yaml
# ansible/profiles/roles/backend/meta/main.yml
galaxy_info:
  description: Backend developer setup
  galaxy_tags: [profile]
dependencies:
  - acme.profiles.base # another profile
  - acme.databases.tableplus
  - acme.editors.jetbrains_toolbox
```

- People pick their profile on the dashboard's Profiles page, or with
  `local-env install backend`, which saves it. The command takes the role's
  short name (`backend`) or its full name (`acme.profiles.backend`), not its
  label: a label is for reading, and can be a sentence. The page lists every
  profile with its tools and stacks, and the sidebar shows the current one.
  Later, `local-env install` installs it again with the tools they picked.
  `local-env install backend --no-save` installs it once.
- The roles of the profile are locked on in the catalog. Profiles are not rows
  of the catalog.
- When two collections have a profile with the same short name, people type its
  full name: `local-env install acme.profiles.backend`. For plain roles of the
  same name in two sources, they type `local-env install <source>/backend`.
- A profile can have tasks of its own. Most only have dependencies.

### The name to show, and the stacks a tool needs

`local-env.yml`, next to `meta/`, holds what local-env reads of a role. Ansible
doesn't read this file. Its `label` is the name the dashboard and the CLI show,
in place of the folder name: `Backend`, not `backend`.

A role, or a profile, can need Docker stacks: Mailpit for the apps it installs,
a database for its client. List them in `stacks`.

```yaml
# ansible/profiles/roles/backend/local-env.yml
label: Backend
stacks:
  - mailpit # docker/mailpit of this source
  - shared/postgres # docker/postgres of the source whose manifest name is shared
```

- `local-env install` deploys the stacks of every tool it installs, profiles and
  their dependencies included, after asking once. `--yes` doesn't ask.
- Each stack is deployed once, from its stack template (`"type": 3`), and linked
  to it: it gets template updates like a stack deployed from the dashboard. A
  stack the user removes stays removed.
- A stack of the same name that is already deployed is left as it is.
- A variable without a default (`${NGROK_AUTHTOKEN:?Your ngrok token}`) is asked
  for first. The text after `?` is shown with the question. A name with `TOKEN`,
  `SECRET`, `PASSWORD` or `KEY` is typed masked, and Dockhand keeps it as a
  secret. Without a terminal, the stack isn't deployed.
- The catalog says which stacks a tool needs. The dashboard doesn't deploy them:
  `local-env install` does.

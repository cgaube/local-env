# Tool variables

A role can need values from the user: an email for git, a choice of editor.
Declare them in `meta/argument_specs.yml`, the standard file of Ansible. Ansible
checks the values before the role runs. A missing required value or a value of
the wrong type stops the role with a clear message. Galaxy roles use the same
file, so the file is not specific to local-env.

```yaml
# ansible/dev_tools/roles/git/meta/argument_specs.yml
argument_specs:
  main:
    options:
      git_email:
        type: str
        required: true
        description: The email of your commits
      git_editor:
        type: str
        choices: [vim, nano, code]
        default: vim
        description: The editor that git opens
      git_sign_commits:
        type: bool
        default: false
        description: Sign your commits with your SSH key
```

```yaml
# ansible/dev_tools/roles/git/defaults/main.yml
git_editor: vim
git_sign_commits: false
```

- local-env reads only the entry point `main`. For each option, it reads `type`,
  `required`, `default`, `choices`, `description` and `no_log`. Without this
  file, local-env reads `argument_specs` in `meta/main.yml`, as Ansible does.
- Ansible does not apply the `default` of the spec. Put the same value in
  `defaults/main.yml`. The dashboard shows the default as the placeholder of the
  field. local-env does not ask for an input with a default, in the spec or in
  `defaults/main.yml`.
- A profile can give a value to one of its tools with `vars:` in its
  `dependencies`. local-env then does not ask for it, and does not replace it
  with a saved value. The sheet of the profile shows it disabled, with this
  value:

  ```yaml
  # ansible/profiles/roles/backend/meta/main.yml
  dependencies:
    - role: acme.dev_tools.git
      vars:
        git_editor: code
  ```

- Ansible's extra vars are global. A value is per variable name, and all the
  roles that declare this name get the same value. Give each variable the prefix
  of its role (`git_email`, not `email`), unless the roles must share it.
- The **Variables** button of the Tools and Profiles pages opens one form with
  the inputs of all the tools that the next install runs, one field for each
  variable. A field says which roles use it, and when two roles declare it
  differently. An option with `choices` gets a select. A `bool` gets a switch.
  An `int` or a `float` gets a number field. All other types get a text field.
  For a `list`, the user separates the items with commas, and local-env saves a
  list. For a `dict`, the user types a JSON object. A value stays saved when the
  user unpicks the tool: the **Saved** tab lists it.
- In a terminal, `local-env vars` lists the variables of the user's tools.
  `local-env vars set <name> <value>` saves a value, or asks for it, with the
  same checks as the form, and `local-env vars unset <name>` removes it.
- The dashboard saves the values in `volumes/tools/variables.json`.
  `local-env install` gives Ansible only the values of the inputs that the
  wanted roles declare (`--extra-vars`).
- If a required input has no value and no default, `local-env install` asks for
  it in the terminal and saves the answer. Without a terminal, the install stops
  before Ansible and names the inputs.
- local-env never shows, asks for or saves an option with `no_log: true`. If a
  wanted role requires one without a default, `local-env install` stops and
  names it (see below).
- When a value changes, the dashboard shows the roles that use it as **Update
  available**. A change of `argument_specs.yml` is a new revision of the role.

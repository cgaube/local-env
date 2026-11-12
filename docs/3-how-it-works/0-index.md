# How local-env works

One page for each feature of local-env. Each page tells what the feature does,
how it works, and why it works that way. These pages are for the people who
change local-env. The guides for users and source authors are the other sections
of this site.

| Feature                                     | What it does                                                       |
| ------------------------------------------- | ------------------------------------------------------------------ |
| [Tools and profiles](tools-and-profiles.md) | Installs the Ansible roles of the sources on the Mac, by profile   |
| [Docker catalog](docker-catalog.md)         | Deploys the sources' Docker templates from the dashboard           |
| [Dashboard terminal](dashboard-terminal.md) | Runs `local-env install`, `update` and `deploy` from the dashboard |
| [Source manifest](source-manifest.md)       | `local-env.yml` at a source's root: its name, label and logins     |
| [Logins](logins.md)                         | Registries and secret managers that the sources need               |
| [Wildcard DNS](wildcard-dns.md)             | Points every name of the domain to the Mac, with dnsmasq           |

## Write a feature page

Every new feature gets a file in `docs/3-how-it-works/`, in the same pull
request as its code. A change to how a feature works updates its file.

Use these sections, in this order:

1. **What it does**: the feature as the user sees it. Give the commands, the
   dashboard pages and the files that the user touches.
2. **How it works**: one or more [Mermaid](https://mermaid.js.org) diagrams,
   then the text that the diagrams cannot show. Name the files of the code
   (`apps/cli/src/core/tools.ts`), so that a reader can find them.
3. **Why**: the decisions, and the options that we did not take. Give the reason
   for each. This is the section that a new reader cannot get from the code.
4. **Limits**: what the feature does not do, on purpose or not yet.

Rules for the diagrams:

- Use the diagram type that fits the question. A `flowchart` shows the decisions
  of a command. A `sequenceDiagram` shows the calls between the CLI, the
  containers and the files. An `erDiagram` or a `flowchart` shows how the files
  point to each other.
- Name the nodes with the real names: the command, the file, the service.
- Keep each diagram to one question. Two small diagrams are better than one
  large diagram.

Write in simple English: short sentences, one fact for each sentence, the same
word for the same thing in all the files.

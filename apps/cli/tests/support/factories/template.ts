// A Portainer stack template (type 3) and its compose file, as a source holds
// them: an entry in docker/templates.json, the file in docker/<folder>/
export type TemplateFixture = {
  folder: string
  entry: Record<string, unknown>
  compose: string
}

export const buildCompose = ({
  name = 'hello',
  image = 'nginx:alpine',
  virtualHost = name,
}: { name?: string; image?: string; virtualHost?: string } = {}) =>
  [
    `name: ${name}`,
    'services:',
    `  ${name}:`,
    `    image: ${image}`,
    '    environment:',
    `      VIRTUAL_HOST: ${virtualHost}`,
    '',
  ].join('\n')

export const buildTemplate = ({
  folder = 'hello',
  title = folder,
  compose = buildCompose({ name: folder }),
}: {
  folder?: string
  title?: string
  compose?: string
} = {}): TemplateFixture => ({
  folder,
  compose,
  entry: {
    type: 3,
    title,
    description: `${title} template`,
    repository: { url: '', stackfile: `docker/${folder}/compose.yaml` },
  },
})

// A container template (type 1): Dockhand generates its compose file
export const buildContainerTemplate = ({
  title = 'whoami',
  image = 'traefik/whoami:latest',
}: { title?: string; image?: string } = {}) => ({
  type: 1,
  title,
  image,
})

import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  appUrls,
  composeVariables,
  listTemplates,
  requiredVariables,
  unmaskedSecrets,
} from '#services/dashboard/templates.js'

describe('the variables of a compose file', () => {
  test('finds every form, once each', () => {
    expect(
      composeVariables(
        [
          'services:',
          '  app:',
          '    environment:',
          '      A: ${DB_PASSWORD}',
          '      B: ${API_KEY:-none}',
          '      C: ${TOKEN:?the token} and $BARE',
          '      D: ${DB_PASSWORD}',
          '',
        ].join('\n'),
      ),
    ).toEqual(['DB_PASSWORD', 'API_KEY', 'TOKEN', 'BARE'])
  })

  test('leaves out $$, which compose writes as a $', () => {
    expect(composeVariables('command: echo $$HOME ${REAL}')).toEqual(['REAL'])
  })

  test('the required ones are those without a default, with their help', () => {
    expect(
      requiredVariables(
        ['a: ${A:?the A}', 'b: ${B?}', 'c: ${C:-x}', 'd: ${A:?again}'].join(
          '\n',
        ),
      ),
    ).toEqual([
      { key: 'A', help: 'the A' },
      { key: 'B', help: '' },
    ])
  })

  test('skips the comments, which compose does not interpolate', () => {
    const compose = [
      '# set ${GREETING:?the text} in Dockhand',
      'services:',
      '  app:',
      '    image: nginx # ${TAG:-latest} is moving',
      "    command: ['-text=${TEXT:?the text}'] #${AFTER_FLOW}",
      '    labels:',
      "      - 'note=a # in quotes ${QUOTED}'",
      '      - "it\\"s # ${ESCAPED}"',
      '      - see#${NO_SPACE}',
      '',
    ].join('\n')
    expect(composeVariables(compose)).toEqual([
      'TEXT',
      'QUOTED',
      'ESCAPED',
      'NO_SPACE',
    ])
    expect(requiredVariables(compose)).toEqual([
      { key: 'TEXT', help: 'the text' },
    ])
  })

  test('finds none in a file that is not valid YAML', () => {
    expect(composeVariables('a: ${A}\n  - b: ${B}')).toEqual([])
  })

  test('reads a block scalar as text, comments included', () => {
    const compose = [
      'services:',
      '  app:',
      '    command: |',
      '      # echo ${IN_BLOCK:?read}',
      '      run',
      '    # ${AFTER_BLOCK:?skipped}',
      '    environment:',
      '      - A=${A}',
      '',
    ].join('\n')
    expect(requiredVariables(compose)).toEqual([
      { key: 'IN_BLOCK', help: 'read' },
    ])
    expect(composeVariables(compose)).toEqual(['IN_BLOCK', 'A'])
  })
})

// A sources folder with these files, by path
const sourcesWith = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'local-env-templates-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const list = (templates: unknown[]) =>
  JSON.stringify({ version: '3', templates })

const stack = (stackfile: string, extra: Record<string, unknown> = {}) => ({
  type: 3,
  title: 'Mail',
  repository: { url: 'https://example.com/acme', stackfile },
  ...extra,
})

describe('appUrls', () => {
  test('gives a short host the domain, a full one as is', () => {
    expect(appUrls(['mail', 'mail.acme.example'], 'dev.test')).toEqual([
      'https://mail.dev.test',
      'https://mail.acme.example',
    ])
  })
})

describe('unmaskedSecrets', () => {
  const unmasked = (...lines: string[]) =>
    unmaskedSecrets(lines.join('\n'), ['SMTP_PASSWORD', 'API_TOKEN'])

  test('hides a container variable named like the secret', () => {
    expect(unmasked('      SMTP_PASSWORD: ${SMTP_PASSWORD:?help}')).toEqual([])
    expect(unmasked("      'SMTP_PASSWORD': $SMTP_PASSWORD")).toEqual([])
    expect(unmasked('      - SMTP_PASSWORD=$SMTP_PASSWORD')).toEqual([])
  })

  test('hides one that the list form maps to a secret', () => {
    expect(unmasked('      - SMTP_PASS=${SMTP_PASSWORD}')).toEqual([])
  })

  test('shows a secret under another name, in a command or in a label', () => {
    expect(
      unmasked(
        '    environment:',
        '      SMTP_PASS: ${SMTP_PASSWORD}',
        "    command: ['curl', '-H', 'Authorization: ${API_TOKEN}']",
      ),
    ).toEqual(['SMTP_PASSWORD', 'API_TOKEN'])
    // Dockhand maps only the braced form
    expect(unmasked('      - SMTP_PASS=$SMTP_PASSWORD')).toEqual([
      'SMTP_PASSWORD',
    ])
  })

  test('skips comments and the variables that are not secrets', () => {
    expect(
      unmasked('# read $SMTP_PASSWORD in the container', '      TZ: ${TZ}'),
    ).toEqual([])
  })
})

describe('listTemplates', () => {
  test('lists the stack templates of every source, with what a deploy needs', () => {
    const dir = sourcesWith({
      'acme/local-env.yml': [
        'name: acme',
        'logins:',
        '  ghcr: { type: registry, host: ghcr.io }',
        '  quay: { type: registry, host: quay.io }',
        'secrets:',
        '  SMTP_PASSWORD: { login: acme-dev, ref: mail/dev }',
        '',
      ].join('\n'),
      'acme/docker/templates.json': list([
        stack('docker/mail/compose.yaml', {
          description: 'Catches emails',
          logo: 'https://example.com/mail.png',
          categories: ['mail', 'dev'],
        }),
        // Not templates here: a container, outside docker/, no compose file
        { type: 1, title: 'Container', image: 'nginx' },
        stack('elsewhere/x/compose.yaml'),
        stack('docker/missing/compose.yaml'),
      ]),
      'acme/docker/mail/compose.yaml': [
        'name: mailpit',
        'services:',
        '  mail:',
        '    image: ghcr.io/acme/mailpit:latest',
        '    environment:',
        '      VIRTUAL_HOST: mail, Mail.acme.example',
        '      MP_UI_AUTH: admin:${ADMIN_PASSWORD:?a password for the web UI}',
        '      MP_SMTP_AUTH: user:${SMTP_PASSWORD:?the SMTP password}',
        '      TZ: ${TZ:-UTC}',
        '',
      ].join('\n'),
      'other/docker/templates.json': list([
        stack('docker/wiki/compose.yaml', { title: 'Wiki' }),
      ]),
      'other/docker/wiki/compose.yml': [
        'services:',
        '  wiki:',
        '    image: wiki:latest',
        '    environment: [VIRTUAL_HOST=wiki, OTHER=x]',
        '  db:',
        '    image: postgres',
        '    environment:',
        '      VIRTUAL_HOST: ${DB_HOST}',
        '',
      ].join('\n'),
    })

    expect(listTemplates(dir)).toEqual([
      {
        id: 'acme/mail',
        source: 'acme',
        folder: 'mail',
        title: 'Mail',
        description: 'Catches emails',
        logo: 'https://example.com/mail.png',
        categories: ['mail', 'dev'],
        name: 'mailpit',
        variables: [
          { key: 'ADMIN_PASSWORD', help: 'a password for the web UI' },
        ],
        secrets: ['SMTP_PASSWORD'],
        // In MP_SMTP_AUTH: Dockhand shows it
        unmasked: ['SMTP_PASSWORD'],
        registries: ['ghcr.io'],
        hosts: ['mail', 'mail.acme.example'],
      },
      {
        id: 'other/wiki',
        source: 'other',
        folder: 'wiki',
        title: 'Wiki',
        description: '',
        logo: null,
        categories: [],
        name: 'wiki',
        variables: [],
        secrets: [],
        unmasked: [],
        registries: [],
        hosts: ['wiki'],
      },
    ])
  })

  test('is empty without sources', () => {
    expect(listTemplates(join(tmpdir(), 'local-env-no-such-dir'))).toEqual([])
  })
})

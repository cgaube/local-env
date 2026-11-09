import { buildWiki, pageSlug, sectionTitle } from '#scripts/wiki.js'

// .github/scripts/wiki.ts: docs/wiki to the pages of the GitHub wiki
const OPTIONS = {
  root: 'docs/wiki',
  blobUrl: 'https://github.com/acme/local-env/blob/main',
  exists: (path: string) => ['apps/cli/src/main.ts', 'schemas'].includes(path),
}

const FILES = {
  'Home.md': '# local-env\n\nStart with [Install](1-use/1-install.md).\n',
  '1-use/1-install.md': [
    '# Install local-env',
    '',
    'See [secrets](../2-write-a-source/secrets.md#aws), the',
    '[CLI](../../../apps/cli/src/main.ts) and [the web](https://x.test).',
    '',
    '```md',
    '[not a link](nope.md)',
    '```',
    'And `[code](nope.md)` too.',
    '',
  ].join('\n'),
  '2-write-a-source/secrets.md': '# Tool secrets\n\nText.\n',
}

describe('buildWiki', () => {
  test('names each page by its title, and links the pages', () => {
    const pages = buildWiki(FILES, OPTIONS)

    expect(Object.keys(pages).sort()).toEqual([
      'Home.md',
      'Install-local-env.md',
      'Tool-secrets.md',
      '_Footer.md',
      '_Sidebar.md',
    ])
    expect(pages['Home.md']).toBe('Start with [Install](Install-local-env).\n')
    expect(pages['Install-local-env.md']).toBe(
      [
        'See [secrets](Tool-secrets#aws), the',
        '[CLI](https://github.com/acme/local-env/blob/main/apps/cli/src/main.ts) and [the web](https://x.test).',
        '',
        '```md',
        '[not a link](nope.md)',
        '```',
        'And `[code](nope.md)` too.',
        '',
      ].join('\n'),
    )
  })

  test('lists the sections in the sidebar, in the order of the folders', () => {
    expect(buildWiki(FILES, OPTIONS)['_Sidebar.md']).toBe(
      [
        '[Home](Home)',
        '',
        '**Use**',
        '',
        '- [Install local-env](Install-local-env)',
        '',
        '**Write a source**',
        '',
        '- [Tool secrets](Tool-secrets)',
        '',
      ].join('\n'),
    )
  })

  test('lists every problem at once', () => {
    const build = () =>
      buildWiki(
        {
          'a/one.md': '# Same\n[x](missing.md)\n',
          'b/two.md': '# Same\n',
          'c/three.md': 'no title\n',
        },
        OPTIONS,
      )

    expect(build).toThrow(
      'docs/wiki/a/one.md: the link to missing.md goes nowhere',
    )
    expect(build).toThrow(
      'docs/wiki/b/two.md and docs/wiki/a/one.md are both "Same"',
    )
    expect(build).toThrow('docs/wiki/c/three.md: no "# " title')
    expect(build).toThrow('docs/wiki/Home.md is missing')
  })
})

describe('the names', () => {
  test.each([
    ['2-write-a-source', 'Write a source'],
    ['how-it-works', 'How it works'],
  ])('section %p is %p', (folder, title) => {
    expect(sectionTitle(folder)).toBe(title)
  })

  test('a page name turns its spaces into dashes, as GitHub does', () => {
    expect(pageSlug('Tool secrets')).toBe('Tool-secrets')
  })
})

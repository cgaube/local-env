import {
  buildSidebar,
  pageLink,
  pagePath,
  sectionTitle,
  stripOrder,
} from '#docs/sidebar.js'

// docs/.vitepress/sidebar.ts: the files of docs/ to the pages of the site

describe('the docs site', () => {
  test('names a section after its folder, without the number', () => {
    expect(sectionTitle('2-write-a-source')).toBe('Write a source')
    expect(sectionTitle('faq')).toBe('Faq')
  })

  test('drops the numbers from the URLs', () => {
    expect(pagePath('1-user-guide/1-install.md')).toBe('user-guide/install.md')
    expect(pageLink('1-user-guide/1-install.md')).toBe('/user-guide/install')
    expect(pageLink('3-how-it-works/0-index.md')).toBe('/how-it-works/')
    expect(pageLink('index.md')).toBe('/')
  })

  test('drops the numbers from the links between pages, and only there', () => {
    expect(
      stripOrder('../2-write-a-source/1-source-repo.md#the-manifest'),
    ).toBe('../write-a-source/source-repo.md#the-manifest')
    expect(stripOrder('4-logins.md')).toBe('logins.md')
    expect(stripOrder('https://example.com/1-a.md')).toBe(
      'https://example.com/1-a.md',
    )
    expect(stripOrder('#2-steps')).toBe('#2-steps')
    expect(stripOrder('../../schemas/source-manifest.json')).toBe(
      '../../schemas/source-manifest.json',
    )
  })

  test('lists the sections and their pages in the order of the numbers', () => {
    const sidebar = buildSidebar({
      'index.md': '# local-env\n',
      '2-write-a-source/1-source-repo.md': '# Create a source\n',
      '1-user-guide/2-everyday.md': 'intro\n\n# Everyday use\n',
      '1-user-guide/1-install.md': '# Install local-env\n',
      '1-user-guide/notes.txt': 'not a page',
      '1-user-guide/untitled.md': 'no title',
    })

    expect(sidebar).toEqual([
      {
        text: 'User guide',
        items: [
          { text: 'Install local-env', link: '/user-guide/install' },
          { text: 'Everyday use', link: '/user-guide/everyday' },
          { text: 'user-guide/untitled.md', link: '/user-guide/untitled' },
        ],
      },
      {
        text: 'Write a source',
        items: [
          { text: 'Create a source', link: '/write-a-source/source-repo' },
        ],
      },
    ])
  })
})

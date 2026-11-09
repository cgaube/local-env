import {
  sourceNameFromUrl,
  summarizeSourceContent,
} from '#cli/sources/sources.js'

describe('sourceNameFromUrl', () => {
  test.each([
    ['git@github.com:acme/local-env-templates.git', 'local-env-templates'],
    ['https://github.com/acme/Templates/', 'templates'],
    ['~/dev/my_templates', 'my-templates'],
    ['./templates.git', 'templates'],
  ])('%p -> %p', (url, expected) => {
    expect(sourceNameFromUrl(url)).toBe(expected)
  })
})

describe('summarizeSourceContent', () => {
  test('counts stack and container templates together', () => {
    expect(
      summarizeSourceContent({
        docker: ['mail', 'db'],
        containers: ['whoami'],
        ansible: ['php'],
      }),
    ).toBe('3 docker templates, 1 ansible role')
  })

  test('uses the singular for one item', () => {
    expect(
      summarizeSourceContent({ docker: ['mail'], containers: [], ansible: [] }),
    ).toBe('1 docker template')
  })

  test('says when a source is empty', () => {
    expect(
      summarizeSourceContent({ docker: [], containers: [], ansible: [] }),
    ).toBe('empty')
  })
})

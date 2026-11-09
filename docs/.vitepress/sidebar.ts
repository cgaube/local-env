// docs/ to the pages of the site. A number before a dash orders the folders
// and the files, and leaves the URL: 1-user-guide/1-install.md is
// /user-guide/install. A folder is a section of the sidebar, named after it
// ("2-write-a-source" is "Write a source"); a page is named by its `# `
// title. No imports: the config and the tests load it.

const ORDER = /^\d+-/

export type SidebarItem = { text: string; link?: string; items?: SidebarItem[] }

// "2-write-a-source" -> "Write a source"
export const sectionTitle = (folder: string) => {
  const words = folder.replace(ORDER, '').replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// "1-user-guide/1-install.md" -> "user-guide/install.md"
export const pagePath = (file: string) =>
  file
    .split('/')
    .map((part) => part.replace(ORDER, ''))
    .join('/')

// The URL of a file: "/user-guide/install", "/how-it-works/"
export const pageLink = (file: string) =>
  `/${pagePath(file)
    .replace(/(^|\/)index\.md$/, '$1')
    .replace(/\.md$/, '')}`

// A link of a page to another file of docs/, without the numbers, like the
// file it points to. Other links are left as they are.
export const stripOrder = (href: string) => {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return href
  const [path = '', hash] = href.split('#')
  if (!path.endsWith('.md')) return href
  return `${pagePath(path)}${hash === undefined ? '' : `#${hash}`}`
}

export const pageTitle = (content: string) =>
  /^# (.+)$/m.exec(content)?.[1]?.trim()

// A section for each folder, in their order, with its pages in theirs.
// `files` maps a path in docs/ to its content.
export const buildSidebar = (files: Record<string, string>): SidebarItem[] => {
  const sections = new Map<string, SidebarItem[]>()
  for (const file of Object.keys(files).sort()) {
    const parts = file.split('/')
    if (parts.length !== 2 || !file.endsWith('.md')) continue
    const [folder = ''] = parts
    const items = sections.get(folder) ?? []
    items.push({
      text: pageTitle(files[file]!) ?? pagePath(file),
      link: pageLink(file),
    })
    sections.set(folder, items)
  }
  return [...sections].map(([folder, items]) => ({
    text: sectionTitle(folder),
    items,
  }))
}

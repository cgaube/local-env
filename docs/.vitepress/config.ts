// The docs site, published to GitHub Pages by .github/workflows/docs.yml.
// `bun run docs:dev` serves it with hot reload. Relative imports: VitePress
// loads this file without the aliases of tsconfig.base.json.
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import { defineConfig } from 'vitepress'
import { buildSidebar, pagePath, stripOrder } from './sidebar'

const DOCS = join(import.meta.dirname, '..')
const REPO = 'https://github.com/cgaube/local-env'

// Every Markdown file of docs/, by its path there
const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
const files = Object.fromEntries(
  listFiles(DOCS).map((path) => [
    relative(DOCS, path),
    readFileSync(path, 'utf8'),
  ]),
)

export default defineConfig({
  title: 'local-env',
  description: 'A local development environment for macOS',
  base: '/local-env/',
  cleanUrls: true,
  lastUpdated: true,
  // The numbers order the files, not the URLs
  rewrites: Object.fromEntries(
    Object.keys(files).map((file) => [file, pagePath(file)]),
  ),
  markdown: {
    config: (md) => {
      // The links between the files carry the numbers, as GitHub shows them:
      // the pages don't. Before VitePress resolves them.
      md.core.ruler.push('strip-order', (state) => {
        for (const token of state.tokens) {
          for (const child of token.children ?? []) {
            const href = child.type === 'link_open' && child.attrGet('href')
            if (href) child.attrSet('href', stripOrder(href))
          }
        }
      })
      // Inline code as written: `{{ local_env_logins[…] }}` is Ansible, not a
      // Vue template (VitePress protects only the code blocks)
      const code = md.renderer.rules.code_inline!
      md.renderer.rules.code_inline = (tokens, index, options, env, self) => {
        tokens[index]!.attrSet('v-pre', '')
        return code(tokens, index, options, env, self)
      }
      // ```mermaid blocks: drawn in the browser (theme/index.ts)
      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, index, options, env, self) => {
        const token = tokens[index]!
        if (token.info.trim() !== 'mermaid') {
          return fence(tokens, index, options, env, self)
        }
        return `<pre class="mermaid" v-pre>${md.utils.escapeHtml(token.content)}</pre>`
      }
    },
  },
  themeConfig: {
    nav: [
      { text: 'User guide', link: '/user-guide/install' },
      { text: 'Write a source', link: '/write-a-source/source-repo' },
      { text: 'How it works', link: '/how-it-works/' },
    ],
    sidebar: buildSidebar(files),
    search: { provider: 'local' },
    outline: 'deep',
    socialLinks: [{ icon: 'github', link: REPO }],
    // :path is the file in docs/, numbers included
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
  },
})

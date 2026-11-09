// The default theme, with the Mermaid diagrams drawn in the browser: the
// config turns each ```mermaid block into <pre class="mermaid">. Mermaid
// loads only on a page that has one.
import DefaultTheme from 'vitepress/theme'
import { onMounted, watch } from 'vue'
import { useData, useRoute } from 'vitepress'
import type { Theme } from 'vitepress'

const drawDiagrams = async (dark: boolean) => {
  const blocks = document.querySelectorAll<HTMLElement>('pre.mermaid')
  if (blocks.length === 0) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })
  for (const block of blocks) {
    // Its source, to draw it again in the other theme
    block.dataset.source ??= block.textContent ?? ''
    block.removeAttribute('data-processed')
    block.textContent = block.dataset.source
  }
  await mermaid.run({ nodes: [...blocks] })
}

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()
    const { isDark } = useData()
    const draw = () => drawDiagrams(isDark.value)
    onMounted(draw)
    watch(() => route.path, draw, { flush: 'post' })
    watch(isDark, draw)
  },
} satisfies Theme

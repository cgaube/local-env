// Preloaded into the CLI started by e2e tests (`bun --preload`): loads
// fake-prompts.ts wherever the CLI imports src/utils/prompt.ts. Nothing in
// src/ knows about tests.
import { plugin } from 'bun'
import { readFileSync } from 'fs'
import { join } from 'path'

const fake = readFileSync(join(import.meta.dir, 'fake-prompts.ts'), 'utf8')

// With a runtime plugin registered, Bun 1.4 leaves macro imports out
// (readShippedFiles is not defined). Run them as plain imports: from the
// sources, that is the same function on the same checkout.
const MACRO_IMPORT = /\s+with\s+\{\s*type:\s*['"]macro['"]\s*\}/g

plugin({
  name: 'local-env fake prompts',
  setup(build) {
    build.onLoad({ filter: /\/src\/utils\/prompt\.ts$/ }, () => ({
      loader: 'ts',
      contents: fake,
    }))
    build.onLoad({ filter: /\/(src|services)\/.*\.ts$/ }, ({ path }) => ({
      loader: 'ts',
      contents: readFileSync(path, 'utf8').replace(MACRO_IMPORT, ''),
    }))
  },
})

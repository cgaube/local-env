import { readFileSync } from 'fs'
import { stripVTControlCharacters } from 'node:util'
import { renderPlaybook } from '#cli/core/playbook-output.js'
import {
  ANSIBLE_CORE_VERSIONS,
  sampleEventsFile,
} from '#cli-tests/support/ansible-samples.js'

// The lines it draws, without colors or clack's guide line
const draw = async (events: string[]) => {
  const write = process.stdout.write
  let output = ''
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk)
    return true
  }) as typeof process.stdout.write
  try {
    async function* lines() {
      yield* events
    }
    const summary = await renderPlaybook(lines(), new Map([['demo', 'Demo']]))
    const drawn = stripVTControlCharacters(output)
      .split('\n')
      .map((line) => line.replace(/^[│◇] {0,2}/u, ''))
      .filter(Boolean)
    return { summary, drawn }
  } finally {
    process.stdout.write = write
  }
}

describe('renderPlaybook', () => {
  // What local-env's callback printed in real Ansible (ansible-samples.ts):
  // each version has its own shape of a loop's items, drawn the same
  for (const version of ANSIBLE_CORE_VERSIONS) {
    test(`draws the sample run of ansible-core ${version}`, async () => {
      const events = readFileSync(sampleEventsFile(version), 'utf8')
        .trim()
        .split('\n')

      const { summary, drawn } = await draw(events)

      expect(summary).toEqual({
        ok: 1,
        changed: 2,
        skipped: 1,
        failed: 2,
        needPassword: [],
      })
      expect(drawn).toEqual([
        'Demo',
        '✓ Say hello  hello',
        '● Run true  changed',
        '↷ Never runs  skipped',
        '● Echo each item  3 items',
        '  ✓ first',
        '  ● second  changed',
        '  ↷ third  skipped',
        '✗ Mark the bad item  2 items',
        '  ✓ good  good',
        '  ✗ bad',
        '    bad',
        '✗ Fail',
        'boom',
      ])
    })
  }

  test('skips what is not an event', async () => {
    const { summary, drawn } = await draw(['', 'not json', '{"no": "event"}'])

    expect(summary.ok + summary.failed).toBe(0)
    expect(drawn).toEqual([])
  })
})

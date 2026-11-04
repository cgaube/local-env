import { spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { removeStaleRunFolders } from '#cli/core/run-folder.js'

const parent = mkdtempSync(join(tmpdir(), 'local-env-run-folders-'))
afterAll(() => rmSync(parent, { recursive: true, force: true }))

const runFolder = (name: string, pid: string | null) => {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'become'), 'secret\n')
  if (pid !== null) writeFileSync(join(dir, 'pid'), pid)
  return dir
}

describe('removeStaleRunFolders', () => {
  test('removes the folders of runs that are gone, keeps the running ones', async () => {
    // Another install, still running
    const running = spawn('sleep', ['30'])
    try {
      const live = runFolder('local-env-install-live', String(running.pid))
      const gone = runFolder('local-env-install-gone', '99999999')
      const unowned = runFolder('local-env-install-unowned', null)
      const other = runFolder('local-env-shipped-x', '99999999')

      removeStaleRunFolders(parent)

      expect(existsSync(live)).toBe(true)
      expect(existsSync(gone)).toBe(false)
      expect(existsSync(unowned)).toBe(false)
      // Not a run folder
      expect(existsSync(other)).toBe(true)
    } finally {
      running.kill()
    }
  })
})

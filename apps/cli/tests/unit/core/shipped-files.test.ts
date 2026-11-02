import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readShippedFile } from '#cli/core/shipped-files.js'

const dir = mkdtempSync(join(tmpdir(), 'local-env-shipped-'))

describe('readShippedFile', () => {
  test('keeps text as is', () => {
    const path = join(dir, 'compose.yaml')
    writeFileSync(path, 'name: local-env – é\n')

    expect(readShippedFile(path)).toBe('name: local-env – é\n')
  })

  test('encodes other files as base64, byte for byte', () => {
    // The start of a woff2 font: not valid UTF-8
    const bytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0xc3, 0x28])
    const path = join(dir, 'font.woff2')
    writeFileSync(path, bytes)

    const file = readShippedFile(path)

    expect(file).toEqual({ base64: bytes.toString('base64') })
    expect(Buffer.from((file as { base64: string }).base64, 'base64')).toEqual(
      bytes,
    )
  })
})

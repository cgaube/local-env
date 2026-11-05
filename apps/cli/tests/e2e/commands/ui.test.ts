import { COMPILED, createCli } from '#cli-tests/support/run-cli.js'

describe.concurrent('local-env ui', () => {
  test('shows every piece of the output, ours and clack’s', async () => {
    await using cli = await createCli()

    const result = await cli.run(['ui'])

    expect(result.exitCode).toBe(0)
    for (const piece of [
      'logger.warn: something to look at',
      '✓  logger.step: a step of its own that went well',
      // The real playbook renderer, by label
      '◇  Git',
      '● Install git-extras  Package installed: git-extras',
      '✓ geerlingguy.mac 5.1.0  installed',
      '■  Callout: error',
      'log.message, with our symbol',
      'closeFrameWithCallout',
    ]) {
      expect(result.output).toContain(piece)
    }
    // Without --prompts, no question waits for an answer
    expect(result.output).not.toContain('Questions')
  })

  test.skipIf(COMPILED)('runs only the questions with --prompts', async () => {
    await using cli = await createCli()

    const result = await cli.run(['ui', '--prompts'], {
      answers: [
        { ask: 'askSelect', answer: 'two' },
        { ask: 'askConfirm', answer: true },
        { ask: 'askText', answer: 'hello' },
        { ask: 'askPassword: typed masked', answer: 'secret' },
      ],
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).not.toContain('Callout')
  })

  test('needs a terminal for --prompts', async () => {
    await using cli = await createCli()

    const result = await cli.run(['ui', '--prompts'], {
      env: { FAKE_PROMPTS_NO_TTY: '1' },
    })

    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('--prompts needs a terminal')
  })

  test('is not in --help', async () => {
    await using cli = await createCli()

    const result = await cli.run(['--help'])

    expect(result.output).toContain('install')
    expect(result.output).not.toMatch(/^\s+ui\b/m)
  })
})

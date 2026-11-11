import { composeVariables } from '#cli/providers/docker/stack-secrets.js'

describe('the variables of a compose file', () => {
  test('finds every form, once each', () => {
    expect(
      composeVariables(
        [
          'services:',
          '  app:',
          '    environment:',
          '      A: ${DB_PASSWORD}',
          '      B: ${API_KEY:-none}',
          '      C: ${TOKEN:?the token} and $BARE',
          '      D: ${DB_PASSWORD}',
          '',
        ].join('\n'),
      ),
    ).toEqual(['DB_PASSWORD', 'API_KEY', 'TOKEN', 'BARE'])
  })

  test('leaves out $$, which compose writes as a $', () => {
    expect(composeVariables('command: echo $$HOME ${REAL}')).toEqual(['REAL'])
  })
})

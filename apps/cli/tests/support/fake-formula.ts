// The Homebrew formula, as the new version check reads it
// (src/core/update-check.ts): a server the CLI reaches through
// LOCAL_ENV_FORMULA_URL
export const fakeFormula = (version: string) => {
  let requests = 0
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      requests++
      return new Response(
        [
          'class LocalEnv < Formula',
          `  url "https://github.com/cgaube/local-env/releases/download/v${version}/local-env"`,
          `  version "${version}"`,
          'end',
        ].join('\n'),
      )
    },
  })
  return {
    env: { LOCAL_ENV_FORMULA_URL: server.url.href },
    requests: () => requests,
    [Symbol.dispose]: () => server.stop(true),
  }
}

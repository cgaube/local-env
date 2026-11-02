// Published on 127.0.0.1 only: localhost could resolve to ::1 first. Tests
// point it at a fake Dockhand (tests/support/fake-dockhand.ts).
// The port is uncommon on purpose: an app on the Mac that listens on
// 127.0.0.1 with the same port (3000 for Rails or Next.js) gets the requests
// instead of Docker. Keep it in sync with compose.yaml.
const DOCKHAND_URL =
  process.env.LOCAL_ENV_DOCKHAND_URL ?? 'http://127.0.0.1:17300'

export const dockhandApi = async <T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${DOCKHAND_URL}/api${path}`, {
    ...init,
    // Accept JSON so streaming endpoints (deploys) reply synchronously
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init?.headers,
    },
  })

  // Dockhand answers its API in JSON: an HTML page comes from another app
  if (response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(
      `Another app answers on ${DOCKHAND_URL}, not Dockhand. Stop it, or move it to another port, then try again (lsof -nP -iTCP:${new URL(DOCKHAND_URL).port} -sTCP:LISTEN shows it).`,
    )
  }

  if (!response.ok) {
    throw new Error(
      `Dockhand API ${init?.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`,
    )
  }

  return response.json() as Promise<T>
}

export const dockhandPost = <T = unknown>(path: string, body: unknown) =>
  dockhandApi<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const dockhandPut = <T = unknown>(path: string, body: unknown) =>
  dockhandApi<T>(path, { method: 'PUT', body: JSON.stringify(body) })

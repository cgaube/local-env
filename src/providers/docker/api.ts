// Published on 127.0.0.1 only: localhost could resolve to ::1 first. Tests
// point it at a fake Dockhand (tests/support/fake-dockhand.ts).
const DOCKHAND_URL =
  process.env.LOCAL_ENV_DOCKHAND_URL ?? 'http://127.0.0.1:3000'

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

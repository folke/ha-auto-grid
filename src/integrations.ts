import type { Connection } from "./types.ts"

const cache = new WeakMap<Connection, Promise<Record<string, string>>>()

export function clearIntegrationNames(connection: Connection): void {
  cache.delete(connection)
}

export function integrationNames(connection: Connection): Promise<Record<string, string>> {
  let names = cache.get(connection)
  if (!names) {
    names = Promise.resolve()
      .then(async () => {
        const manifests = await connection.sendMessagePromise?.<{ domain: string; name: string }[]>(
          {
            type: "manifest/list",
          }
        )
        return Object.fromEntries(
          (manifests ?? [])
            .filter(
              (manifest) => typeof manifest.domain === "string" && typeof manifest.name === "string"
            )
            .sort((a, b) => a.domain.localeCompare(b.domain))
            .map(({ domain, name }) => [domain, name])
        )
      })
      .catch((error: unknown) => {
        if (cache.get(connection) === names) cache.delete(connection)
        console.warn("Auto Grid: integration names unavailable; using domains", error)
        return {}
      })
    cache.set(connection, names)
  }
  return names
}

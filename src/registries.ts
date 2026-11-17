import type { Connection, RegistryKind } from "./types.ts"
import { clearIntegrationNames } from "./integrations.ts"

type Dispose = () => void | Promise<void>
type Stream = {
  consumers: Set<() => void>
  closed: boolean
  unsubscribes: Set<Dispose>
}
const connections = new WeakMap<Connection, Map<RegistryKind, Stream>>()

function dispose(unsubscribe: Dispose): void {
  void Promise.resolve()
    .then(unsubscribe)
    .catch((error: unknown) => console.warn("Auto Grid: registry unsubscribe failed", error))
}

function stop(stream: Stream): void {
  stream.unsubscribes.forEach(dispose)
  stream.unsubscribes.clear()
}

export function watchRegistries(
  connection: Connection,
  kinds: RegistryKind[],
  changed: () => void
): () => void {
  let streams = connections.get(connection)
  if (!streams) {
    streams = new Map()
    connections.set(connection, streams)
  }
  const releases = [...new Set(kinds)].map((kind) => {
    let stream = streams!.get(kind)
    if (!stream) {
      stream = { closed: false, consumers: new Set(), unsubscribes: new Set() }
      streams!.set(kind, stream)
      const current = stream
      current.consumers.add(changed)
      if (kind === "integration") clearIntegrationNames(connection)
      const notify = () => {
        if (current.closed) return
        if (kind === "integration") clearIntegrationNames(connection)
        current.consumers.forEach((consumer) => consumer())
      }
      const subscribe = (request: Record<string, unknown>, callback: (event: unknown) => void) => {
        const failed = (error: unknown) => {
          if (!current.closed)
            console.warn(`Auto Grid: ${kind} registry subscription failed`, error)
        }
        try {
          void connection
            .subscribeMessage<unknown>((event) => {
              if (!current.closed) callback(event)
            }, request)
            .then((unsubscribe) => {
              if (current.closed) dispose(unsubscribe)
              else current.unsubscribes.add(unsubscribe)
            })
            .catch(failed)
        } catch (error) {
          failed(error)
        }
      }
      if (kind === "integration") {
        let snapshotSeen = false
        subscribe({ type: "config_entries/subscribe" }, (event) => {
          if (!Array.isArray(event)) return
          const snapshot = event.every((change) => change?.type == null)
          if (!snapshot || snapshotSeen) notify()
          if (snapshot) snapshotSeen = true
        })
        subscribe({ event_type: "component_loaded", type: "subscribe_events" }, notify)
      } else subscribe({ event_type: `${kind}_registry_updated`, type: "subscribe_events" }, notify)
    } else stream.consumers.add(changed)
    const current = stream
    return () => {
      current.consumers.delete(changed)
      if (current.closed || current.consumers.size) return
      current.closed = true
      streams!.delete(kind)
      stop(current)
    }
  })
  return () => releases.forEach((release) => release())
}

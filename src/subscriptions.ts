import type { Connection, TemplateResult } from "./types.ts"

type Consumer = { result: (value: unknown) => void; error: (error: Error) => void }
type Entry = {
  consumers: Set<Consumer>
  hasValue: boolean
  value?: unknown
  error?: Error
  closed: boolean
  unsubscribe?: () => void | Promise<void>
}
const connections = new WeakMap<Connection, Map<string, Entry>>()

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "object" && value && "message" in value)
    return new Error(String(value.message))
  return new Error(String(value))
}

function unsubscribe(entry: Entry): void {
  const dispose = entry.unsubscribe
  entry.unsubscribe = undefined
  if (dispose) {
    // A closed connection can reject unsubscribe; the local consumer is already removed.
    void Promise.resolve()
      .then(dispose)
      .catch((error: unknown) => console.debug("Auto Grid: unsubscribe failed", error))
  }
}

export function subscribeTemplate(
  connection: Connection,
  template: string,
  consumer: Consumer,
  variables?: Record<string, unknown>
): () => void {
  const key = JSON.stringify([template, variables ?? {}])
  let entries = connections.get(connection)
  if (!entries) {
    entries = new Map()
    connections.set(connection, entries)
  }
  let entry = entries.get(key)
  if (!entry) {
    entry = { consumers: new Set(), hasValue: false, closed: false }
    entries.set(key, entry)
    const current = entry
    // Attach the consumer before subscribing: a connection may deliver cached data immediately.
    current.consumers.add(consumer)
    const failed = (error: unknown) => {
      if (current.closed) return
      current.error = toError(error)
      current.consumers.forEach((c) => c.error(current.error!))
    }
    try {
      void connection
        .subscribeMessage<TemplateResult>(
          (message) => {
            if (current.closed) return
            if (message.error) {
              failed(message.error)
              return
            }
            current.hasValue = true
            current.value = message.result
            current.error = undefined
            current.consumers.forEach((c) => c.result(message.result))
          },
          { type: "render_template", template, ...(variables ? { variables } : {}) }
        )
        .then((dispose) => {
          current.unsubscribe = dispose
          if (current.closed) unsubscribe(current)
        })
        .catch(failed)
    } catch (error) {
      failed(error)
    }
  } else {
    entry.consumers.add(consumer)
    if (entry.error) consumer.error(entry.error)
    else if (entry.hasValue) consumer.result(entry.value)
  }

  const current = entry
  return () => {
    current.consumers.delete(consumer)
    if (current.closed || current.consumers.size) return
    current.closed = true
    entries.delete(key)
    unsubscribe(current)
  }
}

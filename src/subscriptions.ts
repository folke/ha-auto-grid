import type { Connection, TemplateResult, RegistryKind } from "./types.ts"
import { integrationNames } from "./integrations.ts"
import { watchRegistries } from "./registries.ts"

type Consumer = {
  result: (value: unknown) => void
  error: (error: Error) => void
  refresh?: () => void
}
type Options = { registries?: RegistryKind[]; integrationNames?: boolean }
type Dispose = () => void | Promise<void>
type Entry = {
  consumers: Set<Consumer>
  hasValue: boolean
  value?: unknown
  error?: Error
  closed: boolean
  stale: boolean
  generation: number
  unsubscribe?: Dispose
  releaseRegistries?: () => void
  timer?: ReturnType<typeof setTimeout>
}
const connections = new WeakMap<Connection, Map<string, Entry>>()

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === "object" && value && "message" in value)
    return new Error(String(value.message))
  return new Error(String(value))
}

function dispose(unsubscribe?: Dispose): void {
  if (unsubscribe)
    void Promise.resolve()
      .then(unsubscribe)
      .catch((error: unknown) => console.debug("Auto Grid: unsubscribe failed", error))
}

function stop(entry: Entry): void {
  const unsubscribe = entry.unsubscribe
  entry.unsubscribe = undefined
  dispose(unsubscribe)
}

export function subscribeTemplate(
  connection: Connection,
  template: string,
  consumer: Consumer,
  variables?: Record<string, unknown>,
  options: Options = {}
): () => void {
  const kinds = [...new Set(options.registries ?? [])].sort()
  const key = JSON.stringify([template, variables ?? {}, kinds, options.integrationNames ?? false])
  let entries = connections.get(connection)
  if (!entries) {
    entries = new Map()
    connections.set(connection, entries)
  }
  let entry = entries.get(key)
  if (!entry) {
    entry = {
      consumers: new Set([consumer]),
      hasValue: false,
      closed: false,
      stale: false,
      generation: 0,
    }
    entries.set(key, entry)
    const current = entry
    const open = () => {
      const generation = ++current.generation
      const valid = () => !current.closed && generation === current.generation
      const failed = (error: unknown) => {
        if (!valid()) return
        current.error = toError(error)
        current.consumers.forEach((c) => c.error(current.error!))
      }
      const subscribe = (context?: Record<string, unknown>) => {
        if (!valid()) return
        try {
          void connection
            .subscribeMessage<TemplateResult>(
              (message) => {
                if (!valid()) return
                if (message.error) {
                  failed(message.error)
                  return
                }
                current.hasValue = true
                current.stale = false
                current.value = message.result
                current.error = undefined
                current.consumers.forEach((c) => c.result(message.result))
              },
              { type: "render_template", template, ...(context ? { variables: context } : {}) }
            )
            .then((unsubscribe) => {
              if (!valid()) dispose(unsubscribe)
              else current.unsubscribe = unsubscribe
            })
            .catch(failed)
        } catch (error) {
          failed(error)
        }
      }
      if (options.integrationNames) {
        void integrationNames(connection)
          .then((names) => subscribe({ ...variables, ag_integration_names: names }))
          .catch(failed)
      } else subscribe(variables)
    }
    current.releaseRegistries = watchRegistries(connection, kinds, () => {
      if (current.closed) return
      const first = !current.stale
      current.stale = true
      current.error = undefined
      current.generation++
      stop(current)
      if (first) current.consumers.forEach((c) => c.refresh?.())
      if (current.closed) return
      clearTimeout(current.timer)
      current.timer = setTimeout(() => {
        current.timer = undefined
        if (!current.closed) open()
      }, 100)
    })
    if (!current.timer) open()
  } else {
    entry.consumers.add(consumer)
    if (entry.error) consumer.error(entry.error)
    else if (entry.stale) consumer.refresh?.()
    else if (entry.hasValue) consumer.result(entry.value)
  }
  const current = entry
  return () => {
    current.consumers.delete(consumer)
    if (current.closed || current.consumers.size) return
    current.closed = true
    current.generation++
    clearTimeout(current.timer)
    current.releaseRegistries?.()
    if (entries.get(key) === current) entries.delete(key)
    stop(current)
  }
}

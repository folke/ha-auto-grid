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
export type TemplateSubscription = (() => void) & { retry: () => void }
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
  retry?: () => void
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
      .catch((error: unknown) => console.warn("Auto Grid: unsubscribe failed", error))
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
): TemplateSubscription {
  const kinds = [...new Set(options.registries)].sort()
  const key = JSON.stringify([template, variables ?? {}, kinds, options.integrationNames ?? false])
  let entries = connections.get(connection)
  if (!entries) {
    entries = new Map()
    connections.set(connection, entries)
  }
  let entry = entries.get(key)
  if (!entry) {
    entry = {
      closed: false,
      consumers: new Set([consumer]),
      generation: 0,
      hasValue: false,
      stale: false,
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
              { template, type: "render_template", ...(context ? { variables: context } : {}) }
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
    const refresh = (debounce: boolean) => {
      if (current.closed) return
      const first = !current.stale || current.error !== undefined
      current.stale = true
      current.error = undefined
      current.generation++
      stop(current)
      if (first) current.consumers.forEach((c) => c.refresh?.())
      // A refresh consumer can synchronously release the last subscription.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (current.closed) return
      clearTimeout(current.timer)
      current.timer = undefined
      if (debounce) {
        current.timer = setTimeout(() => {
          current.timer = undefined
          if (!current.closed) open()
        }, 100)
      } else open()
    }
    current.retry = () => refresh(false)
    current.releaseRegistries = watchRegistries(connection, kinds, () => refresh(true))
    if (!current.timer) open()
  } else {
    entry.consumers.add(consumer)
    if (entry.error) consumer.error(entry.error)
    else if (entry.stale) consumer.refresh?.()
    else if (entry.hasValue) consumer.result(entry.value)
  }
  const current = entry
  const release = () => {
    current.consumers.delete(consumer)
    if (current.closed || current.consumers.size) return
    current.closed = true
    current.generation++
    clearTimeout(current.timer)
    current.releaseRegistries?.()
    if (entries.get(key) === current) entries.delete(key)
    stop(current)
  }
  return Object.assign(release, {
    retry: () => {
      if (current.consumers.has(consumer)) current.retry?.()
    },
  })
}

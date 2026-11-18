import { normalizeColumns } from "./layout.ts"
import { compileCardOptions, validateCardOptions } from "./card-templates.ts"
import { normalizeConfig } from "./query.ts"
import { headingConfig } from "./heading.ts"
import type { AutoGridConfig, CardConfig } from "./types.ts"

export function hasCardTemplates(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCardTemplates)
  return (
    !!value &&
    typeof value === "object" &&
    Object.entries(value).some(([key, child]) => key.startsWith("$") || hasCardTemplates(child))
  )
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)])
  )
}

export function sameConfig(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

export function templateEditorInfo(card: Partial<CardConfig> = {}): {
  paths: string[]
  safe: boolean
} {
  const templates = compileCardOptions({ type: "tile", ...card }).templates
  return {
    paths: templates.map(({ path }) => path.join(".")),
    safe: templates.every(
      ({ path }) => path[0] !== "type" && path.every((part) => typeof part === "string")
    ),
  }
}

export function restoreTemplateValues(
  source: Partial<CardConfig>,
  snapshot: CardConfig,
  edited: CardConfig
): CardConfig {
  const result = structuredClone(edited)
  for (const { path } of compileCardOptions({ type: "tile", ...source }).templates) {
    let target: Record<string | number, unknown> = result
    let before: Record<string | number, unknown> = snapshot
    for (const key of path.slice(0, -1)) {
      if (!Object.hasOwn(target, key) || !target[key] || typeof target[key] !== "object")
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: true,
          value: structuredClone(before[key]),
          writable: true,
        })
      target = target[key] as Record<string | number, unknown>
      before = before[key] as Record<string | number, unknown>
    }
    Object.defineProperty(target, path.at(-1)!, {
      configurable: true,
      enumerable: true,
      value: structuredClone(before[path.at(-1)!]),
      writable: true,
    })
  }
  return result
}

export function mergeVisualEdit(
  source: Partial<CardConfig>,
  snapshot: CardConfig,
  value: unknown
): { card: Partial<CardConfig>; protectedEdits: string[] } {
  validateCardOptions(value, false)
  if (hasCardTemplates(source) && value.type !== snapshot.type)
    throw new Error("Changing card type with templates requires YAML editing.")
  const protectedEdits: string[] = []
  const record = (node: unknown): Record<string, unknown> =>
    node && typeof node === "object" && !Array.isArray(node)
      ? (node as Record<string, unknown>)
      : {}
  const merge = (
    original: unknown,
    before: unknown,
    after: unknown,
    path: string[]
  ): Record<string, unknown> => {
    const result = structuredClone(record(original))
    const old = record(before),
      next = record(after)
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (sameConfig(old[key], next[key])) continue
      if (Object.hasOwn(result, `$${key}`)) {
        protectedEdits.push([...path, key].join("."))
        continue
      }
      if (Object.hasOwn(next, key)) {
        let child = next[key]
        if (child && typeof child === "object" && !Array.isArray(child))
          child = merge(result[key], old[key], child, [...path, key])
        else if (hasCardTemplates(result[key]))
          throw new Error("Changing template structure requires YAML editing.")
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: structuredClone(child),
          writable: true,
        })
      } else {
        if (hasCardTemplates(result[key]))
          throw new Error("Removing template structure requires YAML editing.")
        delete result[key]
      }
    }
    return result
  }
  return { card: merge(source, snapshot, value, []), protectedEdits }
}

export function cardEditorValue(config: AutoGridConfig, entity?: string): CardConfig {
  return { type: "tile", ...structuredClone(config.card ?? {}), ...(entity ? { entity } : {}) }
}

export function updateCard(
  config: AutoGridConfig,
  value: unknown,
  visual = false,
  singleCard = false
): AutoGridConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("card must be an object")
  const card = structuredClone(value) as Partial<CardConfig>
  if (visual && !singleCard) delete card.entity
  validateCardOptions(card, !singleCard)
  if (singleCard && !card.type && !card.$type) throw new Error("card.type is required")
  const current = visual ? cardEditorValue(config) : config.card
  if (sameConfig(card, current)) return config
  return { ...structuredClone(config), card }
}

export function headingEditorValue(config: AutoGridConfig): CardConfig {
  return headingConfig(config) ?? { heading: "", heading_style: "title", type: "heading" }
}

export function updateHeading(config: AutoGridConfig, value: unknown): AutoGridConfig {
  const result = structuredClone(config)
  if (value === undefined) {
    delete result.heading
    delete result.$heading
    delete result.title
  } else {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Heading must be an object")
    const card = structuredClone(value) as Partial<CardConfig>
    const normalized = headingConfig({ heading: card })
    const current = headingEditorValue(config)
    const comparable = { ...normalized, heading: normalized?.heading ?? "" }
    if (sameConfig(comparable, { ...current, heading: current.heading ?? "" })) return config
    if (sameConfig(comparable, { heading: "", heading_style: "title", type: "heading" })) {
      delete result.heading
    } else {
      delete card.type
      result.heading = card
    }
    delete result.title
    delete result.$heading
  }
  return sameConfig(config, result) ? config : result
}

export const selectionKeys = ["include", "exclude", "group", "sort", "limit"] as const

export function selectionData(config: AutoGridConfig): Record<string, unknown> {
  return Object.fromEntries(
    selectionKeys
      .filter((key) => config[key] !== undefined)
      .map((key) => [key, structuredClone(config[key])])
  )
}

export function updateSelection(config: AutoGridConfig, value: unknown): AutoGridConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Selection must be an object")
  for (const key of Object.keys(value)) {
    if (!(selectionKeys as readonly string[]).includes(key))
      throw new Error(
        `Unknown selection field: ${key}. Use include, exclude, group, sort, or limit.`
      )
  }
  const result: Partial<AutoGridConfig> = structuredClone(config)
  for (const key of selectionKeys) delete result[key]
  Object.assign(result, structuredClone(value))
  normalizeConfig(result as AutoGridConfig)
  return sameConfig(config, result) ? config : (result as AutoGridConfig)
}

export function layoutData(config: AutoGridConfig): Record<string, unknown> {
  return {
    columns: String(config.columns ?? 2),
    show_empty: config.show_empty ?? false,
    square: config.square ?? false,
  }
}

export function updateLayout(
  config: AutoGridConfig,
  value: Record<string, unknown>
): AutoGridConfig {
  const current = layoutData(config)
  const data = { ...current, ...value }
  const result = structuredClone(config)
  if (!sameConfig(data.columns, current.columns)) {
    if (data.columns == null || (typeof data.columns === "string" && !data.columns.trim()))
      delete result.columns
    else result.columns = normalizeColumns(data.columns)
  }
  for (const key of ["square", "show_empty"] as const) {
    if (sameConfig(data[key], current[key])) continue
    if (typeof data[key] !== "boolean") throw new Error(`${key} must be a boolean`)
    result[key] = data[key]
  }
  return sameConfig(config, result) ? config : result
}

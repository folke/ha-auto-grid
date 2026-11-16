import { validateCardOptions } from "./card-templates.ts"
import { normalizeConfig } from "./query.ts"
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

export function cardEditorValue(config: AutoGridConfig, entity?: string): CardConfig {
  return { type: "tile", ...structuredClone(config.card ?? {}), ...(entity ? { entity } : {}) }
}

export function updateCard(config: AutoGridConfig, value: unknown, visual = false): AutoGridConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("card must be an object")
  const card = structuredClone(value) as Partial<CardConfig>
  if (visual) delete card.entity
  validateCardOptions(card)
  const current = visual ? cardEditorValue(config) : config.card
  if (sameConfig(card, current)) return config
  return { ...structuredClone(config), card }
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
    title: config.title ?? "",
    columns: String(config.columns ?? 2),
    square: config.square ?? false,
    show_empty: config.show_empty ?? false,
  }
}

export function updateLayout(
  config: AutoGridConfig,
  value: Record<string, unknown>
): AutoGridConfig {
  const current = layoutData(config)
  const data = { ...current, ...value }
  const result = structuredClone(config)
  if (!sameConfig(data.title, current.title)) {
    if (data.title === undefined || data.title === null || data.title === "") delete result.title
    else if (typeof data.title === "string") result.title = data.title
    else throw new Error("Title must be text")
  }
  if (!sameConfig(data.columns, current.columns)) {
    if (
      data.columns != null &&
      typeof data.columns !== "string" &&
      typeof data.columns !== "number"
    ) {
      throw new Error('Columns must be a positive integer or "auto"')
    }
    const text = String(data.columns ?? "").trim()
    if (!text) delete result.columns
    else if (text === "auto") result.columns = "auto"
    else if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0)
      result.columns = Number(text)
    else throw new Error('Columns must be a positive integer or "auto"')
  }
  for (const key of ["square", "show_empty"] as const) {
    if (sameConfig(data[key], current[key])) continue
    if (typeof data[key] !== "boolean") throw new Error(`${key} must be a boolean`)
    result[key] = data[key]
  }
  return sameConfig(config, result) ? config : result
}

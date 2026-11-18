import { compileCardOptions, mergeCardOptions, validateCardOptions } from "./card-templates.ts"
import type { AutoGridConfig, CardConfig } from "./types.ts"

export function headingConfig(
  config: Pick<AutoGridConfig, "heading" | "title">,
  style: "title" | "subtitle" = "title"
): CardConfig | undefined {
  if (config.title !== undefined && typeof config.title !== "string")
    throw new Error("title must be a string")
  if (config.title !== undefined && config.heading !== undefined)
    throw new Error("Use heading or title, not both")
  // Only undefined falls back; null must still fail validation.
  // oxlint-disable-next-line typescript/prefer-nullish-coalescing
  const value = config.heading !== undefined ? config.heading : config.title
  if (value === undefined || value === "") return undefined
  const options = typeof value === "string" ? { heading: value } : value
  validateCardOptions(options)
  return validateHeading(
    mergeCardOptions({ heading_style: style, type: "heading" }, structuredClone(options))
  )
}

export function validateHeading(value: CardConfig): CardConfig {
  validateCardOptions(value)
  if (value.type !== "heading") throw new Error("heading.type must be heading")
  if (value.heading !== undefined && typeof value.heading !== "string")
    throw new Error("heading.heading must be a string")
  if (value.icon !== undefined && typeof value.icon !== "string")
    throw new Error("heading.icon must be a string")
  if (
    value.heading_style !== undefined &&
    value.heading_style !== "title" &&
    value.heading_style !== "subtitle"
  )
    throw new Error("heading.heading_style must be title or subtitle")
  if (value.badges !== undefined && !Array.isArray(value.badges))
    throw new Error("heading.badges must be a list")
  return value
}

export function compileHeadingOptions(config: CardConfig): ReturnType<typeof compileCardOptions> {
  const card = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key === "heading" && typeof value === "string" && /{{|{%/.test(value) ? "$heading" : key,
      value,
    ])
  ) as CardConfig
  return compileCardOptions(card)
}

export function visibleHeading(config?: CardConfig): boolean {
  if (config?.heading || config?.icon || config?.$heading || config?.$icon) return true
  return [config?.badges, config?.entities].some((items) => Array.isArray(items) && items.length)
}

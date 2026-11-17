import { compileCardOptions, validateCardOptions } from "./card-templates.ts"
import type { AutoGridConfig, CardConfig } from "./types.ts"

export function headingConfig(
  config: Pick<AutoGridConfig, "heading" | "title">
): CardConfig | undefined {
  if (config.title !== undefined && typeof config.title !== "string")
    throw new Error("title must be a string")
  if (config.title !== undefined && config.heading !== undefined)
    throw new Error("Use heading or title, not both")
  const value = config.heading !== undefined ? config.heading : config.title
  if (value === undefined || value === "") return undefined
  if (typeof value === "string") return { type: "heading", heading_style: "title", heading: value }
  validateCardOptions(value)
  if (value.type !== undefined && value.type !== "heading")
    throw new Error("heading.type must be heading")
  if (value.heading !== undefined && typeof value.heading !== "string")
    throw new Error("heading.heading must be a string")
  if (value.icon !== undefined && typeof value.icon !== "string")
    throw new Error("heading.icon must be a string")
  if (value.heading_style !== undefined && !["title", "subtitle"].includes(value.heading_style))
    throw new Error("heading.heading_style must be title or subtitle")
  if (value.badges !== undefined && !Array.isArray(value.badges))
    throw new Error("heading.badges must be a list")
  const card: CardConfig = { type: "heading", heading_style: "title", ...structuredClone(value) }
  if (compileCardOptions(card).templates.length)
    throw new Error(
      "Heading $ templates are not supported; use native heading badges for live values"
    )
  return card
}

export function visibleHeading(config?: CardConfig): boolean {
  return !!(
    config?.heading ||
    config?.icon ||
    [config?.badges, config?.entities].some((items) => Array.isArray(items) && items.length)
  )
}

import type { Columns } from "./types.ts"

export function normalizeColumns(value: unknown = 2): Columns {
  if (typeof value === "string") {
    const text = value.trim()
    if (text === "auto" || text === "all") return text
    if (/^\d+$/.test(text)) value = Number(text)
    else if (/^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(text)) {
      const width = Number(text.slice(0, -2))
      if (Number.isFinite(width) && width > 0) return `${width}px`
    }
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    if (value > 24)
      throw new Error(
        `columns: ${value} exceeds the maximum of 24 fixed columns. For responsive wrapping, use columns: ${value}px.`
      )
    return value
  }
  throw new Error(
    'columns must be a count from 1–24, "auto", "all", or a positive pixel width such as "180px"'
  )
}

export function minimumWidth(columns: Columns): number | undefined {
  if (columns === "auto") return 140
  if (typeof columns === "string" && columns.endsWith("px")) return Number.parseFloat(columns)
  return undefined
}

import type { CardConfig, CardTemplate } from "./types.ts"

type Node = Record<string, unknown>

function visit(value: unknown, transform: (node: Node) => Node, depth = 0): unknown {
  if (depth > 30) throw new Error("Card configuration may nest at most 30 levels")
  if (Array.isArray(value)) return value.map((item) => visit(item, transform, depth + 1))
  if (!value || typeof value !== "object") return value
  const node = transform(value as Node)
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, visit(child, transform, depth + 1)])
  )
}

export function validateCardOptions(
  card: unknown,
  reserveEntity = true
): asserts card is Partial<CardConfig> {
  if (!card || typeof card !== "object" || Array.isArray(card))
    throw new Error("card must be an object")
  if (reserveEntity && ("entity" in card || "$entity" in card))
    throw new Error("card.entity is supplied by the query")
  if ("type" in card && (typeof card.type !== "string" || !card.type.trim()))
    throw new Error("card.type must be a non-empty string")
  visit(card, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (!key.startsWith("$")) continue
      const target = key.slice(1)
      if (!target || target.startsWith("$"))
        throw new Error("Template keys require one $ prefix and a non-empty name")
      if (Object.hasOwn(node, target))
        throw new Error(`Conflicting card keys: ${target} and ${key}`)
      if (typeof value !== "string") throw new Error(`${key} must be a template string`)
    }
    return node
  })
}

export function mergeCardOptions(
  base: Partial<CardConfig>,
  override: Partial<CardConfig>
): CardConfig {
  const result: Node = { ...base }
  for (const [key, value] of Object.entries(override)) {
    delete result[key.startsWith("$") ? key.slice(1) : `$${key}`]
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  }
  return result as CardConfig
}

export function compileCardOptions(card: CardConfig): {
  card: CardConfig
  context: Partial<CardConfig>
  templates: CardTemplate[]
} {
  const templates: CardTemplate[] = []
  function compile(value: unknown, path: (string | number)[]): unknown {
    if (Array.isArray(value)) return value.map((item, i) => compile(item, [...path, i]))
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const target = key.startsWith("$") ? key.slice(1) : key
        const next = [...path, target]
        if (key.startsWith("$")) {
          templates.push({ path: next, source: child as string })
          return [target, ""]
        }
        return [key, compile(child, next)]
      })
    )
  }
  const compiled = compile(card, []) as CardConfig
  const context = visit(card, (node) =>
    Object.fromEntries(Object.entries(node).filter(([key]) => !key.startsWith("$")))
  ) as Partial<CardConfig>
  return { card: compiled, context, templates }
}

export function renderCardOptions(
  card: CardConfig,
  templates: CardTemplate[],
  values: string[] | undefined,
  entity?: string
): CardConfig {
  if (
    (values?.length ?? 0) !== templates.length ||
    values?.some((value) => typeof value !== "string")
  ) {
    throw new Error("Invalid rendered card template values")
  }
  const result = structuredClone(card)
  templates.forEach(({ path }, index) => {
    let target: unknown = result
    for (const key of path.slice(0, -1)) target = (target as Record<string | number, unknown>)[key]
    Object.defineProperty(target, path.at(-1)!, {
      configurable: true,
      enumerable: true,
      value: values![index],
      writable: true,
    })
  })
  if (typeof result.type !== "string" || !result.type.trim())
    throw new Error("Rendered card.type must be a non-empty string")
  return entity === undefined ? result : { ...result, entity }
}

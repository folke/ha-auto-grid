import type {
  AutoGridConfig,
  CardConfig,
  Filter,
  GridConfig,
  Include,
  Pattern,
  QueryMatch,
  Selection,
  Sort,
} from "./types.ts"

const entityId = /^[a-z0-9_]+\.[a-z0-9_]+$/
const domain = /^[a-z0-9_]+$/
const filterKeys = new Set([
  "area",
  "floor",
  "device",
  "label",
  "domain",
  "entity_id",
  "device_class",
  "hidden",
  "state",
  "name",
  "attributes",
  "all",
  "any",
  "not",
])
const sortKeys = new Set(["by", "attribute", "numeric", "reverse"])

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
}

function strings(value: unknown, name: string): string[] {
  const values = Array.isArray(value) ? value : [value]
  if (!values.length || values.some((v) => typeof v !== "string" || !v.trim())) {
    throw new Error(`${name} must be a non-empty string or list of strings`)
  }
  return values as string[]
}

function literal(value: Pattern): string {
  return value === null ? "none" : JSON.stringify(value)
}

function join(expressions: string[], operator: "and" | "or"): string {
  return expressions.length
    ? `(${expressions.join(` ${operator} `)})`
    : operator === "and"
      ? "true"
      : "false"
}

function matchOne(target: string, value: Pattern): string {
  if (value === null) return `${target} is none`
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Filter numbers must be finite")
    return `(${target} | float(none)) == ${value}`
  }
  if (typeof value === "boolean") return `${target} == ${literal(value)}`
  if (typeof value !== "string")
    throw new Error("Filter values must be strings, numbers, booleans, or null")

  const comparison = /^(<=|>=|!=|==|<|>|=)\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(
    value.trim()
  )
  if (comparison) {
    const operator = comparison[1] === "=" ? "==" : comparison[1]
    const number = Number(comparison[2])
    if (!Number.isFinite(number)) throw new Error("Filter numbers must be finite")
    return `(is_number(${target}) and (${target} | float) ${operator} ${number})`
  }

  let pattern: string | undefined
  if (value.startsWith("/") && value.endsWith("/") && value.length > 1) {
    pattern = value.slice(1, -1)
  } else if (value.includes("*")) {
    pattern = `^${value
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`
  }
  return pattern === undefined
    ? `${target} == ${literal(value)}`
    : `(${target} is string and ${target} is search(${literal(pattern)}))`
}

function match(target: string, value: Selection): string {
  const values = Array.isArray(value) ? value : [value]
  if (!values.length) throw new Error("Filter value lists must not be empty")
  return join(
    values.map((v) => matchOne(target, v)),
    "or"
  )
}

function membership(key: string, values: string[]): string {
  return `(${values.map((value) => `${key}_entities(${literal(value)})`).join(" + ")})`
}

function validateFilter(filter: Filter, depth = 0): void {
  object(filter, "filter")
  if (depth > 20) throw new Error("Filters may nest at most 20 levels")
  for (const [key, value] of Object.entries(filter)) {
    if (!filterKeys.has(key)) throw new Error(`Unknown filter rule: ${key}`)
    if (["area", "floor", "device", "label", "domain", "entity_id", "device_class"].includes(key)) {
      const values = strings(value, key)
      if (key === "domain" && values.some((v) => !domain.test(v))) {
        throw new Error("domain must contain valid domain names, not patterns")
      }
    } else if (key === "hidden") {
      if (typeof value !== "boolean") throw new Error("hidden must be a boolean")
    } else if (key === "all" || key === "any") {
      if (!Array.isArray(value)) throw new Error(`${key} must be a list of filters`)
      value.forEach((v) => validateFilter(v, depth + 1))
    } else if (key === "not") {
      validateFilter(value as Filter, depth + 1)
    } else if (key === "attributes") {
      object(value, "attributes")
      for (const [attribute, pattern] of Object.entries(value)) {
        if (!attribute) throw new Error("Attribute names must not be empty")
        match("value", pattern as Selection)
      }
    } else {
      match("value", value as Selection)
    }
  }
}

function predicate(filter: Filter, sets: Map<string, string>): string {
  const expressions: string[] = []
  for (const [key, value] of Object.entries(filter)) {
    if (["area", "floor", "device", "label"].includes(key)) {
      const source = membership(key, strings(value, key))
      if (!sets.has(source)) sets.set(source, `ag_members_${sets.size}`)
      expressions.push(`entity in ${sets.get(source)}`)
    } else if (key === "domain") {
      expressions.push(`entity.split('.')[0] in ${JSON.stringify(strings(value, key))}`)
    } else if (key === "entity_id") {
      expressions.push(match("entity", value as Selection))
    } else if (key === "device_class") {
      expressions.push(match("state_attr(entity, 'device_class')", value as Selection))
    } else if (key === "hidden") {
      expressions.push(value ? "is_hidden_entity(entity)" : "not is_hidden_entity(entity)")
    } else if (key === "state") {
      expressions.push(match("states(entity)", value as Selection))
    } else if (key === "name") {
      expressions.push(match("entity_name(entity, fallback=true)", value as Selection))
    } else if (key === "attributes") {
      for (const [attribute, pattern] of Object.entries(value as Record<string, Selection>)) {
        expressions.push(match(`state_attr(entity, ${literal(attribute)})`, pattern))
      }
    } else if (key === "all" || key === "any") {
      expressions.push(
        join(
          (value as Filter[]).map((f) => predicate(f, sets)),
          key === "all" ? "and" : "or"
        )
      )
    } else if (key === "not") {
      expressions.push(`not ${predicate(value as Filter, sets)}`)
    }
  }
  return join(expressions, "and")
}

// A restriction in an AND branch is a safe candidate set. Restrictions under OR/NOT aren't.
function candidates(filter: Filter): string {
  for (const key of ["area", "device", "label", "floor"] as const) {
    if (filter[key] !== undefined) return membership(key, strings(filter[key], key))
  }
  if (filter.entity_id !== undefined) {
    const ids = strings(filter.entity_id, "entity_id")
    if (ids.every((id) => entityId.test(id))) return JSON.stringify(ids)
  }
  for (const child of filter.all ?? []) {
    const source = candidates(child)
    if (source !== "states | map(attribute='entity_id') | list") return source
  }
  if (filter.domain !== undefined) {
    return `(${strings(filter.domain, "domain")
      .map((d) => `(states.${d} | map(attribute='entity_id') | list)`)
      .join(" + ")})`
  }
  return "states | map(attribute='entity_id') | list"
}

function sortValue(sort: Sort, group: number): string {
  switch (sort.by) {
    case "include":
      return String(group)
    case "entity_id":
      return "entity"
    case "name":
      return "entity_name(entity, fallback=true)"
    case "state":
      return "states(entity)"
    case "last_changed":
      return "as_timestamp(states[entity].last_changed)"
    case "last_updated":
      return "as_timestamp(states[entity].last_updated)"
    case "attribute":
      return `state_attr(entity, ${literal(sort.attribute!)})`
  }
}

function validateSort(sort: Sort): void {
  object(sort, "sort")
  if (Object.keys(sort).some((k) => !sortKeys.has(k))) throw new Error("Unknown sort option")
  if (
    ![
      "include",
      "entity_id",
      "name",
      "state",
      "last_changed",
      "last_updated",
      "attribute",
    ].includes(sort.by)
  ) {
    throw new Error("Unknown sort.by")
  }
  if (sort.by === "attribute" && (typeof sort.attribute !== "string" || !sort.attribute)) {
    throw new Error("sort.attribute is required when sorting by attribute")
  }
  for (const key of ["numeric", "reverse"] as const) {
    if (sort[key] !== undefined && typeof sort[key] !== "boolean")
      throw new Error(`sort.${key} must be a boolean`)
  }
}

const defaultSort: Sort[] = [{ by: "include" }, { by: "name" }]

function numericSort(sort: Sort): boolean {
  return sort.numeric === true || ["include", "last_changed", "last_updated"].includes(sort.by)
}

function compileQuery(
  includes: Filter[],
  excludes: Filter[],
  sorts: Sort[],
  limit?: number
): string {
  const sets = new Map<string, string>()
  const exclusion = join(
    excludes.map((filter) => predicate(filter, sets)),
    "or"
  )
  const groups = includes.map((filter, group) => {
    const condition = predicate(filter, sets)
    const source = candidates(filter)
    const values = sorts.map((sort, index) => {
      const value = sortValue(sort, group)
      const prepared = numericSort(sort)
        ? `(${value} | float(none))`
        : `(${value} | default('', true) | string)`
      return `'sort${index}': ${prepared}`
    })
    const fields = [`'entity': entity`, `'group': ${group}`, ...values].join(", ")
    return [
      `{% for entity in (${sets.get(source) ?? source}) | unique | list %}`,
      `{% if entity not in ns.seen and states[entity] is defined and states[entity] is not none and ${condition} and not ${exclusion} %}`,
      `{% set ns.seen = ns.seen + [entity] %}`,
      `{% set ns.rows = ns.rows + [{${fields}}] %}`,
      "{% endif %}",
      "{% endfor %}",
    ].join("\n")
  })
  const lines = [...sets].map(([expression, name]) => `{% set ${name} = ${expression} %}`)
  lines.push("{% set ns = namespace(rows=[], seen=[]) %}", ...groups)
  if (sorts.length) {
    // Stable least-significant-first sorts preserve higher-priority keys and deterministic ties.
    lines.push("{% set ns.rows = ns.rows | sort(attribute='entity') %}")
    for (let i = sorts.length - 1; i >= 0; i--) {
      const sort = sorts[i]
      if (numericSort(sort)) {
        lines.push(
          `{% set valid = ns.rows | rejectattr('sort${i}', 'none') | list %}`,
          `{% set missing = ns.rows | selectattr('sort${i}', 'none') | list %}`,
          `{% set ns.rows = (valid | sort(attribute='sort${i}', reverse=${sort.reverse ? "true" : "false"})) + missing %}`
        )
      } else {
        lines.push(
          `{% set ns.rows = ns.rows | sort(attribute='sort${i}', reverse=${sort.reverse ? "true" : "false"}) %}`
        )
      }
    }
  }
  // Only the winning group and ID cross the wire; sort values and card configuration stay local.
  lines.push(
    "{% set result = namespace(rows=[]) %}",
    `{% for row in ns.rows${limit === undefined ? "" : `[:${limit}]`} %}`,
    "{% set result.rows = result.rows + [{'entity': row.entity, 'group': row.group}] %}",
    "{% endfor %}",
    "{{ result.rows }}"
  )
  return lines.join("\n")
}

export function normalizeMatches(value: unknown, groupCount: number): QueryMatch[] {
  if (!Array.isArray(value))
    throw new Error("The entity query must return a list of entity/group matches")
  const seen = new Set<string>()
  const matches: QueryMatch[] = []
  for (const row of value) {
    object(row, "Query match")
    if (
      typeof row.entity !== "string" ||
      !entityId.test(row.entity) ||
      typeof row.group !== "number" ||
      !Number.isInteger(row.group) ||
      row.group < 0 ||
      row.group >= groupCount
    ) {
      throw new Error("Invalid entity ID or include group in query result")
    }
    if (!seen.has(row.entity)) {
      seen.add(row.entity)
      matches.push({ entity: row.entity, group: row.group })
    }
  }
  return matches
}

function filters<T extends Filter>(value: T | T[], name: string): T[] {
  const result = Array.isArray(value) ? value : [value]
  for (const filter of result) object(filter, name)
  return result
}

function validateCard(card: unknown): asserts card is Partial<CardConfig> {
  object(card, "card")
  if ("entity" in card) throw new Error("card.entity is supplied by the query")
  if ("type" in card && (typeof card.type !== "string" || !card.type.trim())) {
    throw new Error("card.type must be a non-empty string")
  }
}

export function normalizeConfig(input: AutoGridConfig): GridConfig {
  object(input, "Auto Grid configuration")
  const config = structuredClone(input)
  for (const old of ["filter", "entities", "options"]) {
    if (old in config)
      throw new Error(`${old} is no longer supported; use include/exclude and card`)
  }
  if (config.columns !== undefined && (!Number.isInteger(config.columns) || config.columns < 1)) {
    throw new Error("columns must be a positive integer")
  }
  if (config.limit !== undefined && (!Number.isInteger(config.limit) || config.limit < 0)) {
    throw new Error("limit must be a non-negative integer")
  }
  for (const key of ["square", "show_empty"] as const) {
    if (config[key] !== undefined && typeof config[key] !== "boolean")
      throw new Error(`${key} must be a boolean`)
  }
  if (config.include === undefined) throw new Error("include is required")
  const includes = filters<Include>(config.include, "include")
  const excludes = config.exclude === undefined ? [] : filters(config.exclude, "exclude")
  const card: CardConfig = { type: "tile" }
  if (config.card !== undefined) {
    validateCard(config.card)
    Object.assign(card, config.card)
  }
  const includeFilters: Filter[] = []
  const cards = includes.map((include) => {
    const { card: override, ...filter } = include
    validateFilter(filter)
    includeFilters.push(filter)
    if (override !== undefined) validateCard(override)
    return { ...card, ...override }
  })
  excludes.forEach((exclude) => validateFilter(exclude))
  const sorts =
    config.sort === undefined
      ? defaultSort
      : Array.isArray(config.sort)
        ? config.sort
        : [config.sort]
  sorts.forEach(validateSort)
  return {
    columns: config.columns ?? 2,
    square: config.square ?? false,
    show_empty: config.show_empty ?? false,
    card,
    query: { template: compileQuery(includeFilters, excludes, sorts, config.limit), cards },
  }
}

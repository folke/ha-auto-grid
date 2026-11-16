import type { AutoGridConfig, Filter, GridConfig, Pattern, Selection, Sort } from "./types.ts"

const entityId = /^[a-z0-9_]+\.[a-z0-9_]+$/
const domain = /^[a-z0-9_]+$/
const filterKeys = new Set([
  "area",
  "floor",
  "device",
  "label",
  "domain",
  "entity_id",
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
    if (["area", "floor", "device", "label", "domain", "entity_id"].includes(key)) {
      const values = strings(value, key)
      if (key === "domain" && values.some((v) => !domain.test(v))) {
        throw new Error("domain must contain valid domain names, not patterns")
      }
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
    } else if (key === "state") {
      expressions.push(match("states(entity)", value as Selection))
    } else if (key === "name") {
      expressions.push(match("states[entity].name", value as Selection))
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

function sortValue(sort: Sort): string {
  switch (sort.by) {
    case "entity_id":
      return "entity"
    case "name":
      return "states[entity].name"
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
    !["entity_id", "name", "state", "last_changed", "last_updated", "attribute"].includes(sort.by)
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

function finishTemplate(source: string, condition: string, sort?: Sort, limit?: number): string {
  if (sort) validateSort(sort)
  const value = sort ? sortValue(sort) : "entity"
  const numeric = sort?.numeric || sort?.by === "last_changed" || sort?.by === "last_updated"
  const prepared = numeric ? `(${value} | float(none))` : `(${value} | default('', true) | string)`
  const lines = [
    "{% set ns = namespace(rows=[]) %}",
    `{% for entity in (${source}) | unique | list %}`,
    `{% if states[entity] is defined and states[entity] is not none and ${condition} %}`,
    `{% set ns.rows = ns.rows + [{'entity': entity, 'value': ${prepared}}] %}`,
    "{% endif %}",
    "{% endfor %}",
  ]
  if (sort) {
    // Missing/non-numeric values stay last in either direction.
    lines.push(
      "{% set valid = ns.rows | rejectattr('value', 'none') | list %}",
      "{% set missing = ns.rows | selectattr('value', 'none') | list %}",
      `{% set ns.rows = (valid | sort(attribute='value', reverse=${sort.reverse ? "true" : "false"})) + missing %}`
    )
  }
  lines.push(
    "{% set result = ns.rows | map(attribute='entity') | list %}",
    limit === undefined ? "{{ result }}" : `{{ result[:${limit}] }}`
  )
  return lines.join("\n")
}

export function compileFilter(filter: Filter, sort?: Sort, limit?: number): string {
  validateFilter(filter)
  const sets = new Map<string, string>()
  const condition = predicate(filter, sets)
  const source = candidates(filter)
  const bindings = [...sets].map(([expression, name]) => `{% set ${name} = ${expression} %}`)
  return [...bindings, finishTemplate(sets.get(source) ?? source, condition, sort, limit)].join(
    "\n"
  )
}

export function normalizeEntities(result: unknown): string[] {
  if (!Array.isArray(result) || result.some((v) => typeof v !== "string" || !entityId.test(v))) {
    throw new Error(
      "The entity query must return a list of entity IDs, not card configurations or text"
    )
  }
  return [...new Set(result as string[])]
}

export function normalizeConfig(input: AutoGridConfig): GridConfig {
  object(input, "Auto Grid configuration")
  const config = structuredClone(input)
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
  if ((config.entities !== undefined) === (config.filter !== undefined)) {
    throw new Error("Specify exactly one of entities or filter")
  }
  if (config.options !== undefined) object(config.options, "options")
  if (config.options?.entity !== undefined)
    throw new Error("options.entity is supplied by the query")
  if (
    config.options?.type !== undefined &&
    (typeof config.options.type !== "string" || !config.options.type)
  ) {
    throw new Error("options.type must be a non-empty string")
  }
  const result: GridConfig = {
    columns: config.columns ?? 2,
    square: config.square ?? false,
    show_empty: config.show_empty ?? false,
    options: { type: "tile", ...config.options },
  }
  if (config.filter !== undefined) {
    result.template = compileFilter(config.filter, config.sort, config.limit)
  } else if (typeof config.entities === "string") {
    if (!config.entities.includes("{{") && !config.entities.includes("{%")) {
      throw new Error("entities must be a Jinja template or a list of entity IDs")
    }
    if (config.sort !== undefined || config.limit !== undefined) {
      throw new Error("For a custom template, apply sorting and limits inside the template")
    }
    result.template = config.entities
  } else {
    const entities = normalizeEntities(config.entities)
    if (config.sort)
      result.template = finishTemplate(JSON.stringify(entities), "true", config.sort, config.limit)
    else result.entities = config.limit === undefined ? entities : entities.slice(0, config.limit)
  }
  return result
}

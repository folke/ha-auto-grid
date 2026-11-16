export type CardConfig = { type: string; entity?: string; [key: string]: unknown }

export interface LovelaceCard extends HTMLElement {
  hass: HomeAssistant
  preview?: boolean
  layout?: string
  getCardSize?(): number | Promise<number>
}

export interface TemplateResult {
  result?: unknown
  error?: string | { message?: string }
}

export interface Connection {
  sendMessagePromise?<T>(message: Record<string, unknown>): Promise<T>
  subscribeMessage<T>(
    callback: (message: T) => void,
    message: Record<string, unknown>
  ): Promise<() => void | Promise<void>>
}

export interface HomeAssistant {
  connection: Connection
  states: Record<string, unknown>
}

export type Pattern = string | number | boolean | null
export type Selection = Pattern | Pattern[]

export interface Filter {
  area?: string | string[]
  floor?: string | string[]
  device?: string | string[]
  label?: string | string[]
  domain?: string | string[]
  entity_id?: string | string[]
  type?: string | string[]
  hidden?: boolean
  state?: Selection
  name?: Selection
  last_changed?: Selection
  last_updated?: Selection
  integration?: string | string[]
  [attribute: `attr.${string}`]: Selection
  all?: Filter[]
  any?: Filter[]
  not?: Filter | Filter[]
}

export type FilterField = keyof Omit<Filter, "all" | "any" | "not">
export type Include = Filter & { group?: string; card?: Partial<CardConfig> }

export type Field = "group" | FilterField
export type SortField = Field

export interface Group {
  by?: Field
  title?: string
}

export interface GroupConfig {
  by: Field
  title: string
}

export interface Sort {
  by?: SortField
  numeric?: boolean
  reverse?: boolean
}

export interface AutoGridConfig {
  type?: string
  title?: string
  columns?: number | "auto"
  square?: boolean
  show_empty?: boolean
  card?: Partial<CardConfig>
  include: Include | Include[]
  exclude?: Filter | Filter[]
  group?: boolean | Field | Group
  sort?: Sort | SortField | (Sort | SortField)[]
  limit?: number
  [key: string]: unknown
}

export interface QueryMatch {
  entity: string
  group: number
}

export type GroupValue =
  | null
  | boolean
  | number
  | string
  | GroupValue[]
  | { [key: string]: GroupValue }

export interface QuerySection {
  key: string
  value: GroupValue
  title: string
  matches: QueryMatch[]
}

export interface QueryResult {
  matches: QueryMatch[]
  sections?: QuerySection[]
}

export interface CompiledQuery {
  template: string
  cards: CardConfig[]
  group?: GroupConfig
}

export interface GridConfig {
  title?: string
  columns: number | "auto"
  square: boolean
  show_empty: boolean
  card: CardConfig
  query: CompiledQuery
}

export interface CardHelpers {
  createCardElement(config: CardConfig): LovelaceCard | Promise<LovelaceCard>
}

declare global {
  interface Window {
    loadCardHelpers?: () => Promise<CardHelpers>
    customCards?: { type: string; name: string; description: string; preview: boolean }[]
  }
}

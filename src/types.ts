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
  device_class?: string | string[] // short-hand for attributes.device_class
  hidden?: boolean
  state?: Selection
  name?: Selection
  attributes?: Record<string, Selection>
  all?: Filter[]
  any?: Filter[]
  not?: Filter
}

export type Include = Filter & { card?: Partial<CardConfig> }
export type Exclude = Filter

export interface Sort {
  by: "include" | "entity_id" | "name" | "state" | "last_changed" | "last_updated" | "attribute"
  attribute?: string
  numeric?: boolean
  reverse?: boolean
}

export interface AutoGridConfig {
  type?: string
  title?: string
  columns?: number
  square?: boolean
  show_empty?: boolean
  card?: Partial<CardConfig>
  include: Include | Include[]
  exclude?: Exclude | Exclude[]
  sort?: Sort | Sort[]
  limit?: number
  [key: string]: unknown
}

export interface QueryMatch {
  entity: string
  group: number
}

export interface CompiledQuery {
  template: string
  cards: CardConfig[]
}

export interface GridConfig {
  title?: string
  columns: number
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

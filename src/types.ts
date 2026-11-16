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
  state?: Selection
  name?: Selection
  attributes?: Record<string, Selection>
  all?: Filter[]
  any?: Filter[]
  not?: Filter
}

export interface Sort {
  by: "entity_id" | "name" | "state" | "last_changed" | "last_updated" | "attribute"
  attribute?: string
  numeric?: boolean
  reverse?: boolean
}

export interface AutoGridConfig {
  type?: string
  columns?: number
  square?: boolean
  show_empty?: boolean
  options?: Partial<CardConfig>
  entities?: string | string[]
  filter?: Filter
  sort?: Sort
  limit?: number
  [key: string]: unknown
}

export interface GridConfig {
  columns: number
  square: boolean
  show_empty: boolean
  options: CardConfig
  entities?: string[]
  template?: string
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

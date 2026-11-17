import { normalizeConfig as normalize } from "../src/query.ts"
import type {
  AutoGridConfig,
  CardConfig,
  Connection,
  LovelaceCard,
  QueryMatch,
} from "../src/types.ts"

// YAML/backend fixtures enter through an unknown-value boundary, like real HA input.
export function normalizeConfig(value: unknown) {
  return normalize(value as AutoGridConfig)
}

export type Dispose = () => void | Promise<void>
export type Message = Record<string, unknown>
export type Callback = (value: unknown) => void
export type Request = { callback: Callback; request: Message; closed?: boolean }
export type TestCard = LovelaceCard & { config: CardConfig }

// Controller tests only need the card contract, not a live DOM element.
export function testCard(config: CardConfig): TestCard {
  return { config } as TestCard
}

export function testConnection(value: object = {}): Connection {
  return value as Connection
}

export interface Rendered<T = QueryMatch[]> {
  result: T
  calls: Record<string, number>
  state_reads: string[]
  lifecycle_reads: number
}
export function rendered<T = QueryMatch[]>(text: string): Rendered<T>[] {
  return JSON.parse(text) as Rendered<T>[]
}

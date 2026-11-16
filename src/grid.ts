import { normalizeEntities } from "./query.ts"
import { subscribeTemplate } from "./subscriptions.ts"
import type { CardConfig, GridConfig, HomeAssistant, LovelaceCard } from "./types.ts"

type CreateCard = (config: CardConfig) => Promise<LovelaceCard>

export class GridController {
  cards: { entity: string; card: LovelaceCard }[] = []
  loading = true
  error?: string

  private config?: GridConfig
  private hass?: HomeAssistant
  private active = false
  private dispose?: () => void
  private revision = 0
  private selection?: string[]
  private cache = new Map<string, LovelaceCard>()
  private create: CreateCard
  private changed: () => void

  constructor(create: CreateCard, changed: () => void) {
    this.create = create
    this.changed = changed
  }

  configure(config: GridConfig): void {
    const queryChanged =
      this.config?.template !== config.template ||
      JSON.stringify(this.config?.entities) !== JSON.stringify(config.entities)
    const optionsChanged = JSON.stringify(this.config?.options) !== JSON.stringify(config.options)
    this.config = config
    if (optionsChanged) this.cache.clear()
    if (queryChanged) {
      this.selection = undefined
      this.restart()
    } else if (optionsChanged && this.selection && this.active && this.hass) {
      void this.select(this.selection)
    } else {
      this.changed()
    }
  }

  setHass(hass: HomeAssistant): void {
    const connectionChanged = this.hass?.connection !== hass.connection
    this.hass = hass
    if (this.active) {
      for (const { card } of this.cards) card.hass = hass
    }
    if (connectionChanged) this.restart()
  }

  connect(): void {
    this.active = true
    if (this.hass) for (const { card } of this.cards) card.hass = this.hass
    this.restart()
  }

  disconnect(): void {
    this.active = false
    this.subscriptionToken++
    this.revision++
    this.dispose?.()
    this.dispose = undefined
  }

  retry(): void {
    this.restart()
  }

  private restart(): void {
    this.revision++
    this.dispose?.()
    this.dispose = undefined
    if (!this.active || !this.config || !this.hass) return
    const token = ++this.subscriptionToken
    this.loading = true
    this.error = undefined
    this.changed()
    if (this.config.entities) {
      void this.select(this.config.entities)
    } else {
      this.dispose = subscribeTemplate(this.hass.connection, this.config.template!, {
        result: (value) => {
          if (this.active && this.subscriptionToken === token) void this.select(value)
        },
        error: (error) => {
          if (this.active && this.subscriptionToken === token) this.fail(error)
        },
      })
    }
  }

  private subscriptionToken = 0

  private async select(value: unknown): Promise<void> {
    const revision = ++this.revision
    try {
      const ids = normalizeEntities(value)
      this.selection = ids
      if (
        ids.length === this.cards.length &&
        ids.every((id, i) => id === this.cards[i].entity) &&
        ids.every((id) => this.cache.has(id))
      ) {
        const changed = this.loading || this.error !== undefined
        this.loading = false
        this.error = undefined
        if (changed) this.changed()
        return
      }
      const options = this.config!.options
      const cards = await Promise.all(
        ids.map(async (entity) => {
          const existing = this.cache.get(entity)
          const card = existing ?? (await this.create({ ...structuredClone(options), entity }))
          return { entity, card }
        })
      )
      if (!this.active || revision !== this.revision) return
      for (const { card } of cards) card.hass = this.hass!
      this.cache = new Map(cards.map(({ entity, card }) => [entity, card]))
      this.cards = cards
      this.loading = false
      this.error = undefined
      this.changed()
    } catch (error) {
      if (this.active && revision === this.revision) this.fail(error)
    }
  }

  private fail(error: unknown): void {
    this.revision++
    this.loading = false
    this.error = error instanceof Error ? error.message : String(error)
    this.changed()
  }
}

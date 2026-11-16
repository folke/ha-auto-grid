import { normalizeMatches } from "./query.ts"
import { subscribeTemplate } from "./subscriptions.ts"
import type { CardConfig, GridConfig, HomeAssistant, LovelaceCard, QueryMatch } from "./types.ts"

type CreateCard = (config: CardConfig) => Promise<LovelaceCard>
type GridCard = QueryMatch & { card: LovelaceCard; configKey: string }

export class GridController {
  cards: GridCard[] = []
  loading = true
  error?: string

  private config?: GridConfig
  private hass?: HomeAssistant
  private active = false
  private dispose?: () => void
  private revision = 0
  private subscriptionToken = 0
  private selection?: QueryMatch[]
  private cache = new Map<string, GridCard>()
  private create: CreateCard
  private changed: () => void

  constructor(create: CreateCard, changed: () => void) {
    this.create = create
    this.changed = changed
  }

  configure(config: GridConfig): void {
    const queryChanged = this.config?.query.template !== config.query.template
    const cardsChanged =
      JSON.stringify(this.config?.query.cards) !== JSON.stringify(config.query.cards)
    this.config = config
    if (queryChanged) {
      this.selection = undefined
      this.restart()
    } else if (cardsChanged && this.selection && this.active && this.hass) {
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
    this.dispose = subscribeTemplate(this.hass.connection, this.config.query.template, {
      result: (value) => {
        if (this.active && this.subscriptionToken === token) void this.select(value)
      },
      error: (error) => {
        if (this.active && this.subscriptionToken === token) this.fail(error)
      },
    })
  }

  private async select(value: unknown): Promise<void> {
    const revision = ++this.revision
    try {
      const matches = normalizeMatches(value, this.config!.query.cards.length)
      this.selection = matches
      const requests = matches.map((match) => {
        const config = this.config!.query.cards[match.group]
        return { ...match, config, configKey: JSON.stringify(config) }
      })
      const unchanged =
        requests.length === this.cards.length &&
        requests.every(
          (request, i) =>
            request.entity === this.cards[i].entity && request.configKey === this.cards[i].configKey
        )
      if (unchanged) {
        const changed = this.loading || this.error !== undefined
        this.loading = false
        this.error = undefined
        // A different include can have the same effective card configuration.
        this.cards.forEach((card, i) => {
          card.group = matches[i].group
        })
        if (changed) this.changed()
        return
      }
      const cards = await Promise.all(
        requests.map(async ({ entity, group, config, configKey }) => {
          const existing = this.cache.get(entity)
          const card =
            existing?.configKey === configKey
              ? existing.card
              : await this.create({ ...structuredClone(config), entity })
          return { entity, group, card, configKey }
        })
      )
      if (!this.active || revision !== this.revision) return
      for (const { card } of cards) card.hass = this.hass!
      this.cache = new Map(cards.map((entry) => [entry.entity, entry]))
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

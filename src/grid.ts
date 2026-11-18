import { normalizeResult } from "./query.ts"
import { compileHeadingOptions, validateHeading } from "./heading.ts"
import { renderCardOptions } from "./card-templates.ts"
import { subscribeTemplate } from "./subscriptions.ts"
import type {
  CardConfig,
  GridConfig,
  HomeAssistant,
  LovelaceCard,
  QueryMatch,
  QueryResult,
  GroupValue,
} from "./types.ts"

type CreateCard = (config: CardConfig) => Promise<LovelaceCard>
type GridCard = QueryMatch & { card: LovelaceCard; configKey: string; cardType: string }
export type GridSection = {
  key: string
  value: GroupValue
  title: string
  heading: CardConfig
  cards: GridCard[]
}

export class GridController {
  cards: GridCard[] = []
  sections?: GridSection[]
  private sectionSignature?: string
  loading = true
  error?: string
  heading?: CardConfig
  headingError?: string

  private config?: GridConfig
  private hass?: HomeAssistant
  private active = false
  private dispose?: () => void
  private disposeHeading?: () => void
  private headingToken = 0
  private revision = 0
  private subscriptionToken = 0
  private selection?: unknown
  private cache = new Map<string, GridCard>()
  private create: CreateCard
  private changed: () => void

  constructor(create: CreateCard, changed: () => void) {
    this.create = create
    this.changed = changed
  }

  configure(config: GridConfig): void {
    const queryChanged =
      this.config?.query.template !== config.query.template ||
      JSON.stringify(this.config.query.registries) !== JSON.stringify(config.query.registries)
    const cardsChanged =
      JSON.stringify([this.config?.query.cards, this.config?.query.templates]) !==
      JSON.stringify([config.query.cards, config.query.templates])
    const headingChanged = JSON.stringify(this.config?.heading) !== JSON.stringify(config.heading)
    this.config = config
    if (headingChanged) this.restartHeading()
    if (queryChanged) {
      this.selection = undefined
      this.restart()
    } else if (cardsChanged && this.selection !== undefined && this.active && this.hass) {
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
    if (connectionChanged) {
      this.restartHeading()
      this.restart()
    }
  }

  connect(): void {
    this.active = true
    if (this.hass) for (const { card } of this.cards) card.hass = this.hass
    this.restartHeading()
    this.restart()
  }

  disconnect(): void {
    this.active = false
    this.headingToken++
    this.disposeHeading?.()
    this.disposeHeading = undefined
    this.subscriptionToken++
    this.revision++
    this.dispose?.()
    this.dispose = undefined
  }

  retry(): void {
    this.restartHeading()
    this.restart()
  }

  private restartHeading(): void {
    const token = ++this.headingToken
    this.disposeHeading?.()
    this.disposeHeading = undefined
    this.headingError = undefined
    const plan = this.config?.heading ? compileHeadingOptions(this.config.heading) : undefined
    this.heading = plan?.card
    if (!plan?.templates.length || !this.active || !this.hass) {
      this.changed()
      return
    }
    const template = [
      ...plan.templates.map(
        ({ source }, index) => `{% macro ag_heading_${index}() -%}${source}{%- endmacro %}`
      ),
      `[${plan.templates.map((_, index) => `{{ ag_heading_${index}() | trim | to_json }}`).join(", ")}]`,
    ].join("\n")
    const valid = () => this.active && this.headingToken === token
    const fail = (error: unknown) => {
      if (!valid()) return
      this.headingError = error instanceof Error ? error.message : String(error)
      this.changed()
    }
    this.disposeHeading = subscribeTemplate(
      this.hass.connection,
      template,
      {
        error: fail,
        refresh: () => {
          if (!valid()) return
          this.headingError = undefined
          this.changed()
        },
        result: (values) => {
          if (!valid()) return
          try {
            if (!Array.isArray(values) || values.some((value) => typeof value !== "string"))
              throw new Error("Heading template values must be strings")
            const heading = validateHeading(
              renderCardOptions(plan.card, plan.templates, values as string[])
            )
            const changed =
              this.headingError !== undefined ||
              JSON.stringify(heading) !== JSON.stringify(this.heading)
            this.heading = heading
            this.headingError = undefined
            if (changed) this.changed()
          } catch (error) {
            fail(error)
          }
        },
      },
      { config: plan.context },
      {
        registries: ["entity", "device", "area", "floor", "label", "integration"],
      }
    )
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
    const connection = this.hass.connection
    const query = this.config.query
    this.dispose = subscribeTemplate(
      connection,
      query.template,
      {
        error: (error) => {
          if (this.active && this.subscriptionToken === token) this.fail(error)
        },
        refresh: () => {
          if (!this.active || this.subscriptionToken !== token) return
          this.revision++
          this.loading = true
          this.error = undefined
          this.changed()
        },
        result: (value) => {
          if (this.active && this.subscriptionToken === token) void this.select(value)
        },
      },
      undefined,
      { integrationNames: query.group?.by === "integration", registries: query.registries }
    )
  }

  private async select(value: unknown): Promise<void> {
    const revision = ++this.revision
    try {
      const result = normalizeResult(value, this.config!)
      const matches = result.matches
      this.selection = value
      const signature = JSON.stringify(result.sections)
      const requests = matches.map((match) => {
        const config = renderCardOptions(
          this.config!.query.cards[match.group],
          this.config!.query.templates[match.group],
          match.values,
          match.entity
        )
        return { ...match, config, configKey: JSON.stringify(config) }
      })
      const unchanged =
        requests.length === this.cards.length &&
        requests.every(
          (request, i) =>
            request.entity === this.cards[i].entity && request.configKey === this.cards[i].configKey
        )
      if (unchanged) {
        const changed =
          this.loading || this.error !== undefined || this.sectionSignature !== signature
        this.loading = false
        this.error = undefined
        // A different include can have the same effective card configuration.
        this.cards.forEach((card, i) => {
          card.group = matches[i].group
        })
        this.setSections(result, signature)
        if (changed) this.changed()
        return
      }
      const cards = await Promise.all(
        requests.map(async ({ entity, group, config, configKey }) => {
          const existing = this.cache.get(entity)
          const update =
            existing !== undefined &&
            existing.configKey !== configKey &&
            existing.cardType === config.type &&
            typeof existing.card.setConfig === "function"
          const card =
            existing && (existing.configKey === configKey || update)
              ? existing.card
              : await this.create(structuredClone(config))
          return { card, cardType: config.type, config, configKey, entity, group, update }
        })
      )
      if (!this.active || revision !== this.revision) return
      for (const { card, update, config } of cards) {
        if (update) card.setConfig!(structuredClone(config))
        card.hass = this.hass!
      }
      this.cards = cards.map(({ entity, group, card, configKey, cardType }) => ({
        card,
        cardType,
        configKey,
        entity,
        group,
      }))
      this.cache = new Map(this.cards.map((entry) => [entry.entity, entry]))
      this.setSections(result, signature)
      this.loading = false
      this.error = undefined
      this.changed()
    } catch (error) {
      if (this.active && revision === this.revision) this.fail(error)
    }
  }

  private setSections(result: QueryResult, signature: string | undefined): void {
    this.sectionSignature = signature
    this.sections = result.sections?.map((section) => ({
      cards: section.matches.map(({ entity }) => this.cache.get(entity)!),
      heading: section.heading,
      key: section.key,
      title: section.title,
      value: section.value,
    }))
  }

  private fail(error: unknown): void {
    this.revision++
    this.loading = false
    this.error = error instanceof Error ? error.message : String(error)
    this.changed()
  }
}

import { LitElement, css, html, nothing } from "lit"
import { AutoCardEditor, prepareEditor } from "./editor.ts"
import { validateCardOptions } from "./card-templates.ts"
import { headingConfig, visibleHeading } from "./heading.ts"
import { loadHelpers } from "./helpers.ts"
import { subscribeCardOptions } from "./standalone-templates.ts"
import type { TemplateSubscription } from "./subscriptions.ts"
import type {
  AutoCardConfig,
  CardConfig,
  CardGridOptions,
  HomeAssistant,
  LovelaceCard,
} from "./types.ts"

type Slot = {
  source?: CardConfig
  rendered?: CardConfig
  element?: LovelaceCard
  signature?: string
  subscription?: TemplateSubscription
  generation: number
  revision: number
  error?: string
}

export function normalizeAutoCard(input: unknown): { card: CardConfig; heading?: CardConfig } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Auto Card configuration must be an object")
  const config = input as AutoCardConfig
  validateCardOptions(config.card, false)
  if (!config.card.type && !config.card.$type) throw new Error("card.type is required")
  return {
    card: structuredClone(config.card) as CardConfig,
    heading: headingConfig({ $heading: config.$heading, heading: config.heading }),
  }
}

export class AutoCard extends LitElement {
  private slots: Slot[] = [
    { generation: 0, revision: 0 },
    { generation: 0, revision: 0 },
  ]
  private currentHass?: HomeAssistant
  private currentPreview = false
  private currentLayout?: string
  private sizeRevision = 0
  private reportedSize?: string

  static async getConfigElement(): Promise<HTMLElement> {
    await prepareEditor()
    return new AutoCardEditor()
  }

  static getStubConfig(): AutoCardConfig {
    return { card: { entity: "sun.sun", type: "tile" } }
  }

  setConfig(input: AutoCardConfig): void {
    const config = normalizeAutoCard(input)
    for (const [index, source] of [config.card, config.heading].entries()) {
      const slot = this.slots[index]
      if (JSON.stringify(slot.source) === JSON.stringify(source)) continue
      slot.source = source
      this.restart(index)
    }
  }

  set hass(hass: HomeAssistant) {
    const changed = this.currentHass?.connection !== hass.connection
    this.currentHass = hass
    for (const slot of this.slots) if (slot.element) slot.element.hass = hass
    if (changed && this.isConnected) this.slots.forEach((_, index) => this.restart(index))
  }
  get hass(): HomeAssistant | undefined {
    return this.currentHass
  }
  set preview(value: boolean) {
    this.currentPreview = value
    for (const slot of this.slots) if (slot.element) slot.element.preview = value
  }
  get preview(): boolean {
    return this.currentPreview
  }
  set layout(value: string | undefined) {
    this.currentLayout = value
    for (const slot of this.slots) if (slot.element) slot.element.layout = value
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.slots.forEach((_, index) => this.restart(index))
  }
  disconnectedCallback(): void {
    for (const slot of this.slots) {
      slot.subscription?.()
      slot.subscription = undefined
      slot.generation++
      slot.revision++
    }
    this.sizeRevision++
    super.disconnectedCallback()
  }

  private restart(index: number): void {
    const slot = this.slots[index]
    const generation = ++slot.generation
    slot.revision++
    slot.subscription?.()
    slot.subscription = undefined
    slot.error = undefined
    if (!slot.source) {
      slot.element = undefined
      slot.rendered = undefined
      slot.signature = undefined
      this.changed()
      return
    }
    if (!this.isConnected || !this.currentHass) return
    this.changed()
    slot.subscription = subscribeCardOptions(
      this.currentHass.connection,
      slot.source,
      {
        error: (error) => {
          if (generation !== slot.generation) return
          slot.revision++
          slot.error = error.message
          this.changed()
        },
        refresh: () => {
          if (generation !== slot.generation) return
          slot.revision++
          slot.error = undefined
          this.changed()
        },
        result: (config) => {
          if (generation === slot.generation) void this.updateSlot(index, config)
        },
      },
      index === 1
    )
  }

  private async updateSlot(index: number, config: CardConfig): Promise<void> {
    const slot = this.slots[index]
    const revision = ++slot.revision
    const signature = JSON.stringify(config)
    try {
      if (index === 1 && !visibleHeading(config)) {
        slot.element = undefined
      } else if (slot.element && slot.signature === signature && !slot.error) {
        return
      } else if (slot.element?.setConfig && slot.rendered?.type === config.type) {
        slot.element.setConfig(structuredClone(config))
      } else {
        const helpers = await loadHelpers()
        if (!this.isConnected || revision !== slot.revision) return
        const element = await helpers.createCardElement(structuredClone(config))
        // Configuration or connection may change while helpers create the child.
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (!this.isConnected || revision !== slot.revision) return
        slot.element = element
      }
      slot.rendered = config
      slot.signature = signature
      slot.error = undefined
      if (slot.element) {
        slot.element.hass = this.currentHass!
        slot.element.preview = this.currentPreview
        slot.element.layout = this.currentLayout
      }
      this.changed()
    } catch (error) {
      if (!this.isConnected || revision !== slot.revision) return
      slot.error = error instanceof Error ? error.message : String(error)
      this.changed()
    }
  }

  private retry(): void {
    for (const [index, slot] of this.slots.entries()) {
      if (slot.subscription) slot.subscription.retry()
      else this.restart(index)
    }
  }

  async getCardSize(): Promise<number> {
    let size = 1
    try {
      size = (await this.slots[0].element?.getCardSize?.()) ?? 1
    } catch {
      /* A failing size hint must not break its wrapper. */
    }
    return size + (this.slots[1].element ? 1 : 0)
  }

  getGridOptions(): CardGridOptions {
    const slot = this.slots[0]
    const explicit = slot.rendered?.grid_options
    let native: CardGridOptions = {}
    try {
      native = slot.element?.getGridOptions?.() ?? {}
    } catch {
      /* Custom cards may not provide a usable sizing hint. */
    }
    const options = {
      ...native,
      ...(explicit && typeof explicit === "object" && !Array.isArray(explicit) ? explicit : {}),
    }
    if (!this.slots[1].element) return options
    return {
      ...options,
      rows: typeof options.rows === "number" ? options.rows + 1 : "auto",
      ...(typeof options.min_rows === "number" ? { min_rows: options.min_rows + 1 } : {}),
      ...(typeof options.max_rows === "number" ? { max_rows: options.max_rows + 1 } : {}),
    }
  }

  private changed(): void {
    this.requestUpdate()
    const revision = ++this.sizeRevision
    void this.updateComplete.then(async () => {
      const size = await this.getCardSize()
      if (!this.isConnected || revision !== this.sizeRevision) return
      const signature = JSON.stringify([size, this.getGridOptions()])
      if (signature === this.reportedSize) return
      this.reportedSize = signature
      this.dispatchEvent(new CustomEvent("card-size-changed", { bubbles: true, composed: true }))
      this.dispatchEvent(new CustomEvent("card-updated", { bubbles: true, composed: true }))
    })
  }

  protected render() {
    const error = this.slots.find((slot) => slot.error)?.error
    if (error)
      return html`<ha-card
        ><div class="message" role="alert">
          ${error}<button @click=${() => this.retry()}>Retry</button>
        </div></ha-card
      >`
    return html`${this.slots[1].element ? html`<div class="heading">${this.slots[1].element}</div>` : nothing}
      <div class="content">
        ${this.slots[0].element ?? html`<ha-card><div class="message" role="status">Loading card…</div></ha-card>`}
      </div>`
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .content {
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
    .content > * {
      display: block;
      height: 100%;
    }
    .heading {
      margin-bottom: var(--auto-grid-gap, var(--grid-card-gap, 8px));
    }
    .message {
      padding: 16px;
    }
    button {
      display: block;
      margin-top: 12px;
    }
  `
}

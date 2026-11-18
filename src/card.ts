import { LitElement, css, html, nothing } from "lit"
import { repeat } from "lit/directives/repeat.js"
import { GridController } from "./grid.ts"
import { AutoGridEditor, prepareEditor } from "./editor.ts"
import { normalizeConfig } from "./query.ts"
import { visibleHeading } from "./heading.ts"
import type {
  AutoGridConfig,
  CardConfig,
  CardHelpers,
  GridConfig,
  HomeAssistant,
  LovelaceCard,
} from "./types.ts"

type HeadingEntry = { signature: string; card?: LovelaceCard; error?: string }

let helpers: Promise<CardHelpers> | undefined
function loadHelpers(): Promise<CardHelpers> {
  helpers ??= Promise.resolve()
    .then(() => {
      if (!window.loadCardHelpers) throw new Error("Home Assistant card helpers are not available")
      return window.loadCardHelpers()
    })
    .catch((error: unknown) => {
      helpers = undefined
      throw error
    })
  return helpers
}

export class AutoGrid extends LitElement {
  private config?: GridConfig
  private currentHass?: HomeAssistant
  private currentPreview = false
  private currentLayout?: string
  private sizeUpdate = 0
  private reportedSize = 0
  private headings = new Map<string, HeadingEntry>()
  private grid = new GridController(
    async (config) => {
      const cardHelpers = await loadHelpers()
      const card = await cardHelpers.createCardElement(config)
      card.preview = this.currentPreview
      card.layout = this.currentLayout
      return card
    },
    () => this.gridChanged()
  )

  static async getConfigElement(): Promise<HTMLElement> {
    await prepareEditor()
    return new AutoGridEditor()
  }

  static getStubConfig(): AutoGridConfig {
    return { card: { type: "tile" }, columns: 2, include: { type: "light" } }
  }

  setConfig(config: AutoGridConfig): void {
    this.config = normalizeConfig(config)
    if (this.config.columns === "auto") this.style.removeProperty("--auto-grid-columns")
    else this.style.setProperty("--auto-grid-columns", String(this.config.columns))
    this.toggleAttribute("square", this.config.square)
    this.grid.configure(this.config)
    this.gridChanged()
  }

  set hass(hass: HomeAssistant) {
    this.currentHass = hass
    for (const { card } of this.headings.values()) if (card?.isConnected) card.hass = hass
    this.grid.setHass(hass)
  }

  get hass(): HomeAssistant | undefined {
    return this.currentHass
  }

  set preview(preview: boolean) {
    this.currentPreview = preview
    for (const { card } of this.grid.cards) card.preview = preview
    for (const { card } of this.headings.values()) if (card) card.preview = preview
    this.gridChanged()
  }

  get preview(): boolean {
    return this.currentPreview
  }

  set layout(layout: string | undefined) {
    this.currentLayout = layout
    for (const { card } of this.grid.cards) card.layout = layout
    for (const { card } of this.headings.values()) if (card) card.layout = layout
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.grid.connect()
  }

  disconnectedCallback(): void {
    for (const [key, entry] of this.headings) if (!entry.card) this.headings.delete(key)
    this.grid.disconnect()
    super.disconnectedCallback()
  }

  get connectedWhileHidden(): boolean {
    return this.hideEmpty
  }

  private get hideEmpty(): boolean {
    return (
      this.config?.show_empty === false &&
      !this.currentPreview &&
      !this.grid.error &&
      !this.grid.headingError &&
      !this.headingError &&
      !this.grid.cards.length
    )
  }

  private get headingError(): string | undefined {
    if (visibleHeading(this.grid.heading) && this.headings.get("main")?.error)
      return this.headings.get("main")!.error
    const sections = this.grid.sections ?? []
    if (sections.length > 1)
      for (const section of sections) {
        const error = this.headings.get(`group:${section.key}`)?.error
        if (visibleHeading(section.heading) && error) return error
      }
    return undefined
  }

  private syncHeadings(): void {
    const desired = new Map<string, CardConfig>()
    const known = new Set<string>()
    if (visibleHeading(this.grid.heading)) {
      known.add("main")
      desired.set("main", this.grid.heading!)
    }
    const sections = this.grid.sections ?? []
    for (const section of sections) {
      const key = `group:${section.key}`
      known.add(key)
      if (sections.length > 1 && visibleHeading(section.heading)) desired.set(key, section.heading)
    }
    for (const key of this.headings.keys()) if (!known.has(key)) this.headings.delete(key)
    for (const [key, config] of desired) {
      const signature = JSON.stringify(config)
      const previous = this.headings.get(key)
      if (previous?.card && this.currentHass) previous.card.hass = this.currentHass
      if (previous?.signature === signature) continue
      if (previous?.card?.setConfig) {
        previous.signature = signature
        try {
          previous.card.setConfig(structuredClone(config))
          previous.error = undefined
        } catch (error) {
          previous.error = String((error as Partial<Error> | null | undefined)?.message ?? error)
        }
        continue
      }
      const entry: HeadingEntry = { signature }
      this.headings.set(key, entry)
      void loadHelpers()
        .then((cardHelpers) => cardHelpers.createCardElement(structuredClone(config)))
        .then((card) => {
          if (this.headings.get(key) !== entry) return
          entry.card = card
          if (this.currentHass) card.hass = this.currentHass
          card.preview = this.currentPreview
          card.layout = this.currentLayout
          this.gridChanged()
        })
        .catch((error: unknown) => {
          if (this.headings.get(key) !== entry) return
          entry.error = String((error as Partial<Error> | null | undefined)?.message ?? error)
          this.gridChanged()
        })
    }
  }

  private gridChanged(): void {
    this.syncHeadings()
    const empty = this.hideEmpty
    const visibilityChanged = this.hidden !== empty
    this.hidden = empty
    this.toggleAttribute("empty", empty)
    // HA collapses its layout wrapper; connectedWhileHidden keeps empty queries alive.
    if (visibilityChanged)
      this.dispatchEvent(
        new CustomEvent("card-visibility-changed", {
          bubbles: true,
          composed: true,
          detail: { value: !empty },
        })
      )
    this.requestUpdate()
    const update = ++this.sizeUpdate
    void this.updateComplete.then(async () => {
      if (!this.isConnected || update !== this.sizeUpdate) return
      const size = await this.getCardSize()
      // The card may disconnect while its children's sizes are pending.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (!this.isConnected || update !== this.sizeUpdate) return
      this.dispatchEvent(new CustomEvent("card-size-changed", { bubbles: true, composed: true }))
      if (size !== this.reportedSize) {
        this.reportedSize = size
        // Masonry listens for card-updated, not card-size-changed.
        this.dispatchEvent(new CustomEvent("card-updated", { bubbles: true, composed: true }))
      }
    })
  }

  async getCardSize(): Promise<number> {
    const configuredColumns = this.config?.columns ?? 2
    const cards = this.grid.cards
    const sections = this.grid.sections ?? [{ cards, heading: undefined, title: "" }]
    const sizes = await Promise.all(
      cards.map(async ({ card }) => {
        try {
          return (await card.getCardSize?.()) ?? 1
        } catch {
          return 1
        }
      })
    )
    const byEntity = new Map(cards.map(({ entity }, i) => [entity, sizes[i]]))
    let size = 0
    for (const section of sections) {
      const columns =
        configuredColumns === "auto" ? Math.max(1, section.cards.length) : configuredColumns
      if (sections.length > 1 && visibleHeading(section.heading)) size++
      const heights = section.cards.map(({ entity }) => byEntity.get(entity) ?? 1)
      for (let i = 0; i < heights.length; i += columns)
        size += Math.max(...heights.slice(i, i + columns))
    }
    const contentSize = size || (this.hideEmpty ? 0 : 1)
    return (
      contentSize +
      (contentSize && visibleHeading(this.grid.heading) ? 1 : 0) +
      (this.currentPreview && this.config?.warnings.length ? 1 : 0)
    )
  }

  getGridOptions(): { columns: number; rows: string; min_columns: number } {
    return { columns: 12, min_columns: 3, rows: "auto" }
  }

  protected render() {
    if (this.hideEmpty) return nothing
    return html`${
      this.currentPreview && this.config?.warnings.length
        ? html`<ha-alert alert-type="warning" title="Configuration warnings">
            <ul>
              ${this.config.warnings.map((warning) => html`<li><code>${warning.path}</code>: ${warning.message}</li>`)}
            </ul>
          </ha-alert>`
        : nothing
    }${
      visibleHeading(this.grid.heading)
        ? html`<div class="card-header">${this.headings.get("main")?.card ?? nothing}</div>`
        : nothing
    }${this.renderContent()}`
  }

  private renderContent() {
    const error = this.grid.error ?? this.grid.headingError ?? this.headingError
    if (error) {
      return html`<ha-card
        ><div class="message" role="alert">
          <strong>Auto Grid</strong>
          <div>${error}</div>
          <button
            @click=${() => {
              if (this.headingError) {
                for (const [key, entry] of this.headings) if (entry.error) this.headings.delete(key)
                this.gridChanged()
              } else this.grid.retry()
            }}
          >
            Retry
          </button>
        </div></ha-card
      >`
    }
    if (!this.grid.cards.length) {
      return html`<ha-card
        ><div class="message" role="status">
          ${this.grid.loading ? "Loading entities…" : "No matching entities"}
        </div></ha-card
      >`
    }
    const sections = this.grid.sections ?? [
      {
        cards: this.grid.cards,
        heading: { type: "heading" },
        key: "ungrouped",
        title: "",
        value: null,
      },
    ]
    return html`${repeat(
      sections,
      ({ key }) => key,
      (section) =>
        html` <section class="section">
          ${sections.length > 1 && visibleHeading(section.heading) ? html`<div class="group-header">${this.headings.get(`group:${section.key}`)?.card ?? nothing}</div>` : nothing}
          <div
            class="grid"
            style=${this.config?.columns === "auto" ? `--auto-grid-columns: ${section.cards.length}` : nothing}
          >
            ${repeat(
              section.cards,
              ({ entity }) => entity,
              ({ card }) => html`<div class="cell">${card}</div>`
            )}
          </div>
        </section>`
    )} `
  }

  static styles = css`
    :host {
      display: block;
    }
    :host([empty]) {
      /* Parent grids can force display:block on children across the shadow boundary. */
      display: none !important;
    }
    ha-alert {
      display: block;
      margin-bottom: var(--auto-grid-gap, var(--grid-card-gap, 8px));
    }
    ha-alert ul {
      margin: 0;
      padding-left: 20px;
    }
    .card-header {
      margin-bottom: var(--auto-grid-gap, var(--grid-card-gap, 8px));
    }
    .section + .section {
      margin-top: 16px;
    }
    .group-header {
      margin-bottom: var(--auto-grid-gap, var(--grid-card-gap, 8px));
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(var(--auto-grid-columns, 2), minmax(0, 1fr));
      gap: var(--auto-grid-gap, var(--grid-card-gap, 8px));
    }
    .cell {
      min-width: 0;
    }
    .cell > * {
      display: block;
      height: 100%;
    }
    :host([square]) .cell {
      aspect-ratio: 1;
    }
    .message {
      padding: 16px;
      color: var(--primary-text-color);
    }
    .message > div {
      margin-top: 8px;
    }
    button {
      margin-top: 12px;
      padding: 8px 16px;
      border: 1px solid var(--divider-color, #888);
      border-radius: 8px;
      background: transparent;
      color: var(--primary-color);
      cursor: pointer;
      font: inherit;
    }
  `
}

import { LitElement, css, html, nothing } from "lit"
import { repeat } from "lit/directives/repeat.js"
import { GridController } from "./grid.ts"
import { normalizeConfig } from "./query.ts"
import type { AutoGridConfig, CardHelpers, GridConfig, HomeAssistant } from "./types.ts"

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
  private grid = new GridController(
    async (config) => {
      const card = await (await loadHelpers()).createCardElement(config)
      card.preview = this.currentPreview
      card.layout = this.currentLayout
      return card
    },
    () => this.gridChanged()
  )

  static getStubConfig(): AutoGridConfig {
    return { columns: 2, include: { type: "light" }, card: { type: "tile" } }
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
    this.grid.setHass(hass)
  }

  get hass(): HomeAssistant | undefined {
    return this.currentHass
  }

  set preview(preview: boolean) {
    this.currentPreview = preview
    for (const { card } of this.grid.cards) card.preview = preview
    this.gridChanged()
  }

  get preview(): boolean {
    return this.currentPreview
  }

  set layout(layout: string | undefined) {
    this.currentLayout = layout
    for (const { card } of this.grid.cards) card.layout = layout
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.grid.connect()
  }

  disconnectedCallback(): void {
    this.grid.disconnect()
    super.disconnectedCallback()
  }

  private gridChanged(): void {
    const empty = !this.grid.loading && !this.grid.error && !this.grid.cards.length
    // Don't set `hidden`: HA removes hidden cards from the DOM, preventing query recovery.
    this.toggleAttribute(
      "empty",
      empty && this.config?.show_empty === false && !this.currentPreview
    )
    this.requestUpdate()
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      this.dispatchEvent(new CustomEvent("card-size-changed", { bubbles: true, composed: true }))
    })
  }

  async getCardSize(): Promise<number> {
    const configuredColumns = this.config?.columns ?? 2
    const cards = this.grid.cards
    const sections = this.grid.sections ?? [{ title: "", cards }]
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
      if (sections.length > 1 && section.title) size++
      const heights = section.cards.map(({ entity }) => byEntity.get(entity) ?? 1)
      for (let i = 0; i < heights.length; i += columns)
        size += Math.max(...heights.slice(i, i + columns))
    }
    const contentSize =
      size ||
      (this.config?.show_empty === false &&
      !this.grid.loading &&
      !this.grid.error &&
      !this.currentPreview
        ? 0
        : 1)
    return contentSize + (contentSize && this.config?.title ? 1 : 0)
  }

  getGridOptions(): { columns: number; rows: string; min_columns: number } {
    return { columns: 12, rows: "auto", min_columns: 3 }
  }

  protected render() {
    if (
      !this.grid.error &&
      !this.grid.loading &&
      !this.grid.cards.length &&
      this.config?.show_empty === false &&
      !this.currentPreview
    )
      return nothing
    return html`${
      this.config?.title ? html`<h1 class="card-header">${this.config.title}</h1>` : nothing
    }${this.renderContent()}`
  }

  private renderContent() {
    if (this.grid.error) {
      return html`<ha-card
        ><div class="message" role="alert">
          <strong>Auto Grid</strong>
          <div>${this.grid.error}</div>
          <button @click=${() => this.grid.retry()}>Retry</button>
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
    const sections = this.grid.sections ?? [{ key: "ungrouped", title: "", cards: this.grid.cards }]
    return html`${repeat(
      sections,
      ({ key }) => key,
      (section) =>
        html` <section class="section">
          ${sections.length > 1 && section.title ? html`<h2 class="group-header">${section.title}</h2>` : nothing}
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
      display: none;
    }
    .card-header {
      color: var(--ha-card-header-color, var(--primary-text-color));
      text-align: var(--ha-stack-title-text-align, start);
      font-family: var(--ha-card-header-font-family, inherit);
      font-size: var(--ha-card-header-font-size, var(--ha-font-size-2xl, 24px));
      font-weight: var(--ha-font-weight-normal, 400);
      margin-block: 0;
      letter-spacing: -0.012em;
      line-height: var(--ha-line-height-condensed, 1.2);
      display: block;
      padding: 24px 16px 16px;
    }
    .section + .section {
      margin-top: 16px;
    }
    .group-header {
      color: var(--secondary-text-color);
      font-size: var(--ha-font-size-m, 16px);
      font-weight: var(--ha-font-weight-medium, 500);
      line-height: var(--ha-line-height-normal, 1.5);
      margin: 0;
      padding: 8px;
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

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
    return { columns: 2, filter: { domain: "light" }, options: { type: "tile" } }
  }

  setConfig(config: AutoGridConfig): void {
    this.config = normalizeConfig(config)
    this.style.setProperty("--auto-grid-columns", String(this.config.columns))
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
    const columns = this.config?.columns ?? 2
    const sizes = await Promise.all(
      this.grid.cards.map(async ({ card }) => {
        try {
          return (await card.getCardSize?.()) ?? 1
        } catch {
          return 1
        }
      })
    )
    let size = 0
    for (let i = 0; i < sizes.length; i += columns) size += Math.max(...sizes.slice(i, i + columns))
    return (
      size || (this.config?.show_empty === false && !this.grid.loading && !this.grid.error ? 0 : 1)
    )
  }

  getGridOptions(): { columns: number; rows: string; min_columns: number } {
    return { columns: 12, rows: "auto", min_columns: 3 }
  }

  protected render() {
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
      return this.config?.show_empty === false && !this.grid.loading && !this.currentPreview
        ? nothing
        : html` <ha-card
            ><div class="message" role="status">
              ${this.grid.loading ? "Loading entities…" : "No matching entities"}
            </div></ha-card
          >`
    }
    return html`<div class="grid">
      ${repeat(
        this.grid.cards,
        ({ entity }) => entity,
        ({ card }) => html`<div class="cell">${card}</div>`
      )}
    </div>`
  }

  static styles = css`
    :host {
      display: block;
    }
    :host([empty]) {
      display: none;
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

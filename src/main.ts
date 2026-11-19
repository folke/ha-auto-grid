import { AutoGrid } from "./card.ts"
import { AutoCard } from "./auto-card.ts"
import { version } from "../package.json"

if (!customElements.get("auto-card")) {
  customElements.define("auto-card", AutoCard)
  window.customCards ??= []
  window.customCards.push({
    description: "Backend Jinja templates for any Home Assistant card",
    name: "Auto Card",
    preview: true,
    type: "auto-card",
  })
}

if (!customElements.get("auto-grid")) {
  customElements.define("auto-grid", AutoGrid)
  window.customCards ??= []
  window.customCards.push({
    description: "An automatically populated grid of Home Assistant cards",
    name: "Auto Grid",
    preview: true,
    type: "auto-grid",
  })
  // oxlint-disable-next-line no-console
  console.info(`%cAuto Grid v${version} is installed`, "color: blue; font-weight: bold")
}

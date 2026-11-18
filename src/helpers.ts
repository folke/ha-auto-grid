import type { CardHelpers } from "./types.ts"

let helpers: Promise<CardHelpers> | undefined
export function loadHelpers(): Promise<CardHelpers> {
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

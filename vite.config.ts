import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "auto-grid.js",
    },
    rolldownOptions: {
      output: {
        comments: { legal: false },
      },
    },
  },
})

# 🤝 Contributing

Thanks for helping improve Auto Grid!

For configuration and examples, start with the [README](README.md). The
[Internals](docs/internals.md) guide explains query compilation, subscriptions,
card reconciliation, and editor behavior. Release automation is documented in
[Releases](docs/releases.md).

## ⚡️ Requirements

- Node.js **22.18+** for native TypeScript test imports.
- The pnpm version declared in `package.json`.
- Python 3 with **Jinja2** to run the generated-template tests. These tests are
  skipped when Jinja2 is unavailable, so install it when changing the query compiler.
- Chromium for browser tests; set `CHROME_BIN` if the executable is not `chromium`.

## 🚀 Getting Started

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:browser
```

`pnpm watch` rebuilds the bundle as source files change. The output is
`dist/auto-grid.js`, including Lit and the visual editor. There are no CDN imports
or required companion integrations.

## 🧪 Testing

- **Types:** `pnpm check` checks production and test code. `pnpm check:tests` runs
  the strict test configuration separately, including erasable-syntax checks.
- **Unit/integration tests:** `pnpm test` runs `.test.ts` files directly with
  `node:test`. Native type stripping does not typecheck; keep the separate check.
- **Generated Jinja:** the Python harness executes compiled queries in a sandbox
  with mocked Home Assistant helpers.
- **Browser tests:** `pnpm test:browser` builds the bundle and runs rendering and
  editor suites in Chromium. They cover card reuse, state-only updates, empty-state
  recovery, editor delegation, selection drafts, errors, and cleanup.

The backend, card helpers, and native HA editor components are mocked in automated
tests. Also test changes in a live Home Assistant dashboard, especially changes to
native editor components or template metadata dependencies.

## 🛠️ Making Changes

- Keep selection in the backend. Ordinary `hass` updates must not filter entities,
  clone card options, reconfigure children, or rebuild the grid.
- Preserve child-card identity when membership/order changes, unless the effective
  card configuration requires a replacement.
- Cover subscription cleanup and stale asynchronous work when changing lifecycle code.
- Add runtime-validation tests for malformed YAML and backend results, not just
  valid TypeScript inputs.
- Keep user-facing behavior in the README and implementation details in
  `docs/internals.md`.

Use `pnpm format` to format changes. Release Please owns `CHANGELOG.md` and
`.github/release-please-manifest.json`; do not reformat those generated files.

Use conventional commit messages, for example `feat: add ...`, `fix: handle ...`,
or `docs: explain ...`. Release Please uses these messages to build release notes.

## 🏠 Local Deployment

Build with `pnpm build`, then copy `dist/auto-grid.js` to a Home Assistant test
installation and register it as a JavaScript module. See the
[installation instructions](README.md#-installation). Hard-refresh the browser
after updating the file; remove any stale `auto-grid.js.gz` sibling if your local
setup created one.

A maintainer-specific `justfile` is intentionally git-ignored. If you have one,
check its host and destination before deploying: `just` / `just build` builds and
copies the bundle, `just check` runs local checks, and `just watch` rebuilds without
deploying. Contributors do not need a `justfile` to build or test the project.

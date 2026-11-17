# Changelog

## 0.1.0 (2026-11-17)


### ⚠ BREAKING CHANGES

* add section-style grouping with templated headings
* unify attribute notation and support negated filter lists
* add include groups and prioritized backend sorting

### Features

* add backend-powered auto grid card ([537338c](https://github.com/folke/ha-auto-grid/commit/537338ccb8347ffc96484893d6922c3afd393104))
* add boolean hidden entity filter ([496947b](https://github.com/folke/ha-auto-grid/commit/496947bb2f8d936b8dbdd4668cc343ddb3ba25fe))
* add collapsible visual editor with inline selection YAML ([4a58c2f](https://github.com/folke/ha-auto-grid/commit/4a58c2f07b1f1b8c06bbfb566d5548095365493f))
* add include groups and prioritized backend sorting ([c6a6a97](https://github.com/folke/ha-auto-grid/commit/c6a6a971b45af5dc3c9bc3dcd59f1df0bec55ad1))
* add integration and timestamp filters with shared field values ([0fad552](https://github.com/folke/ha-auto-grid/commit/0fad55211d582a166451aac9855cbb5dd453e7f6))
* add section-style grouping with templated headings ([25f61ad](https://github.com/folke/ha-auto-grid/commit/25f61ad74a498154caeecbead9c024b335ecbc2d))
* added `Filter.type` in favor of `Filter.device_class` ([1f531df](https://github.com/folke/ha-auto-grid/commit/1f531dfa4f8400aca4a1ad238afb1ad4d948c552))
* added support for templated yaml fields `$some_field` ([e566985](https://github.com/folke/ha-auto-grid/commit/e56698592dedde0e27dce823e72d69443afc2a64))
* added title option ([e982983](https://github.com/folke/ha-auto-grid/commit/e982983f39ba3d00f461a741a53c9056d9031992))
* **filter:** `Filter.entity_id` can now also be a json list ([254e956](https://github.com/folke/ha-auto-grid/commit/254e956706cb86e09690adaef15adc9c0dd8aba9))
* **layout:** added `columns: auto`, similar to a `horizontal-stack` card ([205981b](https://github.com/folke/ha-auto-grid/commit/205981b3f0a989c5865ecd492d1e5b4ecbd9ea4f))
* prettify domain and type group titles ([902c9ba](https://github.com/folke/ha-auto-grid/commit/902c9baa094d1e618c690f578000d57f4dca2692))
* **query:** added support for matching device names ([358ea9d](https://github.com/folke/ha-auto-grid/commit/358ea9d215e59e6fab1a21ef6a099f16c0be3a6a))
* refresh backend queries on relevant registry changes ([8170f99](https://github.com/folke/ha-auto-grid/commit/8170f998afa7de1c56d501fa2da81014a7ca81ac))
* render native heading cards with a dedicated editor panel ([b20e964](https://github.com/folke/ha-auto-grid/commit/b20e964f47b6ad8fae56ab5f32752443de269cd6))
* support string and mixed-list sort shorthand ([dde8217](https://github.com/folke/ha-auto-grid/commit/dde821765f230eb915bc1d33f839143163dec8c8))
* unify attribute notation and support negated filter lists ([b9cd761](https://github.com/folke/ha-auto-grid/commit/b9cd761da3757eb49db4f847818e655c4312c910))


### Bug Fixes

* don't show loading indicator when `show_empty: false` ([773cf40](https://github.com/folke/ha-auto-grid/commit/773cf405368e1a3ff06b86b548744dda854bf50d))
* notify Masonry when grid size changes ([bc8cbfe](https://github.com/folke/ha-auto-grid/commit/bc8cbfe2bcaa0058235a33feb1fd22bb0bcc48bc))
* use registry-aware entity names for filtering and sorting ([3751d2e](https://github.com/folke/ha-auto-grid/commit/3751d2ed8d9b93db8682a3565707b71b18e92d7a))

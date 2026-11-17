import { defineConfig } from "oxlint"

export default defineConfig({
  categories: {
    correctness: "error",
    perf: "warn",
    style: "warn",
    suspicious: "warn",
    // "pedantic": "warn",
    // "restriction": "error"
    // "nursery": "error"
  },
  env: {
    web: true,
  },
  options: {
    reportUnusedDisableDirectives: "warn",
    typeAware: true,
    typeCheck: true,
  },
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
  rules: {
    "capitalized-comments": "off", // 98
    curly: "off", // 154
    eqeqeq: ["error", "always", { null: "ignore" }],
    "func-style": "off", // 58
    "id-length": "off", // 185
    "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
    "import/exports-last": "off", // 41
    "import/group-exports": "off", // 106
    "import/no-cycle": ["error"],
    "import/no-duplicates": "error",
    "import/no-named-as-default-member": "error",
    "import/no-named-export": "off", // 165
    "import/no-namespace": ["error", { ignore: ["node:*"] }],
    "import/no-nodejs-modules": "off",
    "import/prefer-default-export": "off", // 10
    "init-declarations": "off", // 4
    "max-params": "off",
    "max-statements": "off", // 26
    "new-cap": [
      "warn",
      { capIsNewExceptionPattern: String.raw`(Intl|Value|Type|Schema|compiled\w*)\.` },
    ],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-continue": "off", // 24
    "no-control-regex": "off", // 2
    "no-duplicate-imports": ["warn", { allowSeparateTypeImports: true }], // 16
    "no-implicit-coercion": "off", // 4
    "no-generated-empty-object-type": "off",
    "no-labels": "off", // 4
    "no-magic-numbers": "off", // 278
    "no-ternary": "off",
    "no-underscore-dangle": "off", // 4
    "no-unnecessary-type-assertion": "off", // way too many false positives
    "no-unused-vars": "warn",
    "no-warning-comments": ["warn", { location: "start", terms: ["todo", "fixme", "bug"] }],
    "one-var": "off",
    "oxc/no-barrel-file": "off",
    "oxc/no-map-spread": "off",
    "prefer-destructuring": "off", // 3
    "prefer-named-capture-group": "off",
    "prefer-template": "warn",
    "sort-imports": "off", // 64
    "sort-keys": ["warn", "asc", { caseSensitive: true, natural: false }],
    "typescript/consistent-return": "off",
    "typescript/consistent-type-definitions": "off", // 32
    "typescript/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
    "typescript/no-deprecated": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unnecessary-condition": "error",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/parameter-properties": "off", // 20
    "typescript/prefer-nullish-coalescing": ["error", { ignoreConditionalTests: true }],
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-readonly": "off", // 22
    "typescript/prefer-regexp-exec": "off", // 6
    "typescript/strict-boolean-expressions": "off",
    "unicorn/consistent-function-scoping": "off",
    "unicorn/max-nested-calls": "off",
    "unicorn/no-array-sort": "off",
    "unicorn/no-array-reverse": "off",
    "unicorn/no-null": "off",
    "unicorn/number-literal-case": "off", // disable, since oxfmt formats number literals in lowercase
    "unicorn/prefer-global-this": "off",
    "unicorn/prefer-module": "error",
    "unicorn/prefer-node-protocol": "error",
  },
  overrides: [
    {
      files: ["!src/**/*.ts"],
      rules: {
        "eslint/no-await-in-loop": "off",
        "eslint/no-console": "off",
        "eslint/sort-keys": "off",
        "no-restricted-imports": "off",
      },
    },
    {
      files: ["tests/**/*.{ts,mjs}"],
      env: { node: true, web: false },
      rules: {
        // node:test owns the lifecycle and failures of registered tests.
        "typescript/no-floating-promises": [
          "error",
          { allowForKnownSafeCalls: [{ from: "package", name: "test", package: "node" }] },
        ],
      },
    },
  ],
})

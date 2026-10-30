import { defineConfig } from "oxlint";

// Match initializer nodes directly: an object containing a callback is still ordinary data.
const functions = [
  "function",
  {
    selector:
      ':matches(ExportNamedDeclaration, ExportDefaultDeclaration)[declaration.type="FunctionDeclaration"]',
  },
  {
    selector: 'VariableDeclaration:has(> VariableDeclarator[init.type="ArrowFunctionExpression"])',
  },
  {
    selector:
      'ExportNamedDeclaration:has(> VariableDeclaration > VariableDeclarator[init.type="ArrowFunctionExpression"])',
  },
  {
    selector: 'VariableDeclaration:has(> VariableDeclarator[init.type="FunctionExpression"])',
  },
  {
    selector:
      'ExportNamedDeclaration:has(> VariableDeclaration > VariableDeclarator[init.type="FunctionExpression"])',
  },
  {
    selector: 'ExportDefaultDeclaration[declaration.type="ArrowFunctionExpression"]',
  },
  {
    selector:
      'VariableDeclaration:has(> VariableDeclarator[init.type="CallExpression"][init.callee.name="useCallback"])',
  },
  {
    selector:
      'ExportNamedDeclaration:has(> VariableDeclaration > VariableDeclarator[init.type="CallExpression"][init.callee.name="useCallback"])',
  },
];
const overloads = [
  "function-overload",
  {
    selector:
      ':matches(ExportNamedDeclaration, ExportDefaultDeclaration)[declaration.type="TSDeclareFunction"]',
  },
];
const declarations = [
  "function",
  {
    selector:
      ':matches(ExportNamedDeclaration, ExportDefaultDeclaration)[declaration.type="FunctionDeclaration"]',
  },
];
export default defineConfig({
  plugins: ["typescript", "react", "jsx-a11y", "unicorn"],
  jsPlugins: ["eslint-plugin-boundaries", "@stylistic/eslint-plugin"],
  settings: {
    "boundaries/include": ["apps/desktop/src/**/*"],
    "boundaries/elements": [
      {
        type: "app",
        pattern: "apps/desktop/src/app",
        partialMatch: false,
      },
      {
        type: "page",
        pattern: "apps/desktop/src/pages",
        partialMatch: false,
      },
      {
        type: "feature",
        pattern: "apps/desktop/src/features/*",
        partialMatch: false,
      },
      {
        type: "shared",
        pattern: "apps/desktop/src/shared/*",
        partialMatch: false,
      },
      {
        type: "bindings",
        pattern: "apps/desktop/src/bindings",
        partialMatch: false,
      },
      {
        type: "assets",
        pattern: "apps/desktop/src/assets",
        partialMatch: false,
      },
      {
        type: "entry",
        pattern: "apps/desktop/src",
        partialMatch: false,
      },
    ],
    "import/resolver": {
      typescript: {
        project: "apps/desktop/tsconfig.app.json",
      },
    },
  },
  categories: {
    correctness: "error",
  },
  rules: {
    "unicorn/filename-case": [
      "error",
      {
        case: "kebabCase",
      },
    ],
    "unicorn/no-new-array": "off",
    "boundaries/dependencies": [
      "error",
      {
        default: "disallow",
        message: "Cross-module imports must use the @/ alias.",
        policies: [
          {
            allow: {
              dependency: {
                source: "@/**",
              },
            },
          },
        ],
      },
    ],
    "@stylistic/padding-line-between-statements": [
      "error",
      { blankLine: "always", prev: "import", next: "*" },
      { blankLine: "any", prev: "import", next: "import" },
      { blankLine: "always", prev: "*", next: functions },
      { blankLine: "always", prev: functions, next: "*" },
      { blankLine: "always", prev: "*", next: overloads },
      { blankLine: "any", prev: overloads, next: [...overloads, ...declarations] },
    ],
    "@stylistic/lines-between-class-members": [
      "error",
      "always",
      {
        exceptAfterOverload: true,
      },
    ],
  },
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/src/bindings/**",
    "**/src-tauri/gen/**",
    "target/**",
  ],
});

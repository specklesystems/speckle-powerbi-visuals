/** @type {import("eslint").Linter.Config} */
const config = {
  root: true,
  parser: "babel-eslint",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  env: {
    node: true,
    commonjs: true
  },
  ignorePatterns: [
    "node_modules",
    "dist",
    "public",
    "events.json",
    ".*.{ts,js,vue,tsx,jsx}",
    "generated/**/*"
  ]
}

module.exports = config

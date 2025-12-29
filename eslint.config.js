// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const tseslint = require("typescript-eslint");

const expoFlatConfig = Array.isArray(expoConfig) ? expoConfig : [expoConfig];
const tsFilePatterns = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

const tsFlatConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: tsFilePatterns,
  languageOptions: {
    ...config.languageOptions,
    parserOptions: {
      ...(config.languageOptions?.parserOptions ?? {}),
      project: ["./tsconfig.eslint.json"],
      tsconfigRootDir: __dirname,
      errorOnTypeScriptSyntacticAndSemanticIssues: true,
    },
  },
}));

module.exports = defineConfig([
  ...expoFlatConfig,
  ...tsFlatConfigs,
  {
    files: tsFilePatterns,
    rules: {
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    ignores: ["dist/*", "node_modules/**"],
  },
]);

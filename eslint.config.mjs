import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "vendor/**", ".vscode-test/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.mts"],
  })),
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-misused-promises": ["error", { "checksVoidReturn": false }],
      "@typescript-eslint/no-floating-promises": "error"
    },
  },
  {
    files: ["src/webview/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  },
  {
    files: ["examples/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
        window: "readonly"
      }
    }
  }
);

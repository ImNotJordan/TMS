import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  /**
   * Tenant isolation guard.
   *
   * Twelve stores now reach their data through `/api/*`, where the server
   * derives the tenant from a verified token. Nothing in the type system stops
   * someone reintroducing a direct DynamoDB call — it would compile, pass
   * review on a busy day, and quietly reopen a cross-tenant read.
   *
   * So the build refuses it. `src/lib/api/**` and `src/lib/server/**` are the
   * only places allowed to speak DynamoDB, and `ScanCommand` is banned outright
   * for tenant data: a Scan reads every row and filters afterwards, which is
   * both the expensive way and the leaky way to answer a scoped question.
   *
   * If you need an exception, the honest move is to widen the allowlist below in
   * the same commit — visibly — rather than to disable the rule inline.
   */
  {
    files: ["src/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"],
    ignores: [
      // The enforcement layer itself, and the low-level client it builds on.
      "src/lib/api/**",
      "src/lib/server/**",
      "src/lib/dynamodb.ts",
      "src/lib/dynamo-entity-store.ts",
      "src/lib/loads-api-proxy.ts",
      "src/lib/driver-loads-proxy.ts",
      "src/lib/admin-company-proxy.ts",
      "src/lib/admin-users-proxy.ts",
      "src/lib/admin-role-proxy.ts",
      "src/lib/profile-proxy.ts",
      "src/lib/admin-audit-proxy.ts",
      "src/lib/admin-credentials-proxy.ts",
      // Reads that company's AvaTax credential from the server-only `secrets`
      // partition. No other tenant's key is in this row.
      "src/lib/tax-proxy.ts",
      // Stores and reads that company's China tax API credential in the
      // server-only `secrets` partition.
      "src/lib/settings-china-tax.ts",
      "src/lib/tenant/known-companies.ts",
      "src/lib/cognito-admin-core.ts",
      "src/lib/settings-proxy.ts",
      "src/lib/tracking-messages-proxy.ts",
      "src/lib/bidding-workspace-proxy.ts",
      // Server-side lane aggregation. Queries the company index with the
      // companyId taken from the verified token, never from the request — the
      // same shape as the loads proxy above.
      "src/lib/bidding-search-proxy.ts",
      "src/lib/ai/**",
      // Not yet migrated — each drops off this list as it moves behind the API.
      "src/lib/workspace-settings-store.ts",
      "src/lib/admin-users-store.ts",
      "apps/driver-portal/src/lib/dynamodb.ts",
      "apps/driver-portal/src/lib/aws-messages.ts",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@aws-sdk/lib-dynamodb",
              message:
                "Direct DynamoDB access bypasses tenant scoping. Use a store backed by the resource API (src/lib/api/api-backed-store.ts), or add the table to the resource registry.",
            },
            {
              name: "@aws-sdk/client-dynamodb",
              message:
                "Direct DynamoDB access bypasses tenant scoping. Use a store backed by the resource API (src/lib/api/api-backed-store.ts).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='ScanCommand']",
          message:
            "Scan is not a tenant boundary — it reads the whole table and filters afterwards. Query the companyId-index through the resource API instead.",
        },
        {
          selector: "CallExpression[callee.name='scanAllTableItems']",
          message:
            "Scan is not a tenant boundary. Query the companyId-index through the resource API instead.",
        },
      ],
    },
  },

  eslintPluginPrettier,
);

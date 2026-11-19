import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({
  baseDirectory: fileURLToPath(new URL(".", import.meta.url)),
});

// Next 15 的规则通过官方兼容入口加载；生成产物不作为源码检查。
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "output/**",
      "coverage/**",
      ".husky/**",
      "next-env.d.ts",
      "public/serviceWorker.js",
      "app/mcp/mcp_config.json",
      "app/mcp/mcp_config.default.json",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
];

export default config;

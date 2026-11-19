import { cp } from "node:fs/promises";

// standalone 服务的 public 与静态块遵循 Next.js 的独立部署目录约定。
const root = new URL("../../", import.meta.url);
await cp(new URL("public", root), new URL(".next/standalone/public", root), {
  recursive: true,
});
await cp(
  new URL(".next/static", root),
  new URL(".next/standalone/.next/static", root),
  { recursive: true },
);
await import(new URL(".next/standalone/server.js", root).href);

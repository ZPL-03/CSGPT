import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import webpack, { type Configuration, type Stats } from "webpack";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

test("ESLint flat config 检查 TSX Hooks 与 Next 页面规则", async () => {
  const eslint = new ESLint({ cwd: root });
  const filePath = "app/components/tooling-fixture.tsx";
  const [valid] = await eslint.lintText(
    'import { useState } from "react"; export function Fixture({ active }: { active: boolean }) { const [value] = useState(0); return <span>{active ? value : 0}</span>; }',
    { filePath },
  );
  assert.equal(valid.errorCount, 0);
  assert.equal(valid.warningCount, 0);
  const [invalid] = await eslint.lintText(
    'import { useState } from "react"; export function Fixture({ active }: { active: boolean }) { if (active) useState(0); return <img src="/fixture.png" />; }',
    { filePath },
  );
  for (const rule of [
    "react-hooks/rules-of-hooks",
    "@next/next/no-img-element",
    "jsx-a11y/alt-text",
  ]) {
    assert.ok(
      invalid.messages.some((message) => message.ruleId === rule),
      rule,
    );
  }
  assert.ok(invalid.messages.every((message) => !message.fatal));
});

test("Webpack 生产压缩与 Next 单块配置保留动态导入语义", async () => {
  const outputRoot = path.join(root, "output");
  await mkdir(outputRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(outputRoot, "tooling-"));
  const previousMode = process.env.BUILD_MODE;
  const previousDisable = process.env.DISABLE_CHUNK;
  try {
    // 合成模块覆盖动态分块和压缩，不使用项目数据或执行外部命令。
    await writeFile(
      path.join(fixture, "entry.mjs"),
      'export async function calculate() { return (await import("./value.mjs")).value; }',
    );
    await writeFile(
      path.join(fixture, "value.mjs"),
      'export const value = 6 * 7; if (false) throw new Error("UNREACHABLE_TOOLING_BRANCH");',
    );
    const variants = [
      { name: "default", mode: "standalone", disable: false, chunks: 2 },
      { name: "single", mode: "standalone", disable: true, chunks: 1 },
      { name: "export", mode: "export", disable: false, chunks: 1 },
    ] as const;
    for (const variant of variants) {
      process.env.BUILD_MODE = variant.mode;
      if (variant.disable) process.env.DISABLE_CHUNK = "1";
      else delete process.env.DISABLE_CHUNK;
      const configUrl = new URL("../next.config.mjs", import.meta.url);
      configUrl.searchParams.set("tooling", variant.name);
      const nextConfig = (await import(configUrl.href)).default;
      const output = path.join(fixture, variant.name);
      const config: Configuration = nextConfig.webpack({
        mode: "production",
        target: "node",
        context: fixture,
        entry: "./entry.mjs",
        output: {
          path: output,
          filename: "bundle.cjs",
          chunkFilename: "[id].cjs",
          library: { type: "commonjs2" },
        },
        module: { rules: [] },
        plugins: [],
        resolve: {},
        optimization: { minimize: true },
        devtool: false,
      });
      const compiler = webpack(config);
      try {
        const stats = await new Promise<Stats>((resolve, reject) =>
          compiler.run((error, result) => {
            if (error) reject(error);
            else if (!result) reject(new Error("Webpack 未返回编译结果"));
            else resolve(result);
          }),
        );
        assert.equal(stats.hasErrors(), false, stats.toString());
        assert.equal(stats.hasWarnings(), false, stats.toString());
        const bundles = (await readdir(output)).filter((f) =>
          f.endsWith(".cjs"),
        );
        assert.equal(bundles.length, variant.chunks);
        for (const file of bundles) {
          assert.doesNotMatch(
            await readFile(path.join(output, file), "utf8"),
            /UNREACHABLE_TOOLING_BRANCH/,
          );
        }
        assert.equal(
          await require(path.join(output, "bundle.cjs")).calculate(),
          42,
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          compiler.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  } finally {
    if (previousMode === undefined) delete process.env.BUILD_MODE;
    else process.env.BUILD_MODE = previousMode;
    if (previousDisable === undefined) delete process.env.DISABLE_CHUNK;
    else process.env.DISABLE_CHUNK = previousDisable;
    assert.equal(path.dirname(fixture), outputRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});

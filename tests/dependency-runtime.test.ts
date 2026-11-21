import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import katex from "katex";
import { micromark } from "micromark";
import { math, mathHtml } from "micromark-extension-math";
import mermaid from "mermaid";
import { remarkPlugins, rehypePlugins } from "../app/utils/markdown-plugins";
import { MarkdownTable } from "../app/components/markdown-table";
import { MarkdownTableCell } from "../app/components/markdown-table-cell";

const require = createRequire(import.meta.url);
const markdownStyles = readFileSync(
  new URL("../app/styles/markdown.scss", import.meta.url),
  "utf8",
);

// 数学文本使用页面相同的解析依赖；输出检查保留公式语义与信任边界。
function renderMarkdown(content: string) {
  return renderToStaticMarkup(
    createElement(function MarkdownFixture() {
      return ReactMarkdown({
        remarkPlugins,
        rehypePlugins,
        components: { table: MarkdownTable, td: MarkdownTableCell },
        children: content,
      });
    }),
  );
}

test("Markdown 数学解析保留行内公式、矩阵、表格和单位", () => {
  const inline = String.raw`A_{11}=135000\,\mathrm{N/mm}`;
  const matrix = String.raw`\begin{bmatrix}N\\M\end{bmatrix}=\begin{bmatrix}A&B\\B&D\end{bmatrix}\begin{bmatrix}\epsilon^0\\\kappa\end{bmatrix}`;
  const html = renderMarkdown(
    `刚度 $${inline}$。\n\n$$\n${matrix}\n$$\n\n| 层厚/mm | 层数 |\n| --- | --- |\n| 0.125 | 60 |`,
  );
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.ok(html.includes(inline));
  assert.ok(html.includes(matrix.replaceAll("&", "&amp;")));
  assert.match(html, /<mtable/);
  assert.match(html, /<th>层厚\/mm<\/th>/);
  assert.match(html, /<td>0\.125<\/td><td>60<\/td>/);
  assert.doesNotMatch(html, /class="katex-error"/);
});

test("长铺层序列按斜杠换行并保留完整括号", () => {
  const html = renderMarkdown(
    "| 编号 | 逐层角度（外到内） |\n| --- | --- |\n| TMP_1 | [0/45/-45/90/0/45/-45/90] |",
  );
  assert.match(html, /class="markdown-table-scroll"><table/);
  assert.match(html, /class="layup-sequence-cell"/);
  assert.match(html, /class="layup-sequence-angle">-45°<\/span>/);
  assert.equal((html.match(/class="layup-sequence-ply"/g) ?? []).length, 8);
  assert.equal(
    (html.match(/class="layup-sequence-separator"/g) ?? []).length,
    7,
  );
  const gridIndex = html.indexOf('class="layup-sequence-grid"');
  const closeBracketIndex = html.indexOf(
    'class="layup-sequence-bracket layup-sequence-bracket-close"',
  );
  assert.ok(gridIndex >= 0);
  assert.ok(closeBracketIndex > gridIndex);
  assert.match(
    html,
    /class="layup-sequence-bracket layup-sequence-bracket-close" aria-hidden="true">\]<\/span>/,
  );
  assert.equal((html.match(/<wbr\s*\/?>(?:<\/wbr>)?/g) ?? []).length, 7);
});

test("铺层原文中的间隔不进入显示序列", () => {
  const html = renderMarkdown(
    "| 编号 | 铺层 |\n| --- | --- |\n| TMP_1 | [30 / − 30 / 45] |",
  );
  assert.match(
    html,
    /<span class="layup-sequence" aria-label="\[30 \/ − 30 \/ 45\]">\s*<span class="layup-sequence-bracket layup-sequence-bracket-open" aria-hidden="true">\[<\/span><span class="layup-sequence-grid" aria-hidden="true"><span class="layup-sequence-ply"><span class="layup-sequence-angle">30°<\/span><\/span><span class="layup-sequence-separator">\/<\/span><wbr\/><span class="layup-sequence-ply"><span class="layup-sequence-angle">-30°<\/span><\/span><span class="layup-sequence-separator">\/<\/span><wbr\/><span class="layup-sequence-ply"><span class="layup-sequence-angle">45°<\/span><\/span><\/span><span class="layup-sequence-bracket layup-sequence-bracket-close" aria-hidden="true">\]<\/span>\s*<\/span>/,
  );
});

test("无括号无角度符号的历史铺层序列使用同一网格显示", () => {
  const html = renderMarkdown(
    "| 40层角度（外到内） |\n| --- |\n| 90/90/90/90/25/−25/80/−80 |",
  );
  assert.match(html, /class="layup-sequence-cell"/);
  assert.match(html, /class="layup-sequence-angle">-25°<\/span>/);
  assert.equal((html.match(/class="layup-sequence-ply"/g) ?? []).length, 8);
});

test("普通数值斜杠文本不按铺层处理", () => {
  const html = renderMarkdown(
    "| 比例 | 说明 |\n| --- | --- |\n| 1/2/3/4 | 普通数值 |",
  );
  assert.doesNotMatch(html, /class="layup-sequence-cell"/);
});

test("铺层表格保留容器内横向滚动并统一单元格对齐", () => {
  assert.match(
    markdownStyles,
    /\.markdown-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto/,
  );
  assert.match(
    markdownStyles,
    /\.markdown-body table\s*\{[\s\S]*?display:\s*table[\s\S]*?width:\s*100%/,
  );
  assert.match(
    markdownStyles,
    /\.markdown-body table th,[\s\S]*?\.markdown-body table td\s*\{[\s\S]*?text-align:\s*center[\s\S]*?vertical-align:\s*middle/,
  );
  assert.match(
    markdownStyles,
    /\.markdown-body \.layup-sequence\s*\{[\s\S]*?display:\s*inline[\s\S]*?white-space:\s*normal/,
  );
  assert.doesNotMatch(
    markdownStyles,
    /\.markdown-body \.layup-sequence-grid\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  );
});

test("默认数学渲染不授权外部链接和图片命令", () => {
  const html = renderMarkdown(
    String.raw`$\href{https://untrusted.invalid}{link}$ $\includegraphics{https://untrusted.invalid/image.png}$`,
  );
  assert.doesNotMatch(html, /<(?:a|img)\b/);
  assert.match(html, /application\/x-tex/);
});

test("Mermaid ER 图语法可解析，无效语法明确失败", async () => {
  const parsed = await mermaid.parse(
    "erDiagram\n MATERIAL ||--o{ LAYER : contains\n LAYER {\n float angle_deg\n }",
  );
  assert.equal(parsed.diagramType, "er");
  await assert.rejects(mermaid.parse("erDiagram\n MATERIAL ||--"));
});

test("数学链的 scoped override 使用同一 KaTeX 公共 API", () => {
  for (const parent of [
    "rehype-katex",
    "micromark-extension-math",
    "mermaid",
  ]) {
    const parentRequire = createRequire(require.resolve(parent));
    assert.equal(parentRequire.resolve("katex"), require.resolve("katex"));
  }
  const html = micromark("$A_{11}=135000$\n\n$$\nB=0\n$$", {
    extensions: [math()],
    htmlExtensions: [mathHtml()],
  });
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /A_\{11\}=135000/);
  assert.throws(
    () => katex.renderToString(String.raw`\unknownCommand`),
    katex.ParseError,
  );
  const invalid = renderMarkdown(String.raw`$\frac{1}{$`);
  assert.match(invalid, /class="katex-error"/);
  assert.match(invalid, /ParseError/);
  assert.ok(invalid.includes(String.raw`\frac{1}{`));
});

test("KaTeX 不从选项原型继承 trust 权限", () => {
  const html = katex.renderToString(
    String.raw`\href{https://untrusted.invalid}{link}`,
    Object.create({ trust: true }),
  );
  assert.doesNotMatch(html, /<a\b/);
  assert.match(html, /application\/x-tex/);
});

test("Next 浏览器 polyfill 在缺少 Array.at 时保留索引语义", () => {
  // 独立上下文模拟旧浏览器，不改写测试进程的全局 Array。
  const context = createContext({ URL });
  runInContext("delete Array.prototype.at", context);
  const polyfill = readFileSync(
    require.resolve("next/dist/build/polyfills/polyfill-module"),
    "utf8",
  );
  runInContext(polyfill, context);
  assert.equal(runInContext("[10, 20].at(-1)", context), 20);
  assert.equal(runInContext("[10, 20].at(0.9)", context), 10);
  assert.equal(runInContext("[10, 20].at(3)", context), undefined);
});

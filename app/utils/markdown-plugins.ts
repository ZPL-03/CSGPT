import type { Options } from "react-markdown";
import RemarkMath from "remark-math";
import RemarkBreaks from "remark-breaks";
import RemarkGfm from "remark-gfm";
import RehypeKatex from "rehype-katex";
import RehypeHighlight from "rehype-highlight";

// 页面与回归测试使用相同的语法、数学渲染和代码高亮配置。
export const remarkPlugins: Options["remarkPlugins"] = [
  RemarkMath,
  [RemarkGfm, { singleTilde: false }],
  RemarkBreaks,
];

type MarkdownNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
};

function elementChildren(node: MarkdownNode | undefined, tagName?: string) {
  return (node?.children ?? []).filter(
    (child) =>
      child.type === "element" && (!tagName || child.tagName === tagName),
  );
}

function textContent(node: MarkdownNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textContent).join("");
}

function isLayupHeader(value: string) {
  return /(?:铺层|角度|layup)/i.test(value);
}

function markLayupColumns(tree: MarkdownNode) {
  const visit = (node: MarkdownNode) => {
    if (node.type === "element" && node.tagName === "table") {
      const head = elementChildren(node, "thead")[0];
      const headerRow = elementChildren(head, "tr")[0];
      const layupColumns = new Set(
        elementChildren(headerRow, "th")
          .map((cell, index) => (isLayupHeader(textContent(cell)) ? index : -1))
          .filter((index) => index >= 0),
      );

      if (layupColumns.size > 0) {
        const body = elementChildren(node, "tbody")[0];
        for (const row of elementChildren(body, "tr")) {
          elementChildren(row, "td").forEach((cell, index) => {
            if (layupColumns.has(index)) {
              cell.properties = {
                ...(cell.properties ?? {}),
                "data-layup-sequence": true,
              };
            }
          });
        }
      }
    }

    for (const child of node.children ?? []) visit(child);
  };

  visit(tree);
}

function RehypeLayupColumns() {
  return markLayupColumns;
}

export const rehypePlugins: Options["rehypePlugins"] = [
  RehypeLayupColumns,
  RehypeKatex,
  [RehypeHighlight, { detect: false, ignoreMissing: true }],
];

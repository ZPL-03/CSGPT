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

export const rehypePlugins: Options["rehypePlugins"] = [
  RehypeKatex,
  [RehypeHighlight, { detect: false, ignoreMissing: true }],
];

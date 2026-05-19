export const THINKING_BLOCK_START = ":::csgpt-thinking\n";
export const THINKING_BLOCK_END = "\n:::csgpt-thinking-end";

export type ThinkingSegment = {
  type: "text" | "thinking";
  content: string;
};

export function splitThinkingContent(content: string): ThinkingSegment[] {
  const segments: ThinkingSegment[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const startIndex = content.indexOf(THINKING_BLOCK_START, cursor);
    if (startIndex < 0) {
      const text = content.slice(cursor);
      if (text) segments.push({ type: "text", content: text });
      break;
    }

    const text = content.slice(cursor, startIndex);
    if (text) segments.push({ type: "text", content: text });

    const contentStart = startIndex + THINKING_BLOCK_START.length;
    const endIndex = content.indexOf(THINKING_BLOCK_END, contentStart);
    const contentEnd = endIndex < 0 ? content.length : endIndex;
    const thinking = content.slice(contentStart, contentEnd).trim();
    if (thinking) segments.push({ type: "thinking", content: thinking });

    cursor =
      endIndex < 0 ? content.length : endIndex + THINKING_BLOCK_END.length;
  }

  return segments.length > 0 ? segments : [{ type: "text", content }];
}

export function stripThinkingContent(content: string) {
  return splitThinkingContent(content)
    .filter((segment) => segment.type === "text")
    .map((segment) => segment.content)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

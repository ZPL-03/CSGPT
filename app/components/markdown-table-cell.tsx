import React from "react";
import clsx from "clsx";

// 角度序列只在层间分隔符处提供换行点，避免数值被拆开。
const LAYUP_SEQUENCE_PATTERN =
  /^\[((?:[+\-−]?\d+(?:\.\d+)?°?)(?:\/[+\-−]?\d+(?:\.\d+)?°?)+)\]$/;

function plainTextContent(value: React.ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(plainTextContent).join("");
  }
  return "";
}

export function formatLayupSequence(text: string) {
  const match = text.match(LAYUP_SEQUENCE_PATTERN);
  if (!match) return null;

  const angles = match[1]
    .split("/")
    .map((angle) => angle.replace(/°$/, "").replace("−", "-"));
  return (
    <span className="layup-sequence" aria-label={text}>
      <span
        className="layup-sequence-bracket layup-sequence-bracket-open"
        aria-hidden="true"
      >
        [
      </span>
      <span className="layup-sequence-grid" aria-hidden="true">
        {angles.map((angle, index) => (
          <span className="layup-sequence-ply" key={`${angle}-${index}`}>
            <span className="layup-sequence-angle">{angle}°</span>
            {index < angles.length - 1 && (
              <span className="layup-sequence-separator">/</span>
            )}
          </span>
        ))}
      </span>
      <span
        className="layup-sequence-bracket layup-sequence-bracket-close"
        aria-hidden="true"
      >
        ]
      </span>
    </span>
  );
}

export function MarkdownTableCell({
  node: _node,
  children,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { node?: unknown }) {
  const layup = formatLayupSequence(plainTextContent(children));
  const cellClassName = clsx(
    className,
    layup ? "layup-sequence-cell" : undefined,
  );
  return (
    <td {...props} className={cellClassName || undefined}>
      {layup ?? children}
    </td>
  );
}

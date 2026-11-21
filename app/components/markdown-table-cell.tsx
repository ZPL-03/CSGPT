import React from "react";
import clsx from "clsx";
import { parseLayupSequence } from "../utils/layup-sequence";

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
  return formatLayupSequenceForColumn(text, false);
}

export function formatLayupSequenceForColumn(
  text: string,
  allowUnbracketed: boolean,
) {
  const displayAngles = parseLayupSequence(text, allowUnbracketed);
  if (!displayAngles) return null;
  return (
    <span className="layup-sequence" aria-label={text}>
      <span
        className="layup-sequence-bracket layup-sequence-bracket-open"
        aria-hidden="true"
      >
        [
      </span>
      <span className="layup-sequence-grid" aria-hidden="true">
        {displayAngles.map((angle, index) => (
          <React.Fragment key={`${angle}-${index}`}>
            <span className="layup-sequence-ply">
              <span className="layup-sequence-angle">{angle}°</span>
            </span>
            {index < displayAngles.length - 1 && (
              <>
                <span className="layup-sequence-separator">/</span>
                <wbr />
              </>
            )}
          </React.Fragment>
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
  "data-layup-sequence": allowUnbracketed,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  node?: unknown;
  "data-layup-sequence"?: boolean;
}) {
  const layup = formatLayupSequenceForColumn(
    plainTextContent(children),
    Boolean(allowUnbracketed),
  );
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

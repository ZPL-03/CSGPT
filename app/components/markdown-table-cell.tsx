import React from "react";
import clsx from "clsx";

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
  const trimmed = text.trim();
  const hasOpeningBracket = trimmed.startsWith("[");
  const hasClosingBracket = trimmed.endsWith("]");
  const isBracketed = hasOpeningBracket && hasClosingBracket;
  const body = isBracketed
    ? trimmed.slice(1, -1).trim()
    : !hasOpeningBracket && !hasClosingBracket && allowUnbracketed
    ? trimmed
    : null;
  if (!body) return null;

  const angles = body.split("/").map((angle) => angle.trim());
  if (
    angles.length === 0 ||
    angles.some((angle) => !/^[+\-−]?\d+(?:\.\d+)?°?$/.test(angle))
  ) {
    return null;
  }

  const displayAngles = angles.map((angle) =>
    angle.replace(/°$/, "").replace("−", "-"),
  );
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

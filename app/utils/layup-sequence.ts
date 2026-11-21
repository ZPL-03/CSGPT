function parseLayupAngles(text: string, allowUnbracketed: boolean) {
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

  const angles = body.split("/").map((angle) => angle.replace(/\s+/g, ""));
  if (
    angles.length === 0 ||
    angles.some((angle) => !/^[+\-−]?\d+(?:\.\d+)?°?$/.test(angle))
  ) {
    return null;
  }

  return angles.map((angle) => angle.replace(/°$/, "").replace("−", "-"));
}

export function normalizeLayupSequence(text: string) {
  const angles = parseLayupAngles(text, true);
  return angles ? `[${angles.join("/")}]` : null;
}

export function parseLayupSequence(text: string, allowUnbracketed: boolean) {
  return parseLayupAngles(text, allowUnbracketed);
}

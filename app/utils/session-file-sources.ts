export const SESSION_FILE_SOURCES_HEADER = "x-csgpt-session-file-sources";

export type SessionFileSource = {
  id: string;
  title: string;
  messageId?: string;
  fileIds?: string[];
  score: number;
};

const MAX_HEADER_VALUE_LENGTH = 7600;

export function encodeSessionFileSourcesHeader(sources: SessionFileSource[]) {
  if (!sources.length) return "";
  const encode = (items: SessionFileSource[]) =>
    encodeURIComponent(JSON.stringify(items));

  const encoded = encode(sources);
  if (encoded.length <= MAX_HEADER_VALUE_LENGTH) return encoded;

  for (let count = sources.length; count > 0; count -= 1) {
    const compactEncoded = encode(sources.slice(0, count));
    if (compactEncoded.length <= MAX_HEADER_VALUE_LENGTH) {
      return compactEncoded;
    }
  }
  return "";
}

export function parseSessionFileSourcesHeader(response?: Response) {
  const value = response?.headers?.get(SESSION_FILE_SOURCES_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? (parsed as SessionFileSource[]) : [];
  } catch {
    return [];
  }
}

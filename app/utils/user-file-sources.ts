export const USER_FILE_SOURCES_HEADER = "x-csgpt-user-file-sources";

export type UserFileSource = {
  id: string;
  title: string;
  fileId?: string;
  score: number;
};

const MAX_HEADER_VALUE_LENGTH = 7600;

export function encodeUserFileSourcesHeader(sources: UserFileSource[]) {
  if (!sources.length) return "";
  const encode = (items: UserFileSource[]) =>
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

export function parseUserFileSourcesHeader(response?: Response) {
  const value = response?.headers?.get(USER_FILE_SOURCES_HEADER);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? (parsed as UserFileSource[]) : [];
  } catch {
    return [];
  }
}

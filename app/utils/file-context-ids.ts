const FILE_API_PATH_SEGMENT = "files";

type SessionFileRecordWithIds = {
  fileIds?: string[];
};

export function extractFileIdFromFileUrl(url: unknown) {
  if (typeof url !== "string" || !url.trim()) return undefined;

  try {
    const parsed = new URL(url, "https://csgpt.local");
    const segments = parsed.pathname.split("/").filter(Boolean);
    const fileSegmentIndex = segments.indexOf(FILE_API_PATH_SEGMENT);
    if (fileSegmentIndex < 0) return undefined;
    const fileId = segments[fileSegmentIndex + 1];
    return fileId ? decodeURIComponent(fileId) : undefined;
  } catch {
    return undefined;
  }
}

export function uniqueFileIds(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export function extractFileIdsFromMessageContent(content: unknown) {
  if (!Array.isArray(content)) return [];

  return uniqueFileIds(
    content.map((part) => {
      if (!part || typeof part !== "object") return undefined;
      const record = part as Record<string, any>;
      if (record.type !== "file_url") return undefined;
      return extractFileIdFromFileUrl(record.file_url?.url);
    }),
  );
}

export function collectFileIdsFromSessionRecords(
  records: SessionFileRecordWithIds[],
) {
  return uniqueFileIds(records.flatMap((record) => record.fileIds || []));
}

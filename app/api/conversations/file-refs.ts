export function collectFileIdsFromMessageContent(content: any) {
  const ids = new Set<string>();
  const collectFromValue = (value: any) => {
    if (!value) return;
    if (typeof value === "string") {
      const matches = value.matchAll(/\/api\/files\/([A-Za-z0-9_-]+)/g);
      for (const match of matches) ids.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collectFromValue);
      return;
    }
    if (typeof value === "object") {
      Object.values(value).forEach(collectFromValue);
    }
  };

  try {
    collectFromValue(
      typeof content === "string" ? JSON.parse(content) : content,
    );
  } catch {
    collectFromValue(content);
  }

  return Array.from(ids);
}

export async function deleteUnreferencedFiles(
  tx: any,
  fileIds: string[],
  userId: string,
) {
  for (const fileId of fileIds) {
    const referencedMessage = await tx.message.findFirst({
      where: {
        content: { contains: `/api/files/${fileId}` },
        conversation: { userId },
      },
      select: { id: true },
    });
    if (!referencedMessage) {
      await tx.uploadedFile.deleteMany({
        where: { id: fileId, userId },
      });
    }
  }
}

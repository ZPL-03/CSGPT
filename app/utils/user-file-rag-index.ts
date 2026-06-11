import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { splitFileKnowledgeText } from "./file-knowledge-rag";

const CREATE_BATCH_SIZE = 1000;

type UserFileRagIndexInput = {
  fileId: string;
  userId: string;
  title: string;
  text?: string | null;
};

function buildIndexRows(input: UserFileRagIndexInput) {
  const title = input.title.trim() || "附件";
  return splitFileKnowledgeText(input.text || "").map((chunk, index) => ({
    userId: input.userId,
    fileId: input.fileId,
    chunkIndex: index,
    title,
    text: chunk.text,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
  }));
}

async function writeIndexRows(
  tx: Prisma.TransactionClient,
  input: UserFileRagIndexInput,
) {
  const rows = buildIndexRows(input);

  await tx.userFileRagChunk.deleteMany({
    where: { fileId: input.fileId, userId: input.userId },
  });

  for (let index = 0; index < rows.length; index += CREATE_BATCH_SIZE) {
    await tx.userFileRagChunk.createMany({
      data: rows.slice(index, index + CREATE_BATCH_SIZE),
    });
  }

  return rows.length;
}

export async function clearUserFileRagIndex(fileId: string, userId: string) {
  await prisma.userFileRagChunk.deleteMany({
    where: { fileId, userId },
  });
}

export async function markUploadedFileParsedAndIndexed(input: {
  fileId: string;
  userId: string;
  extractedText?: string | null;
}) {
  const file = await prisma.uploadedFile.findFirst({
    where: { id: input.fileId, userId: input.userId },
    select: {
      id: true,
      originalName: true,
      extractedText: true,
    },
  });

  if (!file) return null;

  const text = input.extractedText ?? file.extractedText ?? "";

  return prisma.$transaction(async (tx) => {
    await tx.uploadedFile.update({
      where: { id: file.id },
      data: {
        ...(input.extractedText !== undefined
          ? { extractedText: input.extractedText }
          : {}),
        parseStatus: "parsed",
        parseError: null,
        parsedAt: new Date(),
      },
    });

    const chunkCount = await writeIndexRows(tx, {
      fileId: file.id,
      userId: input.userId,
      title: file.originalName,
      text,
    });

    return { chunkCount };
  });
}

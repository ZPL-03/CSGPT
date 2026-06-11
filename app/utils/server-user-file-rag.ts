import { prisma } from "@/app/lib/prisma";
import {
  buildFileKnowledgeContext,
  type FileKnowledgeRecord,
} from "./file-knowledge-rag";
import type { ServerChatMessageLike } from "./server-message-content";
import type { UserFileSource } from "./user-file-sources";
import { uniqueFileIds } from "./file-context-ids";

export async function buildUserFileRagContext(
  messages: ServerChatMessageLike[],
  userId: string,
  excludedFileIds: string[] = [],
) {
  const excludedIds = uniqueFileIds(excludedFileIds);
  const chunks = await prisma.userFileRagChunk.findMany({
    where: {
      userId,
      ...(excludedIds.length ? { fileId: { notIn: excludedIds } } : {}),
      file: {
        parseStatus: "parsed",
      },
    },
    orderBy: [{ createdAt: "desc" }, { chunkIndex: "asc" }],
    select: {
      fileId: true,
      title: true,
      text: true,
    },
  });

  const records: FileKnowledgeRecord[] = chunks
    .filter((chunk) => chunk.text.trim())
    .map((chunk) => ({
      recordId: chunk.fileId,
      title: chunk.title,
      text: chunk.text,
    }));

  return buildFileKnowledgeContext<UserFileSource>(
    messages,
    records,
    {
      contextTitle: "用户私有文件知识上下文",
      scopeDescription:
        "这些内容来自当前登录用户已上传附件的解析文本，不属于内部知识库，也不属于其他用户数据。",
      sourcePrefix: "U",
    },
    (source) => ({
      id: source.id,
      title: source.title,
      fileId: source.recordId,
      score: source.score,
    }),
  );
}

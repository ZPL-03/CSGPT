import type { SessionFileSource } from "./session-file-sources";
import {
  buildFileKnowledgeContext,
  type FileKnowledgeRecord,
} from "./file-knowledge-rag";
import type { ServerChatMessageLike } from "./server-message-content";

export type SessionFileRecord = {
  messageId?: string;
  role?: string;
  fileContent?: string;
  fileIds?: string[];
};

function extractSessionFileRecord(record: SessionFileRecord) {
  const text = String(record.fileContent || "").trim();
  const match = text.match(/^【文件：(.+?)】\s*\n([\s\S]*)$/);
  const fileRecord: FileKnowledgeRecord = match
    ? {
        recordId: record.messageId,
        fileIds: record.fileIds,
        title: match[1].trim(),
        text: match[2].trim(),
      }
    : {
        recordId: record.messageId,
        fileIds: record.fileIds,
        title: "会话附件",
        text,
      };

  return fileRecord;
}

export function buildSessionFileRagContext(
  messages: ServerChatMessageLike[],
  records: SessionFileRecord[],
) {
  return buildFileKnowledgeContext<SessionFileSource>(
    messages,
    records.map(extractSessionFileRecord),
    {
      contextTitle: "当前会话附件知识上下文",
      scopeDescription:
        "这些内容来自当前会话中用户已发送附件的解析文本，不属于全局 RAG/KG。",
      sourcePrefix: "F",
    },
    (source) => ({
      id: source.id,
      title: source.title,
      messageId: source.recordId,
      fileIds: source.fileIds,
      score: source.score,
    }),
  );
}

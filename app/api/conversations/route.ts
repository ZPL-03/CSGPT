// 对话数据 API
// GET    /api/conversations - 获取用户所有对话列表
// POST   /api/conversations - 创建/保存对话
// DELETE /api/conversations - 删除用户所有对话和关联文件

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";
import {
  buildFileContentFromMessage,
  collectFileIdsFromMessageContent,
  deleteUnreferencedFiles,
} from "./file-refs";
import type { ExtractedFileRecord } from "./file-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 获取用户所有对话
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { messages: true } },
      },
    });

    const res = NextResponse.json({
      conversations: conversations.map((c: any) => ({
        id: c.id,
        topic: c.topic,
        messageCount: c._count.messages,
        lastUpdate: Number(c.lastUpdate),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
    res.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    return res;
  } catch (error) {
    console.error("[Conversations GET] Error:", error);
    return NextResponse.json({ error: "获取对话列表失败" }, { status: 500 });
  }
}

// 创建或保存对话
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const body = await request.json();
    const {
      id,
      topic,
      messages,
      mask,
      memoryPrompt,
      lastUpdate,
      lastSummarizeIndex,
      clearContextIndex,
    } = body;

    if (!id) {
      return NextResponse.json({ error: "对话 ID 不能为空" }, { status: 400 });
    }

    const existingConversation = await prisma.conversation.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (existingConversation && existingConversation.userId !== userId) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }

    // 使用事务保存对话和消息
    const conversation = await prisma.$transaction(async (tx: any) => {
      // 对话写入
      const conv = await tx.conversation.upsert({
        where: { id },
        create: {
          id,
          userId,
          topic: topic || "新的聊天",
          memoryPrompt: memoryPrompt || "",
          lastUpdate: BigInt(lastUpdate || Date.now()),
          lastSummarizeIndex: Number(lastSummarizeIndex || 0),
          clearContextIndex:
            typeof clearContextIndex === "number" ? clearContextIndex : null,
          maskConfig: mask || undefined,
        },
        update: {
          topic: topic || undefined,
          memoryPrompt:
            typeof memoryPrompt === "string" ? memoryPrompt : undefined,
          lastUpdate: BigInt(lastUpdate || Date.now()),
          lastSummarizeIndex:
            typeof lastSummarizeIndex === "number"
              ? lastSummarizeIndex
              : undefined,
          clearContextIndex:
            typeof clearContextIndex === "number" ? clearContextIndex : null,
          maskConfig: mask || undefined,
        },
      });

      // 如果有消息数组，按前端当前消息列表保存数据库消息。
      if (messages && Array.isArray(messages)) {
        const existingMessages: Array<{
          id: string;
          content: string;
          fileContent: string | null;
        }> = await tx.message.findMany({
          where: { conversationId: id },
          select: { id: true, content: true, fileContent: true },
        });
        const previousFileIds = Array.from(
          new Set(
            existingMessages.flatMap((message) =>
              collectFileIdsFromMessageContent(message.content),
            ),
          ),
        );
        const currentFileIds = new Set<string>(
          messages.flatMap((msg: Record<string, any>) =>
            collectFileIdsFromMessageContent(msg.content),
          ),
        );
        const currentFileIdList = Array.from(currentFileIds);
        const fileRecords: ExtractedFileRecord[] =
          currentFileIdList.length > 0
            ? await tx.uploadedFile.findMany({
                where: { id: { in: currentFileIdList }, userId },
                select: {
                  id: true,
                  originalName: true,
                  extractedText: true,
                },
              })
            : [];
        const filesById = new Map<string, ExtractedFileRecord>(
          fileRecords.map((file) => [file.id, file]),
        );
        const existingFileContentByMessageId = new Map(
          existingMessages
            .filter((message) => message.fileContent)
            .map((message) => [message.id, message.fileContent as string]),
        );
        const detachedFileIds = previousFileIds.filter(
          (fileId) => !currentFileIds.has(fileId),
        );

        await tx.message.deleteMany({
          where: { conversationId: id },
        });

        if (messages.length > 0) {
          const baseCreatedAt = Date.now();
          await tx.message.createMany({
            data: messages.map((msg: Record<string, any>, index: number) => {
              const messageFileIds = collectFileIdsFromMessageContent(
                msg.content,
              );
              const fileContentFromRefs = buildFileContentFromMessage(
                msg.content,
                filesById,
              );
              const existingFileContent =
                messageFileIds.length > 0 && typeof msg.id === "string"
                  ? existingFileContentByMessageId.get(msg.id) || null
                  : null;

              return {
                id: msg.id || `${id}-${Date.now()}-${Math.random()}`,
                conversationId: id,
                role: msg.role,
                content:
                  typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content),
                date: msg.date || new Date().toISOString(),
                isError: msg.isError || false,
                model: msg.model || null,
                tools: msg.tools || undefined,
                fileContent: fileContentFromRefs || existingFileContent,
                ragKgSources: msg.ragKgSources || undefined,
                researchSources: msg.researchSources || undefined,
                sessionFileSources: msg.sessionFileSources || undefined,
                userFileSources: msg.userFileSources || undefined,
                designArtifact: msg.designArtifact || undefined,
                createdAt: new Date(baseCreatedAt + index),
              };
            }),
          });
        }

        if (detachedFileIds.length > 0) {
          await deleteUnreferencedFiles(tx, detachedFileIds, userId);
        }
      }

      return conv;
    });

    const res = NextResponse.json({ success: true, id: conversation.id });
    res.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    return res;
  } catch (error) {
    console.error("[Conversations POST] Error:", error);
    return NextResponse.json({ error: "保存对话失败" }, { status: 500 });
  }
}

// 删除当前用户所有对话和关联文件
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const [conversationCount, fileCount] = await Promise.all([
      prisma.conversation.count({
        where: { userId },
      }),
      prisma.uploadedFile.count({
        where: { userId },
      }),
    ]);

    if (conversationCount === 0 && fileCount === 0) {
      return NextResponse.json({ deletedConversations: 0, deletedFiles: 0 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx: any) => {
      if (conversations.length > 0) {
        await tx.message.deleteMany({
          where: { conversationId: { in: conversations.map((c) => c.id) } },
        });
        await tx.conversation.deleteMany({ where: { userId } });
      }
      await tx.uploadedFile.deleteMany({ where: { userId } });
    });

    return NextResponse.json({
      deletedConversations: conversationCount,
      deletedFiles: fileCount,
    });
  } catch (error) {
    console.error("[Conversations DELETE] Error:", error);
    return NextResponse.json({ error: "清除数据失败" }, { status: 500 });
  }
}

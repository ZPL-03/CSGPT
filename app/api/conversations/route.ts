// 对话数据 API
// GET    /api/conversations - 获取用户所有对话列表
// POST   /api/conversations - 创建/保存对话
// DELETE /api/conversations - 删除用户所有对话和关联文件

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";
import {
  collectFileIdsFromMessageContent,
  deleteUnreferencedFiles,
} from "./file-refs";
import zlib from "zlib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readJsonBody(request: NextRequest): Promise<any> {
  const encoding = request.headers.get("content-encoding");
  if (encoding === "gzip") {
    const buffer = Buffer.from(await request.arrayBuffer());
    const decompressed = zlib.gunzipSync(buffer);
    return JSON.parse(decompressed.toString("utf-8"));
  }
  return request.json();
}

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

    const body = await readJsonBody(request);
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
      // 创建或更新对话
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
        const existingMessages: Array<{ content: string }> =
          await tx.message.findMany({
            where: { conversationId: id },
            select: { content: true },
          });
        const previousFileIds = Array.from(
          new Set(
            existingMessages.flatMap((message) =>
              collectFileIdsFromMessageContent(message.content),
            ),
          ),
        );
        const currentFileIds = new Set(
          messages.flatMap((msg: Record<string, any>) =>
            collectFileIdsFromMessageContent(msg.content),
          ),
        );
        const detachedFileIds = previousFileIds.filter(
          (fileId) => !currentFileIds.has(fileId),
        );

        await tx.message.deleteMany({
          where: { conversationId: id },
        });

        if (messages.length > 0) {
          await tx.message.createMany({
            data: messages.map((msg: Record<string, any>) => ({
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
              fileContent: msg.fileContent || null,
            })),
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

    // 统计要删除的数据
    const conversationCount = await prisma.conversation.count({
      where: { userId },
    });

    if (conversationCount === 0) {
      return NextResponse.json({ deletedConversations: 0, deletedFiles: 0 });
    }

    // 收集所有对话中的文件引用
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: { messages: { select: { content: true } } },
    });

    const allFileIds = new Set<string>();
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        const fileIds = collectFileIdsFromMessageContent(msg.content);
        for (const fid of fileIds) allFileIds.add(fid);
      }
    }

    // 检查哪些文件存在且属于当前用户
    const existingFiles =
      allFileIds.size > 0
        ? await prisma.uploadedFile.findMany({
            where: { id: { in: Array.from(allFileIds) }, userId },
            select: { id: true },
          })
        : [];
    const fileIdsToDelete = existingFiles.map((f) => f.id);

    // 在事务中删除所有对话、消息和未引用文件
    await prisma.$transaction(async (tx: any) => {
      // 先删除所有消息
      await tx.message.deleteMany({
        where: { conversationId: { in: conversations.map((c) => c.id) } },
      });
      // 删除所有对话
      await tx.conversation.deleteMany({ where: { userId } });
      // 删除关联文件
      if (fileIdsToDelete.length > 0) {
        await deleteUnreferencedFiles(tx, fileIdsToDelete, userId);
      }
    });

    return NextResponse.json({
      deletedConversations: conversationCount,
      deletedFiles: fileIdsToDelete.length,
    });
  } catch (error) {
    console.error("[Conversations DELETE] Error:", error);
    return NextResponse.json({ error: "清除数据失败" }, { status: 500 });
  }
}

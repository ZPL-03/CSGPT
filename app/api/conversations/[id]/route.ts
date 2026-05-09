// 单个对话操作 API
// GET    /api/conversations/[id] - 获取对话详情（含消息）
// PUT    /api/conversations/[id] - 更新对话
// DELETE /api/conversations/[id] - 删除对话

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";
import {
  collectFileIdsFromMessageContent,
  deleteUnreferencedFiles,
} from "../file-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 解析消息 content 字段：存库时 MultimodalContent[] 被 JSON.stringify，加载时需还原
function parseMessageContent(content: string): string | any[] {
  if (!content) return content;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return content;
}

// 获取对话详情
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: params.id, userId },
      include: {
        messages: {
          orderBy: { date: "asc" },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }

    const res = NextResponse.json({
      conversation: {
        id: conversation.id,
        topic: conversation.topic,
        memoryPrompt: conversation.memoryPrompt,
        lastUpdate: Number(conversation.lastUpdate),
        lastSummarizeIndex: conversation.lastSummarizeIndex,
        clearContextIndex: conversation.clearContextIndex,
        maskConfig: conversation.maskConfig,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: parseMessageContent(m.content),
          date: m.date,
          isError: m.isError,
          model: m.model,
          tools: m.tools,
          fileContent: m.fileContent,
        })),
      },
    });
    res.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    return res;
  } catch (error) {
    console.error("[Conversation GET] Error:", error);
    return NextResponse.json({ error: "获取对话失败" }, { status: 500 });
  }
}

// 删除对话
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    // 确保只能删除自己的对话
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.id, userId },
      include: {
        messages: {
          select: { content: true },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }

    const fileIds = Array.from(
      new Set(
        conversation.messages.flatMap((message) =>
          collectFileIdsFromMessageContent(message.content),
        ),
      ),
    );

    await prisma.$transaction(async (tx) => {
      await tx.conversation.delete({
        where: { id: params.id },
      });
      if (fileIds.length > 0) {
        await deleteUnreferencedFiles(tx, fileIds, userId);
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Conversation DELETE] Error:", error);
    return NextResponse.json({ error: "删除对话失败" }, { status: 500 });
  }
}

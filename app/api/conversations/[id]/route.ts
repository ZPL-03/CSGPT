// 单个对话操作 API
// GET    /api/conversations/[id] - 获取对话详情（含消息）
// PUT    /api/conversations/[id] - 更新对话
// DELETE /api/conversations/[id] - 删除对话

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    return NextResponse.json({
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
          content: m.content,
          date: m.date,
          isError: m.isError,
          model: m.model,
          tools: m.tools,
        })),
      },
    });
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
    });

    if (!conversation) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }

    await prisma.conversation.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Conversation DELETE] Error:", error);
    return NextResponse.json({ error: "删除对话失败" }, { status: 500 });
  }
}

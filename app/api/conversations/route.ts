// 对话数据 API
// GET  /api/conversations - 获取用户所有对话列表
// POST /api/conversations - 创建/保存对话

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";

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

    return NextResponse.json({
      conversations: conversations.map((c: any) => ({
        id: c.id,
        topic: c.topic,
        messageCount: c._count.messages,
        lastUpdate: Number(c.lastUpdate),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
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
    const { id, topic, messages, mask, memoryPrompt, lastUpdate } = body;

    if (!id) {
      return NextResponse.json({ error: "对话 ID 不能为空" }, { status: 400 });
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
          maskConfig: mask || undefined,
        },
        update: {
          topic: topic || undefined,
          memoryPrompt: memoryPrompt || undefined,
          lastUpdate: BigInt(lastUpdate || Date.now()),
          maskConfig: mask || undefined,
        },
      });

      // 如果有消息，先删除旧消息再插入新消息
      if (messages && Array.isArray(messages)) {
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
            })),
          });
        }
      }

      return conv;
    });

    return NextResponse.json({ success: true, id: conversation.id });
  } catch (error) {
    console.error("[Conversations POST] Error:", error);
    return NextResponse.json({ error: "保存对话失败" }, { status: 500 });
  }
}

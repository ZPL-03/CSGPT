// 单个对话操作 API
// GET    /api/conversations/[id] - 获取对话详情（含消息）
// DELETE /api/conversations/[id] - 删除对话

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";
import {
  buildFileContentFromMessage,
  collectFileIdsFromMessageContent,
  deleteUnreferencedFiles,
} from "../file-refs";
import { parseMessageContent } from "@/app/utils/conversation-sync";

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
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    }

    // 收集消息中引用的文件 ID，从 UploadedFile 表取回解析文本
    const allFileIds = new Set<string>();
    for (const msg of conversation.messages) {
      const ids = collectFileIdsFromMessageContent(msg.content);
      for (const fid of ids) allFileIds.add(fid);
    }
    const fileRecords =
      allFileIds.size > 0
        ? await prisma.uploadedFile.findMany({
            where: { id: { in: Array.from(allFileIds) }, userId },
            select: { id: true, originalName: true, extractedText: true },
          })
        : [];
    const filesById = new Map(fileRecords.map((file) => [file.id, file]));

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
        messages: conversation.messages.map((m: any) => {
          return {
            id: m.id,
            role: m.role,
            content: parseMessageContent(m.content),
            date: m.date,
            isError: m.isError,
            model: m.model,
            tools: m.tools,
            agentPlan: m.agentPlan,
            ragKgSources: m.ragKgSources,
            researchSources: m.researchSources,
            designCalculations: m.designCalculations,
            structureVisualizations: m.structureVisualizations,
            simulationJobDrafts: m.simulationJobDrafts,
            sessionFileSources: m.sessionFileSources,
            userFileSources: m.userFileSources,
            fileContent:
              m.fileContent ||
              buildFileContentFromMessage(m.content, filesById),
          };
        }),
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
      await tx.simulationJob.deleteMany({
        where: { conversationId: params.id },
      });
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

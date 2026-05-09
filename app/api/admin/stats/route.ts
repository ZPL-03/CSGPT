// 管理后台 API
// GET  /api/admin/stats — 统计数据概览
// GET  /api/admin/stats?id=xxx — 查看指定对话的消息列表
// DELETE /api/admin/stats?type=user&id=xxx — 删除用户
// DELETE /api/admin/stats?type=conversation&id=xxx — 删除对话
// DELETE /api/admin/stats?type=file&id=xxx — 删除文件

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getServerSideConfig } from "@/app/config/server";
import { verifyToken } from "@/app/lib/auth";
import {
  collectFileIdsFromMessageContent,
  deleteUnreferencedFiles,
} from "../../conversations/file-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(username: string): boolean {
  const config = getServerSideConfig();
  const adminList = config.adminUsernames
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return adminList.includes(username);
}

async function getUserFromAuth(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) return null;

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { username: true },
  });
  return user?.username ?? null;
}

async function requireAdmin(req: NextRequest): Promise<boolean> {
  const username = await getUserFromAuth(req);
  if (!username) return false;
  return isAdmin(username);
}

function jsonNoStore(data: any, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function collectFilesReferencedByConversation(
  tx: any,
  conversationId: string,
) {
  const messages: Array<{ content: string }> = await tx.message.findMany({
    where: { conversationId },
    select: { content: true },
  });
  return Array.from(
    new Set(
      messages.flatMap((message) =>
        collectFileIdsFromMessageContent(message.content),
      ),
    ),
  );
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "未授权访问" }, { status: 401 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("id");

  // 查看对话消息
  if (conversationId) {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          topic: true,
          userId: true,
          user: { select: { username: true } },
          messages: {
            select: {
              id: true,
              role: true,
              content: true,
              date: true,
              isError: true,
              model: true,
              fileContent: true,
            },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!conversation) {
        return NextResponse.json({ error: "对话不存在" }, { status: 404 });
      }

      return jsonNoStore({
        id: conversation.id,
        topic: conversation.topic,
        userId: conversation.userId,
        username: conversation.user.username,
        messages: conversation.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          date: m.date,
          isError: m.isError,
          model: m.model,
          fileContent: m.fileContent,
        })),
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: "获取对话消息失败", detail: error.message },
        { status: 500 },
      );
    }
  }

  // 统计数据概览
  try {
    const [
      userCount,
      conversationCount,
      messageCount,
      fileCount,
      users,
      conversations,
      files,
      fileSizeResult,
      messageSizeResult,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.uploadedFile.count(),
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          createdAt: true,
          _count: { select: { sessions: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.conversation.findMany({
        select: {
          id: true,
          topic: true,
          userId: true,
          lastUpdate: true,
          user: { select: { username: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { lastUpdate: "desc" },
      }),
      prisma.uploadedFile.findMany({
        select: {
          id: true,
          userId: true,
          originalName: true,
          mimeType: true,
          size: true,
          createdAt: true,
          user: { select: { username: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.uploadedFile.aggregate({ _sum: { size: true } }),
      prisma.$queryRawUnsafe<{ message_bytes: bigint | number | null }[]>(
        `SELECT COALESCE(SUM(octet_length("content") + octet_length(COALESCE("fileContent", ''))), 0) AS message_bytes FROM "Message"`,
      ),
    ]);

    const dbSizeResult = await prisma.$queryRawUnsafe<
      { db_size: string; table_size: string }[]
    >(
      `WITH app_tables(name) AS (
        VALUES ('"User"'), ('"Conversation"'), ('"Message"'), ('"AuthToken"'), ('"UploadedFile"')
      )
      SELECT
        pg_size_pretty(pg_database_size(current_database())) AS db_size,
        pg_size_pretty(
          COALESCE(
            SUM(
              CASE
                WHEN to_regclass('public.' || name) IS NULL THEN 0
                ELSE pg_total_relation_size(to_regclass('public.' || name))
              END
            ),
            0
          )
        ) AS table_size
      FROM app_tables`,
    );
    const currentDataBytes =
      Number(fileSizeResult._sum.size || 0) +
      Number(messageSizeResult[0]?.message_bytes || 0);

    return jsonNoStore({
      users: Number(userCount),
      userList: users.map((u) => ({
        id: u.id,
        username: u.username,
        createdAt: u.createdAt,
        conversationCount: Number(u._count.sessions),
      })),
      conversations: Number(conversationCount),
      conversationList: conversations.map((c) => ({
        id: c.id,
        topic: c.topic,
        userId: c.userId,
        username: c.user.username,
        lastUpdate: Number(c.lastUpdate),
        messageCount: Number(c._count.messages),
      })),
      messages: Number(messageCount),
      files: Number(fileCount),
      fileList: files.map((file) => ({
        id: file.id,
        userId: file.userId,
        username: file.user?.username || "",
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: file.createdAt,
      })),
      dbSize: dbSizeResult[0]?.db_size || "N/A",
      tableSize: dbSizeResult[0]?.table_size || "N/A",
      dataSize: formatBytes(currentDataBytes),
      dataBytes: currentDataBytes,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "获取统计数据失败", detail: error.message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "未授权访问" }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const targetId = url.searchParams.get("id");

  try {
    if (type === "user") {
      if (!targetId) {
        return NextResponse.json({ error: "缺少用户 ID" }, { status: 400 });
      }

      const user = await prisma.user.findUnique({
        where: { id: targetId },
        select: { username: true },
      });
      if (!user) {
        return NextResponse.json({ error: "用户不存在" }, { status: 404 });
      }

      const authUser = await getUserFromAuth(req);
      if (authUser === user.username) {
        return NextResponse.json(
          { error: "不能删除自己的账号" },
          { status: 403 },
        );
      }

      await prisma.user.delete({ where: { id: targetId } });
      return NextResponse.json({
        success: true,
        message: `已删除用户 ${user.username}`,
      });
    }

    if (type === "conversation") {
      if (!targetId) {
        return NextResponse.json({ error: "缺少对话 ID" }, { status: 400 });
      }
      const conversation = await prisma.conversation.findUnique({
        where: { id: targetId },
        select: { id: true, userId: true },
      });
      if (!conversation) {
        return NextResponse.json({ error: "对话不存在" }, { status: 404 });
      }

      await prisma.$transaction(async (tx) => {
        const fileIds = await collectFilesReferencedByConversation(
          tx,
          targetId,
        );
        await tx.conversation.delete({ where: { id: targetId } });
        await deleteUnreferencedFiles(tx, fileIds, conversation.userId);
      });
      return NextResponse.json({ success: true, message: "已删除对话" });
    }

    if (type === "file") {
      if (!targetId) {
        return NextResponse.json({ error: "缺少文件 ID" }, { status: 400 });
      }
      const file = await prisma.uploadedFile.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!file) {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
      }
      await prisma.uploadedFile.delete({ where: { id: targetId } });
      return NextResponse.json({ success: true, message: "已删除文件" });
    }

    return NextResponse.json(
      { error: "无效的删除类型，支持 user、conversation 或 file" },
      { status: 400 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: "删除失败", detail: error.message },
      { status: 500 },
    );
  }
}

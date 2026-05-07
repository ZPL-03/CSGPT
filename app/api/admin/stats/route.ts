// 管理后台 API
// GET  /api/admin/stats — 统计数据概览
// GET  /api/admin/stats?id=xxx — 查看指定对话的消息列表
// DELETE /api/admin/stats?type=user&id=xxx — 删除用户
// DELETE /api/admin/stats?type=conversation&id=xxx — 删除对话

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getServerSideConfig } from "@/app/config/server";
import { verifyToken } from "@/app/lib/auth";

export const runtime = "nodejs";

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
            },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!conversation) {
        return NextResponse.json({ error: "对话不存在" }, { status: 404 });
      }

      return NextResponse.json({
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
    const [userCount, conversationCount, messageCount, users, conversations] =
      await Promise.all([
        prisma.user.count(),
        prisma.conversation.count(),
        prisma.message.count(),
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
      ]);

    const dbSizeResult = await prisma.$queryRawUnsafe<
      { db_size: string; data_size: string }[]
    >(
      `SELECT pg_size_pretty(pg_database_size('neondb')) as db_size, pg_size_pretty(pg_total_relation_size('"User"') + pg_total_relation_size('"Conversation"') + pg_total_relation_size('"Message"') + pg_total_relation_size('"AuthToken"')) as data_size`,
    );

    return NextResponse.json({
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
      dbSize: dbSizeResult[0]?.db_size || "N/A",
      dataSize: dbSizeResult[0]?.data_size || "N/A",
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
      await prisma.conversation.delete({ where: { id: targetId } });
      return NextResponse.json({ success: true, message: "已删除对话" });
    }

    return NextResponse.json(
      { error: "无效的删除类型，支持 user 或 conversation" },
      { status: 400 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: "删除失败", detail: error.message },
      { status: 500 },
    );
  }
}

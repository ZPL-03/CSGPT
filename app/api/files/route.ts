// 附件 API：POST /api/files
// 创建当前用户的附件记录，真实二进制数据由分片接口写入。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";
import { FILE_UPLOAD_CHUNK_SIZE, MAX_FILE_UPLOAD_SIZE } from "@/app/constant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST：初始化附件记录
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const originalName =
      typeof body?.name === "string" && body.name.trim()
        ? body.name.trim()
        : "upload.bin";
    const mimeType =
      typeof body?.mimeType === "string" && body.mimeType.trim()
        ? body.mimeType.trim()
        : "application/octet-stream";
    const size = Number(body?.size);

    if (!Number.isFinite(size) || size < 0) {
      return NextResponse.json({ error: "文件大小无效" }, { status: 400 });
    }

    if (size > MAX_FILE_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: "文件大小不能超过 50MB" },
        { status: 413 },
      );
    }

    const savedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        originalName,
        mimeType,
        size,
        data: Buffer.alloc(0),
        parseStatus: "pending",
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        parseStatus: true,
        parseError: true,
        parsedAt: true,
      },
    });

    return NextResponse.json({
      code: 0,
      data: `/api/files/${savedFile.id}`,
      file: savedFile,
      chunkSize: FILE_UPLOAD_CHUNK_SIZE,
    });
  } catch (error: any) {
    console.error("[Files] Init error:", error);
    return NextResponse.json(
      { error: "创建文件记录失败", message: error.message },
      { status: 500 },
    );
  }
}

// GET：列出当前用户上传文件
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const files = await prisma.uploadedFile.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        extractedText: true,
        parseStatus: true,
        parseError: true,
        parsedAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      files: files.map((file: any) => ({
        ...file,
        name: file.originalName,
        url: `/api/files/${file.id}`,
        extractedTextLength: file.extractedText?.length || 0,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "获取文件列表失败", message: error.message },
      { status: 500 },
    );
  }
}

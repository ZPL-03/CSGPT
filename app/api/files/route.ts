// 文件上传 API：POST /api/files
// 将用户上传的原始文件数据写入数据库。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

// POST：保存用户上传文件
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "未提供文件" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "文件大小不能超过 20MB" },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const savedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        originalName: file.name || "upload.bin",
        mimeType: file.type || "application/octet-stream",
        size: buffer.length,
        data: buffer,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
      },
    });

    return NextResponse.json({
      code: 0,
      data: `/api/files/${savedFile.id}`,
      file: savedFile,
    });
  } catch (error: any) {
    console.error("[Files] Upload error:", error);
    return NextResponse.json(
      { error: "上传失败", message: error.message },
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
        createdAt: true,
      },
    });

    return NextResponse.json({
      files: files.map((file: any) => ({
        ...file,
        name: file.originalName,
        url: `/api/files/${file.id}`,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "获取文件列表失败", message: error.message },
      { status: 500 },
    );
  }
}

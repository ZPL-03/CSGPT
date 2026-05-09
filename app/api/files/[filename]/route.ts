// 单个文件 API：GET/DELETE /api/files/[filename]
// 读取数据库中的原始文件数据并返回给浏览器或模型调用链路。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidFileId(fileId: string) {
  return (
    fileId.length > 0 &&
    !fileId.includes("..") &&
    !fileId.includes("/") &&
    !fileId.includes("\\")
  );
}

function contentDisposition(filename: string) {
  return `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// GET：读取文件内容
export async function GET(
  _request: NextRequest,
  { params }: { params: { filename: string } },
) {
  try {
    const fileId = params.filename;
    if (!isValidFileId(fileId)) {
      return NextResponse.json({ error: "无效的文件名" }, { status: 400 });
    }

    const file = await prisma.uploadedFile.findUnique({
      where: { id: fileId },
      select: {
        data: true,
        mimeType: true,
        originalName: true,
        size: true,
      },
    });

    if (!file) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    return new NextResponse(Buffer.from(file.data), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": contentDisposition(file.originalName),
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("[Files] Read error:", error);
    return NextResponse.json(
      { error: "获取文件失败", message: error.message },
      { status: 500 },
    );
  }
}

// DELETE：删除当前用户的文件
export async function DELETE(
  request: NextRequest,
  { params }: { params: { filename: string } },
) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const fileId = params.filename;
    if (!isValidFileId(fileId)) {
      return NextResponse.json({ error: "无效的文件名" }, { status: 400 });
    }

    const file = await prisma.uploadedFile.findFirst({
      where: { id: fileId, userId },
      select: { id: true },
    });
    if (!file) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    await prisma.uploadedFile.delete({ where: { id: file.id } });
    return NextResponse.json({ code: 0 });
  } catch (error: any) {
    console.error("[Files] Delete error:", error);
    return NextResponse.json(
      { error: "删除失败", message: error.message },
      { status: 500 },
    );
  }
}

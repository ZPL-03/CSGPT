// 单个文件操作 API：GET/DELETE /api/files/[filename]
// 提供文件下载、删除功能

import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

export const runtime = "nodejs";

const FILES_DIR = path.join(process.cwd(), "data", "files");

// GET：下载/查看文件
export async function GET(
  _request: NextRequest,
  { params }: { params: { filename: string } },
) {
  try {
    const filename = params.filename;

    // 安全检查：防止路径遍历攻击
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return NextResponse.json({ error: "无效的文件名" }, { status: 400 });
    }

    const filePath = path.join(FILES_DIR, filename);
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const buffer = await readFile(filePath);
    const ext = path.extname(filename).toLowerCase();

    // 根据扩展名确定 Content-Type
    const mimeTypes: Record<string, string> = {
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".csv": "text/csv",
      ".xml": "application/xml",
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".ts": "application/typescript",
      ".py": "text/x-python",
      ".pdf": "application/pdf",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".zip": "application/zip",
    };

    const contentType = mimeTypes[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("[Files] Serve error:", error);
    return NextResponse.json(
      { error: "获取文件失败", message: error.message },
      { status: 500 },
    );
  }
}

// DELETE：删除文件
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { filename: string } },
) {
  try {
    const filename = params.filename;

    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\")
    ) {
      return NextResponse.json({ error: "无效的文件名" }, { status: 400 });
    }

    const filePath = path.join(FILES_DIR, filename);
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    await unlink(filePath);

    return NextResponse.json({ code: 0, message: "删除成功" });
  } catch (error: any) {
    console.error("[Files] Delete error:", error);
    return NextResponse.json(
      { error: "删除失败", message: error.message },
      { status: 500 },
    );
  }
}

// 文件上传 API：POST /api/files
// 将文件存储到服务器磁盘，返回访问 URL

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { nanoid } from "nanoid";

export const runtime = "nodejs";

// 文件存储目录：Vercel 环境使用 /tmp，本地开发使用项目目录下的 data/files
const FILES_DIR = process.env.VERCEL
  ? "/tmp/files"
  : path.join(process.cwd(), "data", "files");

async function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// POST：上传文件
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "未提供文件" }, { status: 400 });
    }

    await ensureDir(FILES_DIR);

    // 保留原始扩展名
    const ext = file.name.includes(".")
      ? file.name.split(".").pop() || "bin"
      : "bin";
    const filename = `${nanoid()}.${ext}`;
    const filePath = path.join(FILES_DIR, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    // 返回相对 URL
    const url = `/api/files/${filename}`;

    return NextResponse.json({
      code: 0,
      data: url,
      message: "上传成功",
    });
  } catch (error: any) {
    console.error("[Files] Upload error:", error);
    return NextResponse.json(
      { code: 1, error: "上传失败", message: error.message },
      { status: 500 },
    );
  }
}

// GET：列出所有文件（管理用途）
export async function GET() {
  try {
    await ensureDir(FILES_DIR);
    const { readdir, stat } = await import("fs/promises");
    const files = await readdir(FILES_DIR);
    const fileList = await Promise.all(
      files.map(async (name) => {
        const stats = await stat(path.join(FILES_DIR, name));
        return {
          name,
          url: `/api/files/${name}`,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
        };
      }),
    );

    return NextResponse.json({ files: fileList });
  } catch (error: any) {
    return NextResponse.json(
      { error: "获取文件列表失败", message: error.message },
      { status: 500 },
    );
  }
}

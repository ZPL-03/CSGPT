// 单个文件 API：GET/DELETE /api/files/[filename]
// 分片写入、校验、读取和删除数据库中的原始文件数据。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";
import { FILE_UPLOAD_CHUNK_SIZE } from "@/app/constant";
import {
  clearUserFileRagIndex,
  markUploadedFileParsedAndIndexed,
} from "@/app/utils/user-file-rag-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function bufferToStream(buffer: Buffer | Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const chunkSize = 64 * 1024;
      let offset = 0;
      const push = () => {
        if (offset >= buffer.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + chunkSize, buffer.length);
        controller.enqueue(buffer.subarray(offset, end));
        offset = end;
        setTimeout(push, 0);
      };
      push();
    },
  });
}

function parseOffset(request: NextRequest) {
  const value = new URL(request.url).searchParams.get("offset");
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

// GET：读取文件内容
export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } },
) {
  try {
    const fileId = params.filename;
    if (!isValidFileId(fileId)) {
      return NextResponse.json({ error: "无效的文件名" }, { status: 400 });
    }

    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const file = await prisma.uploadedFile.findFirst({
      where: { id: fileId, userId },
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

    const buffer = Buffer.from(file.data);
    return new Response(bufferToStream(buffer), {
      status: 200,
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": contentDisposition(file.originalName),
        "Cache-Control": "no-cache, no-store, must-revalidate",
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

// PATCH：按顺序追加一个文件分片
export async function PATCH(
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

    const offset = parseOffset(request);
    if (offset === null) {
      return NextResponse.json({ error: "分片偏移无效" }, { status: 400 });
    }

    const chunk = Buffer.from(await request.arrayBuffer());
    if (chunk.length === 0 || chunk.length > FILE_UPLOAD_CHUNK_SIZE) {
      return NextResponse.json({ error: "分片大小无效" }, { status: 413 });
    }

    const updated = await prisma.$queryRaw<Array<{ storedSize: number }>>`
      UPDATE "UploadedFile"
      SET "data" = "data" || ${chunk}
      WHERE "id" = ${fileId}
        AND "userId" = ${userId}
        AND octet_length("data") = ${offset}
        AND octet_length("data") + ${chunk.length} <= "size"
      RETURNING octet_length("data") AS "storedSize"
    `;

    if (updated.length === 0) {
      const current = await prisma.$queryRaw<
        Array<{ storedSize: number; declaredSize: number }>
      >`
        SELECT octet_length("data") AS "storedSize", "size" AS "declaredSize"
        FROM "UploadedFile"
        WHERE "id" = ${fileId} AND "userId" = ${userId}
      `;
      if (current.length === 0) {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: "分片顺序不一致",
          storedSize: Number(current[0].storedSize),
          declaredSize: Number(current[0].declaredSize),
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      code: 0,
      storedSize: Number(updated[0].storedSize),
    });
  } catch (error: any) {
    console.error("[Files] Chunk error:", error);
    return NextResponse.json(
      { error: "写入文件分片失败", message: error.message },
      { status: 500 },
    );
  }
}

// POST：文件分片完整性确认
export async function POST(
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

    const body = await request.json().catch(() => null);

    if (body?.action === "beginExtractedText") {
      const result = await prisma.uploadedFile.updateMany({
        where: { id: fileId, userId },
        data: {
          extractedText: "",
          parseStatus: "parsing",
          parseError: null,
          parsedAt: null,
        },
      });
      if (result.count === 0) {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
      }
      await clearUserFileRagIndex(fileId, userId);
      return NextResponse.json({ code: 0 });
    }

    if (body?.action === "appendExtractedText") {
      if (typeof body.chunk !== "string") {
        return NextResponse.json(
          { error: "缺少解析文本分段" },
          { status: 400 },
        );
      }
      const updated = await prisma.$executeRaw`
        UPDATE "UploadedFile"
        SET "extractedText" = COALESCE("extractedText", '') || ${body.chunk}
        WHERE "id" = ${fileId} AND "userId" = ${userId}
      `;
      if (updated === 0) {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
      }
      return NextResponse.json({ code: 0 });
    }

    if (body?.action === "completeExtractedText") {
      const result = await markUploadedFileParsedAndIndexed({ fileId, userId });
      if (!result) {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
      }
      return NextResponse.json({ code: 0, ragChunkCount: result.chunkCount });
    }

    if (body?.action !== "complete") {
      return NextResponse.json({ error: "无效的文件操作" }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        originalName: string;
        mimeType: string;
        declaredSize: number;
        storedSize: number;
      }>
    >`
      SELECT
        "id",
        "originalName",
        "mimeType",
        "size" AS "declaredSize",
        octet_length("data") AS "storedSize"
      FROM "UploadedFile"
      WHERE "id" = ${fileId} AND "userId" = ${userId}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const file = rows[0];
    const storedSize = Number(file.storedSize);
    const declaredSize = Number(file.declaredSize);
    if (storedSize !== declaredSize) {
      return NextResponse.json(
        {
          error: "文件分片未写入完整",
          storedSize,
          declaredSize,
        },
        { status: 409 },
      );
    }

    await prisma.uploadedFile.updateMany({
      where: { id: fileId, userId },
      data: {
        parseStatus: "uploaded",
        parseError: null,
      },
    });
    await clearUserFileRagIndex(fileId, userId);

    return NextResponse.json({
      code: 0,
      data: `/api/files/${file.id}`,
      file: {
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: declaredSize,
      },
    });
  } catch (error: any) {
    console.error("[Files] Complete error:", error);
    return NextResponse.json(
      { error: "确认文件失败", message: error.message },
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

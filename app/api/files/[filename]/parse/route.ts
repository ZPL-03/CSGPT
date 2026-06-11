import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";
import {
  clearUserFileRagIndex,
  markUploadedFileParsedAndIndexed,
} from "@/app/utils/user-file-rag-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ReparseResult {
  fileName: string;
  originalFormat: string;
  text: string;
  noiseLinesRemoved: number;
  formulaRecords: Array<{
    formula: string;
    display: boolean;
    description: string;
  }>;
  metadata: Record<string, any>;
}

function isValidFileId(fileId: string) {
  return (
    fileId.length > 0 &&
    !fileId.includes("..") &&
    !fileId.includes("/") &&
    !fileId.includes("\\")
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: { filename: string } },
) {
  const fileId = params.filename;
  let userId: string | null = null;

  try {
    userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    if (!isValidFileId(fileId)) {
      return NextResponse.json({ error: "文件 ID 无效" }, { status: 400 });
    }

    const file = await prisma.uploadedFile.findFirst({
      where: { id: fileId, userId },
      select: {
        data: true,
        originalName: true,
      },
    });

    if (!file) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    await prisma.uploadedFile.updateMany({
      where: { id: fileId, userId },
      data: {
        parseStatus: "parsing",
        parseError: null,
        parsedAt: null,
      },
    });
    await clearUserFileRagIndex(fileId, userId);

    const {
      extractTextFromFile,
      extractFormulaRecords,
      filterNoiseLines,
      normalizeEngineeringText,
    } = await import("@/app/utils/file-text-extractor");

    const originalText = await extractTextFromFile(
      Buffer.from(file.data),
      file.originalName,
      { includeImages: false, ocrImages: false },
    );

    const filteredText = filterNoiseLines(originalText.text);
    const noiseRemoved =
      originalText.text.split("\n").length - filteredText.split("\n").length;
    const normalizedText = normalizeEngineeringText(filteredText);
    const formulaRecords = extractFormulaRecords(normalizedText);

    const result: ReparseResult = {
      fileName: file.originalName,
      originalFormat: originalText.metadata?.parser || "unknown",
      text: normalizedText,
      noiseLinesRemoved: Math.max(0, noiseRemoved),
      formulaRecords,
      metadata: {
        ...originalText.metadata,
        reparseTimestamp: Date.now(),
        textLength: normalizedText.length,
        formulaCount: formulaRecords.length,
      },
    };

    await markUploadedFileParsedAndIndexed({
      fileId,
      userId,
      extractedText: normalizedText,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (userId && isValidFileId(fileId)) {
      await prisma.uploadedFile
        .updateMany({
          where: { id: fileId, userId },
          data: {
            parseStatus: "failed",
            parseError: error?.message || "解析失败",
          },
        })
        .catch(() => null);
      await clearUserFileRagIndex(fileId, userId).catch(() => null);
    }

    console.error("[Files/Parse] Error:", error);
    return NextResponse.json(
      { error: "重解析失败", message: error.message },
      { status: 500 },
    );
  }
}

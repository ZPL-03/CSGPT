// 文件重解析端点：POST /api/files/[filename]/parse
// 读取数据库中已上传的文件数据，使用完整解析管线重新提取文本和公式记录。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getUserFromRequest } from "@/app/lib/auth";

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
    if (
      !fileId ||
      fileId.includes("..") ||
      fileId.includes("/") ||
      fileId.includes("\\")
    ) {
      return NextResponse.json({ error: "无效的文件名" }, { status: 400 });
    }

    const file = await prisma.uploadedFile.findUnique({
      where: { id: fileId },
      select: {
        data: true,
        mimeType: true,
        originalName: true,
        size: true,
        userId: true,
      },
    });

    if (!file || file.userId !== userId) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    // 动态导入解析模块（避免浏览器端依赖在服务端报错）
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

    // 噪声过滤
    const filteredText = filterNoiseLines(originalText.text);
    const noiseRemoved =
      originalText.text.split("\n").length - filteredText.split("\n").length;

    // 工程文本规范化
    const normalizedText = normalizeEngineeringText(filteredText);

    // 提取公式记录
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

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Files/Parse] Error:", error);
    return NextResponse.json(
      { error: "重解析失败", message: error.message },
      { status: 500 },
    );
  }
}

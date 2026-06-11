import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getUserFromRequest } from "@/app/lib/auth";
import {
  executeResearchSearch,
  getResearchSearchToolCatalog,
  ResearchSearchConfigurationError,
  UnsupportedResearchSearchProviderError,
} from "@/app/utils/research-search-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatValidationError(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

async function requireUser(request: NextRequest) {
  const userId = await getUserFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = await requireUser(request);
  if (authError) return authError;

  const response = NextResponse.json(getResearchSearchToolCatalog());
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function POST(request: NextRequest) {
  const authError = await requireUser(request);
  if (authError) return authError;

  try {
    const rawBody = await request.json();
    return NextResponse.json(await executeResearchSearch(rawBody));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "参数无效", details: formatValidationError(error) },
        { status: 400 },
      );
    }

    if (
      error instanceof ResearchSearchConfigurationError ||
      error instanceof UnsupportedResearchSearchProviderError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求体不是有效 JSON" },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json({ error: "检索失败" }, { status: 500 });
  }
}

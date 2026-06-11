import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getUserFromRequest } from "@/app/lib/auth";
import {
  executeDesignCalculation,
  formatDesignCalculationValidationError,
  getDesignCalculationToolCatalog,
  UnsupportedDesignCalculationError,
} from "@/app/utils/design-calculation-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const response = NextResponse.json(getDesignCalculationToolCatalog());
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
    return NextResponse.json(executeDesignCalculation(rawBody));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "参数无效",
          details: formatDesignCalculationValidationError(error),
        },
        { status: 400 },
      );
    }

    if (error instanceof UnsupportedDesignCalculationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求体不是有效 JSON" },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "计算失败" }, { status: 500 });
  }
}

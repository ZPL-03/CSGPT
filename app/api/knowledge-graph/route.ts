import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/app/lib/auth";
import { queryKnowledgeGraph } from "@/app/utils/server-rag-kg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    const limit = Number(searchParams.get("limit") || 56);
    const data = await queryKnowledgeGraph(query, limit);
    const response = NextResponse.json(data);
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
  } catch (error: any) {
    console.error("[KnowledgeGraph] Query failed:", error);
    return NextResponse.json(
      { error: error?.message || "知识图谱查询失败" },
      { status: 500 },
    );
  }
}

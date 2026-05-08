// 调试端点：测试 CS3 后端连通性，部署后访问 /api/debug/cs3-test
// 仅用于临时诊断，确认问题后删除

import { NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getServerSideConfig();
  const baseUrl = config.csgptCs3BaseUrl || "https://csllm-cpv.lqfewle.com/v1";
  const results: Record<string, any> = { baseUrl };

  // 测试 1：DNS 解析
  try {
    const { resolve4 } = await import("dns/promises");
    const hostname = new URL(baseUrl).hostname;
    const addresses = await resolve4(hostname);
    results.dns = { success: true, addresses };
  } catch (e: any) {
    results.dns = { success: false, error: e.message };
  }

  // 测试 2：TCP 连接 + 简单请求
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    results.http = { success: true, status: res.status };
  } catch (e: any) {
    results.http = {
      success: false,
      error: e.message,
      cause: e.cause?.toString(),
    };
  }

  // 测试 3：完整 chat 请求
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CSGPT/1.0",
      },
      body: JSON.stringify({
        model: config.csgptCs3UpstreamModelName || "csllm-cpv",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    results.chat = {
      success: res.ok,
      status: res.status,
      content: data?.choices?.[0]?.message?.content?.substring(0, 200),
    };
  } catch (e: any) {
    results.chat = {
      success: false,
      error: e.message,
      cause: e.cause?.toString(),
    };
  }

  return NextResponse.json(results);
}

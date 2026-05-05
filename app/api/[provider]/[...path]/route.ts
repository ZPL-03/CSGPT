import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { CSGPT_SYSTEM_PROMPT } from "@/app/prompts/csgpt";

// CSGPT 专用路由：处理 /api/csgpt/* 请求，转发到 vLLM 服务
async function handle(
  req: NextRequest,
  { params }: { params: { provider: string; path: string[] } },
) {
  console.log(`[${params.provider} Route] params `, params);

  // 只处理 CSGPT provider
  if (params.provider !== "csgpt") {
    return NextResponse.json(
      { error: true, message: `不支持的 Provider: ${params.provider}` },
      { status: 400 },
    );
  }

  const config = getServerSideConfig();
  // 兼容 v1/ 前缀：v1/chat/completions → chat/completions
  const rawPath = params.path.join("/");
  const pathStr = rawPath.startsWith("v1/") ? rawPath.slice(3) : rawPath;

  // 处理 models 请求
  if (pathStr === "models") {
    const models = {
      object: "list",
      data: [
        {
          id: config.csgptModelName || "CSGPT-V1",
          object: "model",
          created: Date.now(),
          owned_by: "csgpt",
          permission: [],
          root: config.csgptModelName || "CSGPT-V1",
          parent: null,
        },
      ],
    };
    return NextResponse.json(models);
  }

  // 处理 chat/completions 请求
  if (pathStr === "chat/completions") {
    const baseUrl = config.csgptBaseUrl || "http://localhost:8000/v1";
    const apiUrl = `${baseUrl}/chat/completions`;

    const body = await req.json();
    const { messages, stream = true, model, ...rest } = body;

    // 注入 CSGPT 领域 System Prompt
    let processedMessages = [...messages];
    const hasSystemMessage = processedMessages.some(
      (msg: any) => msg.role === "system",
    );
    if (!hasSystemMessage) {
      processedMessages.unshift({
        role: "system",
        content: CSGPT_SYSTEM_PROMPT,
      });
    }

    const requestBody = {
      model: config.csgptModelName || model || "CSGPT-V1",
      messages: processedMessages,
      stream: stream,
      ...rest,
    };

    console.log("[CSGPT API] 转发请求到:", apiUrl);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.csgptApiKey || "sk-csgpt-placeholder"}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: true,
          message: `模型服务返回错误: ${response.status}`,
          detail: errorText,
        },
        { status: response.status },
      );
    }

    if (stream) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const transformStream = new TransformStream({
        async transform(chunk, controller) {
          const text = decoder.decode(chunk, { stream: true });
          controller.enqueue(encoder.encode(text));
        },
      });

      return new Response(response.body?.pipeThrough(transformStream), {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } else {
      const data = await response.json();
      return NextResponse.json(data);
    }
  }

  return NextResponse.json(
    { error: true, message: `不支持的路径: ${pathStr}` },
    { status: 404 },
  );
}

export const GET = handle;
export const POST = handle;

// 使用 Node.js Runtime，允许直接访问 IP 地址（Edge Runtime 禁止 IP 直连）
export const runtime = "nodejs";

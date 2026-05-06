import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { CSGPT_SYSTEM_PROMPT } from "@/app/prompts/csgpt";
import md5 from "spark-md5";

// 访问码前缀（与客户端 constant.ts 中的 ACCESS_CODE_PREFIX 一致）
const ACCESS_CODE_PREFIX = "nk-";

// 验证访问码
function verifyAccessCode(req: NextRequest): boolean {
  const config = getServerSideConfig();

  // 未设置访问码则允许访问
  if (!config.needCode) return true;

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  // 如果是访问码（带 nk- 前缀）
  if (token.startsWith(ACCESS_CODE_PREFIX)) {
    const code = token.slice(ACCESS_CODE_PREFIX.length);
    const { codes } = config;
    // 访问码为空则拒绝
    if (!code) return false;
    // 验证访问码哈希
    const codeHash = md5.hash(code.trim());
    return codes.has(codeHash);
  }

  // 如果是 API Key（用户自己提供），允许
  if (token && !token.startsWith(ACCESS_CODE_PREFIX)) {
    return true;
  }

  return false;
}

// CSGPT API 路由处理函数
export async function POST(req: NextRequest) {
  try {
    // 验证访问码
    if (!verifyAccessCode(req)) {
      return NextResponse.json(
        { error: true, message: "访问码无效，请重新输入" },
        { status: 401 }
      );
    }

    // 获取服务端配置
    const config = getServerSideConfig();

    // 解析请求体
    const body = await req.json();
    const { messages, stream = true, model, ...rest } = body;

    // 注入 CSGPT 领域 System Prompt
    // 如果用户没有提供 system 消息，则自动注入
    let processedMessages = [...messages];
    const hasSystemMessage = processedMessages.some(
      (msg: any) => msg.role === "system"
    );

    if (!hasSystemMessage) {
      // 在消息列表开头插入系统提示
      processedMessages.unshift({
        role: "system",
        content: CSGPT_SYSTEM_PROMPT,
      });
    }

    // 构造转发到 vLLM 的请求体
    const requestBody = {
      model: config.csgptModelName || model || "CSGPT-V1",
      messages: processedMessages,
      stream: stream,
      ...rest,
    };

    // 构造 vLLM API 地址
    const baseUrl = config.csgptBaseUrl || "http://localhost:8000/v1";
    const apiUrl = `${baseUrl}/chat/completions`;

    console.log("[CSGPT API] 转发请求到:", apiUrl);
    console.log("[CSGPT API] 模型:", requestBody.model);

    // 发送请求到 vLLM
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.csgptApiKey || "sk-csgpt-placeholder"}`,
      },
      body: JSON.stringify(requestBody),
    });

    // 如果 vLLM 返回错误
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[CSGPT API] vLLM 返回错误:", response.status, errorText);

      return NextResponse.json(
        {
          error: true,
          message: `模型服务返回错误: ${response.status}`,
          detail: errorText,
        },
        { status: response.status }
      );
    }

    // 处理流式响应
    if (stream) {
      // 创建 SSE 流式响应
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const transformStream = new TransformStream({
        async transform(chunk, controller) {
          const text = decoder.decode(chunk, { stream: true });
          // 直接转发 vLLM 的 SSE 数据
          controller.enqueue(encoder.encode(text));
        },
      });

      // 将 vLLM 的响应流通过 TransformStream 转发给前端
      const streamResponse = new Response(
        response.body?.pipeThrough(transformStream),
        {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        }
      );

      return streamResponse;
    } else {
      // 处理非流式响应
      const data = await response.json();
      return NextResponse.json(data);
    }
  } catch (error: any) {
    console.error("[CSGPT API] 请求处理错误:", error);

    // 判断错误类型
    if (error.name === "AbortError") {
      return NextResponse.json(
        { error: true, message: "请求超时，请稍后重试" },
        { status: 504 }
      );
    }

    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return NextResponse.json(
        { error: true, message: "模型服务不可用，请检查服务器状态" },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: true, message: "服务器内部错误", detail: error.message },
      { status: 500 }
    );
  }
}

// 处理 GET 请求（获取模型列表等）
export async function GET(req: NextRequest) {
  const config = getServerSideConfig();
  const url = new URL(req.url);
  const path = url.pathname;

  // 处理 /api/csgpt/models 请求
  if (path.endsWith("/models") || url.searchParams.has("models")) {
    // 返回 CSGPT 模型列表
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

  // 默认返回健康检查
  return NextResponse.json({ status: "ok", service: "CSGPT API" });
}

// 处理 OPTIONS 请求（CORS 预检）
export async function OPTIONS() {
  return NextResponse.json(
    { body: "OK" },
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    }
  );
}

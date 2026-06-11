import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { getUserFromRequest } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import {
  buildFemServiceJobUrl,
  buildFemServiceSubmissionPayload,
  formatSimulationValidationError,
  getFemServiceConfig,
  isFemServiceConfigured,
  normalizeSimulationJob,
  normalizeSimulationStatus,
  simulationJobCreateSchema,
  SIMULATION_STATUSES,
  type SimulationJobRecord,
} from "@/app/utils/simulation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonNoStore(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

async function requireUserId(request: NextRequest) {
  const userId = await getUserFromRequest(request);
  if (!userId) {
    return {
      userId: null,
      response: NextResponse.json({ error: "未授权" }, { status: 401 }),
    };
  }
  return { userId, response: null };
}

async function conversationBelongsToUser(
  conversationId: string | undefined,
  userId: string,
) {
  if (!conversationId) return true;
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  return Boolean(conversation);
}

function extractExternalJobId(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const value = record.externalJobId || record.jobId || record.id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractExternalResult(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  return "result" in record ? record.result : undefined;
}

function toPrismaJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function toNullablePrismaJson(value: unknown) {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

async function submitToFemService(job: SimulationJobRecord) {
  const config = getFemServiceConfig();
  const url = buildFemServiceJobUrl(config.baseUrl, config.jobsPath);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildFemServiceSubmissionPayload(job)),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as Record<string, unknown>).message)
        : text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    payload,
    externalJobId: extractExternalJobId(payload),
    status:
      normalizeSimulationStatus(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).status
          : undefined,
      ) || "submitted",
    result: extractExternalResult(payload),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireUserId(request);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const rawLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
    : 50;

  if (
    rawStatus &&
    !SIMULATION_STATUSES.includes(
      rawStatus as (typeof SIMULATION_STATUSES)[number],
    )
  ) {
    return jsonNoStore({ error: "仿真任务状态无效" }, { status: 400 });
  }

  const jobs = await prisma.simulationJob.findMany({
    where: {
      userId: auth.userId,
      ...(rawStatus ? { status: rawStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return jsonNoStore({
    jobs: jobs.map((job) => normalizeSimulationJob(job)),
    femServiceConfigured: isFemServiceConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireUserId(request);
  if (auth.response) return auth.response;

  try {
    const body = simulationJobCreateSchema.parse(await request.json());
    const ownsConversation = await conversationBelongsToUser(
      body.conversationId,
      auth.userId,
    );
    if (!ownsConversation) {
      return jsonNoStore({ error: "对话不存在" }, { status: 404 });
    }

    if (body.messageId && !body.submitToExternal) {
      const existing = await prisma.simulationJob.findFirst({
        where: {
          userId: auth.userId,
          conversationId: body.conversationId || null,
          messageId: body.messageId,
          solver: body.solver,
          title: body.title,
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        return jsonNoStore({
          job: normalizeSimulationJob(existing),
          existing: true,
        });
      }
    }

    let job = await prisma.simulationJob.create({
      data: {
        userId: auth.userId,
        conversationId: body.conversationId || null,
        messageId: body.messageId || null,
        solver: body.solver,
        status: "queued",
        title: body.title,
        input: toPrismaJson(body.input),
      },
    });

    if (!body.submitToExternal) {
      return jsonNoStore({ job: normalizeSimulationJob(job) }, { status: 201 });
    }

    if (!isFemServiceConfigured()) {
      return jsonNoStore(
        {
          job: normalizeSimulationJob(job),
          externalSubmission: { configured: false, submitted: false },
        },
        { status: 201 },
      );
    }

    try {
      const external = await submitToFemService(job);
      job = await prisma.simulationJob.update({
        where: { id: job.id },
        data: {
          status: external.status,
          externalJobId: external.externalJobId,
          ...(external.result !== undefined
            ? { result: toNullablePrismaJson(external.result) }
            : {}),
        },
      });
      return jsonNoStore({
        job: normalizeSimulationJob(job),
        externalSubmission: { configured: true, submitted: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job = await prisma.simulationJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: message.slice(0, 4000),
        },
      });
      return jsonNoStore(
        {
          error: "外部仿真服务提交失败",
          detail: message,
          job: normalizeSimulationJob(job),
        },
        { status: 502 },
      );
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonNoStore(
        { error: "参数无效", details: formatSimulationValidationError(error) },
        { status: 400 },
      );
    }

    if (error instanceof SyntaxError) {
      return jsonNoStore({ error: "请求体不是有效 JSON" }, { status: 400 });
    }

    return jsonNoStore({ error: "创建仿真任务失败" }, { status: 500 });
  }
}

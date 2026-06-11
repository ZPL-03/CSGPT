import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { getUserFromRequest } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import {
  formatSimulationValidationError,
  normalizeSimulationJob,
  simulationJobUpdateSchema,
} from "@/app/utils/simulation-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: { id: string };
};

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

function toNullablePrismaJson(value: unknown) {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUserId(request);
  if (auth.response) return auth.response;

  const job = await prisma.simulationJob.findFirst({
    where: { id: params.id, userId: auth.userId },
  });

  if (!job) {
    return jsonNoStore({ error: "仿真任务不存在" }, { status: 404 });
  }

  return jsonNoStore({ job: normalizeSimulationJob(job) });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUserId(request);
  if (auth.response) return auth.response;

  try {
    const body = simulationJobUpdateSchema.parse(await request.json());
    const existing = await prisma.simulationJob.findFirst({
      where: { id: params.id, userId: auth.userId },
      select: { id: true },
    });
    if (!existing) {
      return jsonNoStore({ error: "仿真任务不存在" }, { status: 404 });
    }

    const job = await prisma.simulationJob.update({
      where: { id: params.id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.result !== undefined
          ? { result: toNullablePrismaJson(body.result) }
          : {}),
        ...(body.error !== undefined ? { error: body.error } : {}),
        ...(body.externalJobId !== undefined
          ? { externalJobId: body.externalJobId }
          : {}),
      },
    });

    return jsonNoStore({ job: normalizeSimulationJob(job) });
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

    return jsonNoStore({ error: "更新仿真任务失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUserId(request);
  if (auth.response) return auth.response;

  const existing = await prisma.simulationJob.findFirst({
    where: { id: params.id, userId: auth.userId },
    select: { id: true },
  });
  if (!existing) {
    return jsonNoStore({ error: "仿真任务不存在" }, { status: 404 });
  }

  await prisma.simulationJob.delete({ where: { id: params.id } });
  return jsonNoStore({ success: true });
}

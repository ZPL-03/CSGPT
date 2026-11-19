import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT = path.join(process.cwd(), "data", "csllm");
const MANIFEST_PATH = path.join(DATA_ROOT, "provenance", "manifest.json");

type Manifest = {
  package?: string;
  generated_at?: string;
  record_counts?: {
    rag_chunks?: number;
    relations?: number;
    entities?: number;
  };
  files?: Array<{
    path: string;
    bytes: number;
    sha256: string;
    records: number | null;
  }>;
};

async function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function readRuntimePackage() {
  const manifestBytes = await readFile(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
  const files = await Promise.all(
    (manifest.files || []).map(async (entry) => {
      const actual = await stat(path.join(DATA_ROOT, entry.path));
      return {
        path: entry.path,
        expectedBytes: entry.bytes,
        actualBytes: actual.size,
        bytesMatch: actual.size === entry.bytes,
        declaredSha256: entry.sha256,
        records: entry.records,
      };
    }),
  );
  return {
    manifest,
    manifestSha256: await sha256(manifestBytes),
    files,
    filesMatch: files.every((file) => file.bytesMatch),
  };
}

export async function GET() {
  try {
    const runtimePackage = await readRuntimePackage();
    const counts = runtimePackage.manifest.record_counts || {};
    const healthy =
      runtimePackage.filesMatch &&
      typeof runtimePackage.manifest.generated_at === "string" &&
      typeof counts.rag_chunks === "number" &&
      typeof counts.relations === "number" &&
      typeof counts.entities === "number";
    const response = NextResponse.json(
      {
        status: healthy ? "ok" : "error",
        service: "csgpt",
        runtimePackage: {
          package: runtimePackage.manifest.package || null,
          generatedAt: runtimePackage.manifest.generated_at || null,
          recordCounts: counts,
          manifestSha256: runtimePackage.manifestSha256,
          filesMatch: runtimePackage.filesMatch,
          files: runtimePackage.files,
        },
        build: {
          environment: process.env.VERCEL_ENV || null,
          commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
          ref: process.env.VERCEL_GIT_COMMIT_REF || null,
        },
      },
      { status: healthy ? 200 : 503 },
    );
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate",
    );
    response.headers.set(
      "X-CSGPT-Runtime-Manifest-SHA256",
      runtimePackage.manifestSha256,
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        service: "csgpt",
        error: error instanceof Error ? error.message : "运行包不可用",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

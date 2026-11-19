import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createResearchRecorder,
  readReusableReport,
  redactResearchEvidence,
  selectResearchMode,
} from "../scripts/evaluation-research";

test("单模式检索要求定向入口并拒绝未知模式", () => {
  assert.equal(selectResearchMode(undefined, false), undefined);
  assert.equal(selectResearchMode("patent", true), "patent");
  assert.equal(selectResearchMode("academic", true), "academic");
  assert.throws(
    () => selectResearchMode("patent", false),
    /online-research-only/,
  );
  assert.throws(() => selectResearchMode("design", true));
});

test("在线证据保留真实响应，移除凭据且不记录请求头", async (t) => {
  const previousKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "test-secret-for-research-recording";
  t.after(() => {
    if (previousKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previousKey;
  });
  const requests: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init: RequestInit) => {
      requests.push(String(url));
      assert.ok(new Headers(init.headers).get("Authorization"));
      return Response.json({
        api_key: "unrecognized-upstream-secret",
        echoed: process.env.TAVILY_API_KEY,
        results: [
          {
            title: "Composite pressure vessel standard",
            url: "https://example.org/standard",
            content: "Scope and requirements",
          },
        ],
      });
    },
  );
  const recorder = createResearchRecorder();
  const result = await recorder.search({
    query: "composite pressure vessel standard",
    mode: "standard",
    provider: "tavily",
    maxResults: 1,
  });
  assert.equal(requests.length, 1);
  assert.equal(result.results.length, 1);
  assert.equal(recorder.attempts[0].requests[0].status, 200);
  assert.equal(recorder.attempts[0].outcome, "success");
  assert.ok(recorder.attempts[0].duration_ms >= 0);
  const evidence = JSON.stringify(recorder.attempts);
  assert.ok(evidence.includes("Scope and requirements"));
  assert.ok(evidence.includes("[REDACTED]"));
  assert.ok(!evidence.includes("unrecognized-upstream-secret"));
  assert.ok(!evidence.includes(process.env.TAVILY_API_KEY!));
  assert.ok(!evidence.includes("Authorization"));
  assert.equal(
    redactResearchEvidence(
      "https://example.org/search?q=materials&api_key=other",
    ),
    "https://example.org/search?q=materials&api_key=[REDACTED]",
  );
  const capture = {
    path: "captured-response.json",
    sha256: "a".repeat(64),
    attempts: recorder.attempts,
    result_review: [],
  };
  const replay = createResearchRecorder({ capture });
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("回放不得执行网络请求");
  });
  assert.deepEqual(
    await replay.search({
      query: "composite pressure vessel standard",
      mode: "standard",
      provider: "tavily",
      maxResults: 1,
    }),
    result,
  );
  assert.equal(replay.attempts[0].transport, "recorded-response");
  assert.equal(requests.length, 1);
  const unmatched = createResearchRecorder({ capture });
  await assert.rejects(
    unmatched.search({
      query: "a different query",
      mode: "standard",
      provider: "tavily",
      maxResults: 1,
    }),
    /没有与当前请求一致的原始响应/,
  );
});

test("失败响应保留且同一运行不重复请求失败 Provider", async (t) => {
  const previousKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "test-credential";
  t.after(() => {
    if (previousKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previousKey;
  });
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(
      {
        error: { message: "Account quota exhausted", code: "quota_exhausted" },
      },
      { status: 429 },
    );
  });
  const recorder = createResearchRecorder();
  await assert.rejects(
    recorder.search({
      query: "standards",
      mode: "standard",
      provider: "tavily",
      maxResults: 1,
    }),
    /429.*Account quota exhausted/,
  );
  assert.equal(globalThis.fetch, fetchMock);
  await assert.rejects(
    recorder.search({
      query: "patents",
      mode: "patent",
      provider: "tavily",
      maxResults: 1,
    }),
    /未重复请求/,
  );
  assert.equal(calls, 1);
  assert.equal(recorder.attempts[0].outcome, "error");
  assert.ok(
    recorder.attempts[0].requests[0].response_body?.includes("quota_exhausted"),
  );
  assert.equal(recorder.attempts[1].outcome, "not_requested");
  assert.deepEqual(recorder.attempts[1].requests, []);
});

test("报告复用逐项核对指纹，拒绝变化文件和失败报告", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "csgpt-report-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.method(process, "cwd", () => root);
  await mkdir(path.join(root, "app/utils"), { recursive: true });
  await mkdir(path.join(root, "evals/csgpt/results"), { recursive: true });
  const sourcePath = "app/utils/server-rag-kg.ts";
  const sourceText = "export const fixture = true;\n";
  await writeFile(path.join(root, sourcePath), sourceText);
  const fingerprints = [
    {
      path: sourcePath,
      bytes: Buffer.byteLength(sourceText),
      sha256: createHash("sha256").update(sourceText).digest("hex"),
    },
  ];
  const reportPath = "evals/csgpt/results/baseline.json";
  const report = {
    schema_version: 1,
    started_at: "2026-11-19T00:00:00Z",
    finished_at: "2026-11-19T00:01:00Z",
    files_before: fingerprints,
    files_after: fingerprints,
    files_unchanged: true,
    failures: [] as unknown[],
    results: ["standard", "patent", "academic"].map((name) => ({
      suite: "online-research",
      name,
      status: "skip",
    })),
    rag: [{ context: "Original evidence and applicability conditions" }],
  };
  await writeFile(path.join(root, reportPath), JSON.stringify(report));
  const reused = await readReusableReport(reportPath);
  assert.deepEqual(reused.report, report);
  assert.equal(
    reused.sha256,
    createHash("sha256")
      .update(await readFile(path.join(root, reportPath)))
      .digest("hex"),
  );
  assert.equal(reused.source_json_pointer, "#");
  const embeddedPath = "evals/csgpt/results/current.json";
  const embedded = {
    schema_version: 3,
    reused_report: {
      ...reused,
      path: "evals/csgpt/results/recycled-original.json",
      path_role: "historical_origin",
      source_path_status: "recycled_after_embedding",
    },
  };
  await writeFile(path.join(root, embeddedPath), JSON.stringify(embedded));
  const independent = await readReusableReport(embeddedPath);
  assert.equal(independent.source_json_pointer, "#/reused_report/report");
  assert.deepEqual(independent.report, report);
  embedded.reused_report.embedded_evidence.sha256 = "0".repeat(64);
  await writeFile(path.join(root, embeddedPath), JSON.stringify(embedded));
  await assert.rejects(readReusableReport(embeddedPath), /嵌入报告.*指纹/);
  await writeFile(path.join(root, sourcePath), "changed");
  await assert.rejects(readReusableReport(reportPath), /复用证据文件已变化/);
  report.failures.push({ message: "retained failure" });
  await writeFile(path.join(root, reportPath), JSON.stringify(report));
  await assert.rejects(readReusableReport(reportPath));
  await assert.rejects(readReusableReport("../outside.json"), /须位于/);
});

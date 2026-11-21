import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { after, before, mock, test } from "node:test";
import tls from "node:tls";
import { createGunzip } from "node:zlib";
import { NextRequest } from "next/server";
import { CSGPT_DEFAULT_MODEL } from "../../app/constant";
import { parseControlledToolRecordsHeader } from "../../app/utils/controlled-tool-records";
import {
  countRagKgDocumentSources,
  parseRagKgSourcesHeader,
  type RagKgSource,
} from "../../app/utils/rag-kg-sources";
import type { RagEvidence } from "../../app/utils/rag-evidence";
import type { KnowledgeGraphQueryResult } from "../../app/utils/server-rag-kg";

type Manifest = {
  generated_at: string;
  record_counts: { rag_chunks: number; relations: number; entities: number };
  files: Array<{ path: string; sha256: string }>;
};

const root = path.resolve("data/csllm");
const environment = {
  CSGPT_CS1_BASE_URL: "https://model.invalid/v1",
  CSGPT_CS1_API_KEY: "",
  CSGPT_CS1_UPSTREAM_MODEL_NAME: "runtime-test",
  CSGPT_CS1_CONTEXT_LENGTH: "32768",
  CSGPT_EVAL_ONLINE: "0",
  CSGPT_EVAL_DESIGN_ONLINE: "0",
  ENABLE_MCP: "false",
  JWT_SECRET: "csllm-runtime-test-only",
  DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline",
};
const previousEnvironment = Object.fromEntries(
  Object.keys(environment).map((key) => [key, process.env[key]]),
);
let POST: typeof import("../../app/api/[provider]/[...path]/route").POST;
let GET: typeof import("../../app/api/knowledge-graph/route").GET;
let healthGET: typeof import("../../app/api/health/route").GET;
let prisma: typeof import("../../app/lib/prisma").prisma;
let generateToken: typeof import("../../app/lib/auth").generateToken;
let manifest: Manifest;
let initialHashes: Record<string, string>;
let networkAttempts = 0;
let databaseAttempts = 0;
const contexts: Array<{ text: string; sources: RagKgSource[] }> = [];
let fullWindowSourceCount = 0;
const graphPackets: RagEvidence[] = [];

async function packageHashes() {
  const hashes: Record<string, string> = {};
  for (const file of [
    "provenance/manifest.json",
    ...manifest.files.map((entry) => entry.path),
  ]) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path.join(root, file)))
      hash.update(chunk);
    hashes[file] = hash.digest("hex");
  }
  return hashes;
}

before(async () => {
  Object.assign(process.env, environment);
  // 只允许 tsx 的本机进程通信；模型、检索 Provider 和数据库均不能出站。
  const denyNetwork = () => {
    networkAttempts += 1;
    throw new Error("运行包验收禁止网络请求");
  };
  mock.method(globalThis, "fetch", denyNetwork);
  for (const transport of [http, https]) {
    mock.method(transport, "request", denyNetwork);
    mock.method(transport, "get", denyNetwork);
  }
  const connect = net.Socket.prototype.connect;
  mock.method(
    net.Socket.prototype,
    "connect",
    function (this: net.Socket, ...args: any[]) {
      const first = Array.isArray(args[0]) ? args[0][0] : args[0];
      const socketPath = typeof first === "string" ? first : first?.path;
      if (
        typeof socketPath === "string" &&
        (/^\\\\[.?]\\pipe\\/.test(socketPath) || socketPath.startsWith("/"))
      )
        return connect.apply(this, args as Parameters<typeof connect>);
      return denyNetwork();
    },
  );
  mock.method(tls, "connect", denyNetwork);
  syncBuiltinESMExports();

  ({ prisma } = await import("../../app/lib/prisma"));
  const denyDatabase = () => {
    databaseAttempts += 1;
    throw new Error("运行包验收禁止访问数据库");
  };
  prisma.$use(async () => denyDatabase());
  mock.method(prisma, "$connect", async () => denyDatabase());
  ({ generateToken } = await import("../../app/lib/auth"));
  ({ POST } = await import("../../app/api/[provider]/[...path]/route"));
  ({ GET } = await import("../../app/api/knowledge-graph/route"));
  ({ GET: healthGET } = await import("../../app/api/health/route"));
  manifest = JSON.parse(
    await readFile(path.join(root, "provenance/manifest.json"), "utf8"),
  );
  initialHashes = await packageHashes();
  for (const file of manifest.files)
    assert.equal(initialHashes[file.path], file.sha256, file.path);
});

after(async () => {
  try {
    assert.equal(networkAttempts, 0);
    assert.equal(databaseAttempts, 0);
    assert.deepEqual(await packageHashes(), initialHashes);
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

for (const scenario of [
  { enabled: true, stream: false, query: "复合材料耐压壳 外压 屈曲 设计" },
  {
    enabled: true,
    stream: true,
    query: "ASME NASA ANSYS buckling pressure t1 t2",
  },
  {
    enabled: true,
    stream: true,
    query: "ASME NASA ANSYS buckling pressure t1 t2",
    contextLength: 8192,
  },
  { enabled: false, stream: false, query: "复合材料耐压壳 外压 屈曲 设计" },
]) {
  test(`聊天路由真实运行包 enabled=${scenario.enabled} stream=${scenario.stream} context=${scenario.contextLength ?? environment.CSGPT_CS1_CONTEXT_LENGTH}`, async (t) => {
    if (scenario.contextLength) {
      process.env.CSGPT_CS1_CONTEXT_LENGTH = String(scenario.contextLength);
      t.after(() => {
        process.env.CSGPT_CS1_CONTEXT_LENGTH =
          environment.CSGPT_CS1_CONTEXT_LENGTH;
      });
    }
    let messages: Array<{ role: string; content: string }> = [];
    const upstream = t.mock.method(
      globalThis,
      "fetch",
      async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
        assert.equal(url, "https://model.invalid/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "runtime-test");
        assert.equal(body.stream, scenario.stream);
        messages = body.messages;
        const completion = scenario.stream
          ? { delta: { content: "fixture" }, finish_reason: "stop", index: 0 }
          : {
              message: { content: "fixture" },
              finish_reason: "stop",
              index: 0,
            };
        return scenario.stream
          ? new Response(
              `data: ${JSON.stringify({
                choices: [completion],
              })}\n\ndata: [DONE]\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            )
          : Response.json({ choices: [completion] });
      },
    );
    const response = await POST(
      new NextRequest("http://localhost/api/csgpt/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CSGPT_DEFAULT_MODEL,
          messages: [
            ...(scenario.contextLength
              ? [
                  {
                    role: "system",
                    content: "载荷与边界条件使用已给定的单位。".repeat(90),
                  },
                ]
              : []),
            { role: "user", content: scenario.query },
          ],
          stream: scenario.stream,
          max_tokens: 512,
          csgpt_internal_knowledge_enabled: scenario.enabled,
          csgpt_web_search_enabled: false,
          csgpt_academic_search_enabled: false,
          csgpt_session_file_knowledge_enabled: false,
          csgpt_user_file_knowledge_enabled: false,
        }),
      }),
      {
        params: Promise.resolve({
          provider: "csgpt",
          path: ["chat", "completions"],
        }),
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(upstream.mock.callCount(), 1);
    assert.ok(messages.some((message) => message.content === scenario.query));
    const sources = parseRagKgSourcesHeader(response);
    const tools = parseControlledToolRecordsHeader(response);
    if (scenario.enabled) {
      assert.ok(sources.some((source) => source.kind === "document"));
      if (scenario.contextLength) {
        assert.ok(sources.length < fullWindowSourceCount);
      } else if (scenario.stream) {
        fullWindowSourceCount = sources.length;
      }
      assert.equal(
        new Set(sources.map((source) => source.id)).size,
        sources.length,
      );
      assert.equal(tools.length, 1);
      assert.equal(tools[0].id, "csgpt-rag-kg");
      const invocation = JSON.parse(tools[0].function.arguments);
      assert.equal(invocation.status, "completed");
      assert.equal(invocation.count, countRagKgDocumentSources(sources));
      contexts.push({
        text: messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n"),
        sources,
      });
    } else {
      assert.deepEqual(sources, []);
      assert.deepEqual(tools, []);
    }
    if (scenario.stream) {
      const events = (await response.text()).split("\n\n").filter(Boolean);
      assert.equal(events.at(-1), "data: [DONE]");
      const chunks = events
        .slice(0, -1)
        .map((event) => JSON.parse(event.slice(6)));
      const completions = chunks.flatMap((chunk) => chunk.choices);
      assert.equal(completions.at(-1).finish_reason, "stop");
      assert.equal(
        completions.filter((choice) => choice.finish_reason != null).length,
        1,
      );
      assert.equal(
        completions.map((choice) => choice.delta.content || "").join(""),
        "fixture",
      );
    } else {
      assert.equal((await response.json()).choices[0].finish_reason, "stop");
    }
    t.diagnostic(
      `sources=${
        sources.length
      }; upstream_stub_calls=${upstream.mock.callCount()}`,
    );
  });
}

test("KG 未授权请求不读取用户数据库", async () => {
  const response = await GET(
    new NextRequest("http://localhost/api/knowledge-graph"),
  );
  assert.equal(response.status, 401);
  assert.equal(databaseAttempts, 0);
});

test("健康路由报告实际运行包 manifest 和构建身份，不访问数据库", async () => {
  const response = await healthGET();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(
    response.headers.get("Cache-Control"),
    "no-store, no-cache, must-revalidate",
  );
  assert.equal(
    response.headers.get("X-CSGPT-Runtime-Manifest-SHA256"),
    initialHashes["provenance/manifest.json"],
  );
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.runtimePackage.generatedAt, manifest.generated_at);
  assert.deepEqual(body.runtimePackage.recordCounts, manifest.record_counts);
  assert.equal(
    body.runtimePackage.manifestSha256,
    initialHashes["provenance/manifest.json"],
  );
  assert.equal(body.runtimePackage.filesMatch, true);
  assert.deepEqual(
    body.runtimePackage.files.map((file: any) => file.path),
    manifest.files.map((file) => file.path),
  );
  assert.equal(databaseAttempts, 0);
});

for (const query of ["composite pressure vessel buckling", ""]) {
  test(`KG 路由真实运行包 mode=${query ? "query" : "overview"}`, async (t) => {
    // 认证只接受专用内存身份，关系搜索、证据绑定和响应序列化使用正式实现。
    const originalQuery = prisma.user.findUnique;
    const lookup = t.mock.fn(async (args: unknown) => {
      assert.deepEqual(args, {
        where: { id: "runtime-fixture" },
        select: { id: true },
      });
      return { id: "runtime-fixture" };
    });
    prisma.user.findUnique = lookup as unknown as typeof originalQuery;
    t.after(() => {
      prisma.user.findUnique = originalQuery;
    });
    const url = new URL("http://localhost/api/knowledge-graph");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "40");
    const response = await GET(
      new NextRequest(url, {
        headers: {
          Authorization: `Bearer ${generateToken("runtime-fixture")}`,
        },
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(lookup.mock.callCount(), 1);
    assert.ok(response.headers.get("Cache-Control")?.includes("no-store"));
    const graph: KnowledgeGraphQueryResult = await response.json();
    assert.equal(graph.mode, query ? "query" : "overview");
    assert.equal(graph.stats.totalEntities, manifest.record_counts.entities);
    assert.equal(graph.stats.totalRelations, manifest.record_counts.relations);
    assert.equal(graph.stats.returnedNodes, graph.nodes.length);
    assert.equal(graph.stats.returnedEdges, graph.edges.length);
    assert.ok(graph.nodes.length >= 2 && graph.nodes.length <= 40);
    assert.ok(graph.edges.length > 0 && graph.edges.length <= 46);
    assert.ok(graph.stats.matchedRelations >= graph.edges.length);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    assert.equal(nodeIds.size, graph.nodes.length);
    assert.equal(
      new Set(graph.edges.map((edge) => edge.id)).size,
      graph.edges.length,
    );
    for (const edge of graph.edges) {
      assert.ok(nodeIds.has(edge.source) && nodeIds.has(edge.target));
      assert.equal(edge.recordId, edge.evidence.record_id);
      assert.equal(edge.evidence.retrieval_eligible, true);
      graphPackets.push(edge.evidence);
    }
    t.diagnostic(
      `nodes=${graph.nodes.length}; edges=${graph.edges.length}; matched=${graph.stats.matchedRelations}`,
    );
  });
}

test("路由引用逐项对应当前 gzip 分块，条件及表格列投影完整进入请求", async (t) => {
  const references = [
    ...contexts.flatMap((context) =>
      context.sources.map((source) => {
        assert.ok(source.evidence);
        return source.evidence;
      }),
    ),
    ...graphPackets,
  ];
  assert.ok(references.length > 0);
  const ids = new Set(references.map((reference) => reference.chunk_id));
  const rows = new Map<string, Record<string, any>>();
  const stream = createReadStream(
    path.join(root, "runtime/rag_chunks.compact.jsonl.gz"),
  );
  const reader = readline.createInterface({
    input: stream.pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!ids.has(row.chunk_id)) continue;
    assert.ok(!rows.has(row.chunk_id));
    rows.set(row.chunk_id, row);
  }
  assert.equal(rows.size, ids.size);
  for (const reference of references) {
    const row = rows.get(reference.chunk_id)!;
    assert.equal(reference.record_id, row.record_id);
    assert.equal(reference.chunk_fingerprint, row.chunk_fingerprint);
    assert.equal(row.retrieval_eligible, true);
  }
  for (const packet of graphPackets) {
    const row = rows.get(packet.chunk_id)!;
    assert.deepEqual(packet.applicability_context, row.applicability_context);
    assert.deepEqual(packet.table_evidence, row.table_evidence);
    assert.equal(packet.content_quality_version, row.content_quality_version);
  }
  for (const context of contexts) {
    for (const source of context.sources) {
      const row = rows.get(source.evidence!.chunk_id)!;
      assert.ok(context.text.includes(`分块标识：${row.chunk_id}`), source.id);
      assert.ok(context.text.includes(`分块指纹：${row.chunk_fingerprint}`), source.id);
      for (const condition of row.applicability_context)
        assert.ok(context.text.includes(condition), source.id);
      if (row.table_evidence.length)
        assert.ok(
          context.text.includes(JSON.stringify(row.table_evidence)),
          source.id,
        );
    }
  }
  assert.ok(
    contexts.some((context) =>
      context.sources.some((source) =>
        rows
          .get(source.evidence!.chunk_id)!
          .table_evidence.some((table: any) => table.column_projection),
      ),
    ),
  );
  t.diagnostic(
    `generatedAt=${manifest.generated_at}; manifest=${initialHashes["provenance/manifest.json"]}; verified_chunks=${rows.size}`,
  );
});

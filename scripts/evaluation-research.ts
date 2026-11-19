import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  executeResearchSearch,
  isCompositeMaterialsResult,
  isPatentDocumentUrl,
  type ResearchSearchMode,
  type ResearchSearchProvider,
} from "../app/utils/research-search-registry";

// 单模式选择只作用于外部检索入口，避免定向验证触发其他在线服务。
export function selectResearchMode(
  value: string | undefined,
  onlineOnly: boolean,
) {
  if (value === undefined) return undefined;
  if (!onlineOnly)
    throw new Error("--research-mode 要求 --online-research-only");
  return z.enum(["web", "standard", "patent", "academic"]).parse(value);
}

const fingerprintSchema = z.object({
  path: z.string(),
  bytes: z.number(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const reusableReportSchema = z
  .object({
    schema_version: z.literal(1),
    started_at: z.string(),
    finished_at: z.string(),
    files_before: z.array(fingerprintSchema),
    files_after: z.array(fingerprintSchema),
    files_unchanged: z.literal(true),
    results: z.array(
      z.object({
        suite: z.string(),
        name: z.string(),
        status: z.enum(["pass", "skip"]),
        detail: z.string().optional(),
      }),
    ),
    failures: z.array(z.unknown()).length(0),
  })
  .passthrough();

// 复用只接受完整成功报告；数据和消费代码必须仍与原始证据一致。
export async function readReusableReport(file: string) {
  const resolved = path.resolve(file);
  const relative = path.relative(path.resolve("evals/csgpt/results"), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("复用报告须位于 evals/csgpt/results 下");
  }
  const bytes = fs.readFileSync(resolved);
  const rawReport = JSON.parse(bytes.toString("utf8"));
  const embedded = rawReport.reused_report;
  const sourcePointer = embedded ? "#/reused_report/report" : "#";
  if (embedded?.embedded_evidence) {
    const identity = embedded.embedded_evidence;
    if (
      identity.json_pointer !== sourcePointer ||
      identity.serialization !== "JSON.stringify(value)" ||
      identity.sha256 !==
        createHash("sha256")
          .update(JSON.stringify(embedded.report))
          .digest("hex")
    )
      throw new Error("嵌入报告的定位或内容指纹不一致");
  }
  const report = reusableReportSchema.parse(
    embedded ? embedded.report : rawReport,
  );
  if (
    report.results.filter((entry) => entry.suite === "online-research")
      .length !== 3 ||
    report.results.some(
      (entry) => entry.suite === "online-research" && entry.status !== "skip",
    )
  ) {
    throw new Error("复用报告须包含三个未执行的在线检索用例");
  }
  if (
    JSON.stringify(report.files_before) !== JSON.stringify(report.files_after)
  ) {
    throw new Error("复用报告的运行前后文件指纹不一致");
  }
  const checkedFiles: string[] = [];
  for (const entry of report.files_after) {
    // 评测入口的执行范围和记录方式独立于被复用的应用计算结果。
    if (entry.path === "scripts/evaluate-csgpt.ts") continue;
    const target = path.resolve(entry.path);
    const localPath = path.relative(process.cwd(), target);
    if (localPath.startsWith("..") || path.isAbsolute(localPath)) {
      throw new Error(`复用证据路径超出项目：${entry.path}`);
    }
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of fs.createReadStream(target)) {
      hash.update(chunk);
      size += chunk.length;
    }
    if (hash.digest("hex") !== entry.sha256 || size !== entry.bytes) {
      throw new Error(`复用证据文件已变化：${entry.path}`);
    }
    checkedFiles.push(entry.path);
  }
  if (!checkedFiles.includes("app/utils/server-rag-kg.ts")) {
    throw new Error("复用报告缺少知识消费实现指纹");
  }
  return {
    path: path.relative(process.cwd(), resolved).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source_json_pointer: sourcePointer,
    embedded_evidence: {
      json_pointer: "#/reused_report/report",
      serialization: "JSON.stringify(value)",
      sha256: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    },
    checked_files: checkedFiles,
    evaluator_fingerprint_policy:
      "保留原评测入口指纹；定向执行与响应记录使用当前入口，应用与数据指纹逐项核对",
    report,
  };
}

const credentialName =
  /authorization|cookie|api[-_]?key|token|secret|password/i;

// 请求头不进入证据；响应中的凭据字段、URL 查询凭据和环境密钥统一脱敏。
export function redactResearchEvidence(value: string) {
  let text = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (credentialName.test(name) && secret && secret.length >= 6) {
      text = text.split(secret).join("[REDACTED]");
      text = text.split(encodeURIComponent(secret)).join("[REDACTED]");
    }
  }
  text = text.replace(
    /([?&](?:api[-_]?key|token|access_token|secret|password)=)[^&\s"<>]*/gi,
    "$1[REDACTED]",
  );
  try {
    return JSON.stringify(
      JSON.parse(text),
      (key, item) => (credentialName.test(key) ? "[REDACTED]" : item),
      2,
    );
  } catch {
    return text;
  }
}

export type ResearchAttempt = {
  provider: ResearchSearchProvider;
  mode: ResearchSearchMode;
  query: string;
  started_at: string;
  duration_ms: number;
  outcome: "success" | "error" | "not_requested";
  transport: "live" | "recorded-response";
  error?: string;
  result?: Awaited<ReturnType<typeof executeResearchSearch>>;
  requests: Array<{
    url: string;
    method: string;
    body?: string;
    status?: number;
    content_type?: string;
    response_body?: string;
    error?: string;
  }>;
};

export function readResearchCapture(file: string) {
  const bytes = fs.readFileSync(file);
  const data = JSON.parse(bytes.toString("utf8"));
  const attempts: ResearchAttempt[] = data.online_research;
  if (!Array.isArray(attempts) || !attempts.length) {
    throw new Error("原始证据缺少在线检索请求");
  }
  for (const attempt of attempts) {
    if (!Array.isArray(attempt.requests) || attempt.requests.length !== 1) {
      throw new Error("回放证据要求每个 Provider 用例恰好一次 HTTP 请求");
    }
  }
  return {
    path: path
      .relative(process.cwd(), path.resolve(file))
      .replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    attempts,
    result_review: attempts.flatMap((attempt) => {
      const invalid = (attempt.result?.results || []).filter((result) =>
        attempt.mode === "patent"
          ? !isPatentDocumentUrl(result.url)
          : attempt.mode === "academic" && !isCompositeMaterialsResult(result),
      );
      return invalid.map((result) => ({
        provider: attempt.provider,
        mode: attempt.mode,
        status: "fail",
        title: result.title,
        url: result.url,
        reason:
          attempt.mode === "patent"
            ? "来源未定位到具体专利文献"
            : "题名和摘要未提供复合材料体系依据",
      }));
    }),
  };
}

export function createResearchRecorder(options?: {
  capture: ReturnType<typeof readResearchCapture>;
}) {
  const attempts: ResearchAttempt[] = [];
  const failedProviders = new Map<ResearchSearchProvider, string>();
  let active = false;
  return {
    attempts,
    async search(input: {
      query: string;
      mode: ResearchSearchMode;
      provider: ResearchSearchProvider;
      maxResults: number;
    }) {
      if (active) throw new Error("在线检索证据记录须串行执行");
      const attempt: ResearchAttempt = {
        provider: input.provider,
        mode: input.mode,
        query: input.query,
        started_at: new Date().toISOString(),
        duration_ms: 0,
        outcome: "not_requested",
        transport: options ? "recorded-response" : "live",
        requests: [],
      };
      attempts.push(attempt);
      const earlierFailure = failedProviders.get(input.provider);
      if (earlierFailure) {
        attempt.error = `同一运行中 ${input.provider} 已失败，未重复请求：${earlierFailure}`;
        throw new Error(attempt.error);
      }
      const started = performance.now();
      const originalFetch = globalThis.fetch;
      active = true;
      const recorded = options?.capture.attempts.find(
        (entry) =>
          entry.provider === input.provider &&
          entry.mode === input.mode &&
          entry.query === input.query,
      );
      globalThis.fetch = async (resource, init) => {
        const url = new URL(
          resource instanceof Request ? resource.url : resource.toString(),
        );
        url.username = "";
        url.password = "";
        const request: ResearchAttempt["requests"][number] = {
          url: redactResearchEvidence(url.toString()),
          method: init?.method || "GET",
          body:
            typeof init?.body === "string"
              ? redactResearchEvidence(init.body)
              : undefined,
        };
        attempt.requests.push(request);
        try {
          let response: Response;
          if (attempt.transport === "recorded-response") {
            const saved = recorded?.requests[0];
            // 请求必须与已采集响应对应；回放缺失时明确失败，不转为外部请求。
            if (
              !saved ||
              request.url !== saved.url ||
              request.method !== saved.method ||
              request.body !== saved.body
            ) {
              throw new Error("没有与当前请求一致的原始响应，未执行网络请求");
            }
            if (saved.error) throw new Error(saved.error);
            if (
              saved.status === undefined ||
              saved.response_body === undefined
            ) {
              throw new Error("原始响应缺少状态或正文");
            }
            response = new Response(saved.response_body, {
              status: saved.status,
              headers: {
                "content-type": saved.content_type || "application/json",
              },
            });
          } else {
            response = await originalFetch(resource, init);
          }
          request.status = response.status;
          request.content_type =
            response.headers.get("content-type") || undefined;
          request.response_body = redactResearchEvidence(
            await response.clone().text(),
          );
          return response;
        } catch (error) {
          request.error = redactResearchEvidence(
            error instanceof Error ? error.message : String(error),
          );
          throw error;
        }
      };
      try {
        const result = await executeResearchSearch(input);
        attempt.result = JSON.parse(
          redactResearchEvidence(JSON.stringify(result)),
        );
        attempt.outcome = "success";
        return result;
      } catch (error) {
        const message = redactResearchEvidence(
          error instanceof Error ? error.message : String(error),
        );
        attempt.outcome = "error";
        attempt.error = message;
        failedProviders.set(input.provider, message);
        throw new Error(message);
      } finally {
        globalThis.fetch = originalFetch;
        attempt.duration_ms =
          Math.round((performance.now() - started) * 100) / 100;
        active = false;
      }
    },
  };
}

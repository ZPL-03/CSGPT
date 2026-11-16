import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { CSGPT_MODEL_2 } from "../app/constant";
import { CSGPT_NUMBER_DISPLAY_RULE } from "../app/prompts/csgpt";
import { POST } from "../app/api/[provider]/[...path]/route";
import { CSGPT_DESIGN_ARTIFACT_FIELD } from "../app/utils/structured-design";
import { designFixture } from "./helpers/design-fixtures";

const question =
  "设计50组复合材料耐压壳方案，水深5000米，圆柱壳长度600mm，内半径150mm。";

// 路由测试只替换 HTTP 服务，保留意图解析、合同校验和响应拼装。

for (const mode of [
  "complete",
  "stream",
  "empty",
  "tool_error",
  "tokenizer_error",
  "context_error",
] as const) {
  test(`CS2 POST 工具候选路由：${mode}`, async (t) => {
    const environment = {
      CSGPT_CS2_BASE_URL: "https://llm.invalid/v1",
      CSGPT_CS2_API_KEY: "",
      CSGPT_CS2_UPSTREAM_MODEL_NAME: "test-adapter",
      CSGPT_CS2_CONTEXT_LENGTH: "32768",
      CSGPT_CS2_DESIGN_BASE_URL: "https://design.invalid/v1",
      CSGPT_CS2_DESIGN_API_KEY: "",
    };
    const previous = Object.fromEntries(
      Object.keys(environment).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, environment);
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const calls: string[] = [];
    t.mock.method(
      globalThis,
      "fetch",
      async (url: string, init: RequestInit) => {
        calls.push(url);
        const body = JSON.parse(String(init.body));
        if (url === "https://design.invalid/v1/design/candidates") {
          assert.equal(body.candidate_count, 50);
          assert.deepEqual(body.parameter_values.service_depth_m, [5000]);
          const fixture = designFixture("concept");
          for (const [key, value] of Object.entries(body)) {
            assert.deepEqual(fixture.result.request[key], value);
          }
          if (mode === "context_error") {
            fixture.interpretation_context.design_fingerprint = "wrong-design";
          }
          return mode === "tool_error"
            ? Response.json({ detail: "设计输入无效" }, { status: 422 })
            : Response.json(fixture);
        }
        if (url === "https://llm.invalid/tokenize") {
          assert.equal(body.model, "test-adapter");
          assert.ok(
            body.messages.some((message: any) => message.content === question),
          );
          return mode === "tokenizer_error"
            ? Response.json({ error: "unavailable" }, { status: 503 })
            : Response.json({ count: 31000, max_model_len: 32768 });
        }
        assert.equal(url, "https://llm.invalid/v1/chat/completions");
        assert.equal(body.model, "test-adapter");
        assert.ok(body.max_tokens > 0 && body.max_tokens < 4096);
        assert.ok(
          body.messages.some((message: any) => message.content === question),
        );
        assert.equal(
          body.messages.filter(
            (message: any) =>
              message.role === "system" &&
              message.content === CSGPT_NUMBER_DISPLAY_RULE,
          ).length,
          1,
        );
        assert.ok(
          body.messages.some(
            (message: any) =>
              typeof message.content === "string" &&
              message.content.includes('"当前有限元结果":null'),
          ),
        );
        if (mode === "stream") {
          const events = [
            {
              choices: [
                {
                  index: 0,
                  delta: { content: "候选采用对称均衡铺层。" },
                  finish_reason: null,
                },
              ],
            },
            { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          ];
          return new Response(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join("") + "data: [DONE]\n\n",
          );
        }
        return Response.json({
          choices: [
            {
              index: 0,
              message: {
                content: mode === "empty" ? "" : "候选采用对称均衡铺层。",
              },
              finish_reason: "stop",
            },
          ],
        });
      },
    );

    const response = await POST(
      new NextRequest("http://localhost/api/csgpt/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CSGPT_MODEL_2,
          stream: mode === "stream",
          messages: [
            ...(mode === "stream"
              ? [{ role: "system", content: "按用户指定工况解释设计。" }]
              : []),
            { role: "user", content: question },
          ],
        }),
      }),
      { params: { provider: "csgpt", path: ["chat", "completions"] } },
    );
    if (mode === "complete") {
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.choices[0].finish_reason, "stop");
      assert.equal(
        data[CSGPT_DESIGN_ARTIFACT_FIELD].result.candidate_count,
        50,
      );
      assert.ok(data.choices[0].message.content.includes("| 50 |"));
    } else if (mode === "stream") {
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(
        text.indexOf("| 50 |") < text.lastIndexOf('"finish_reason":"stop"'),
      );
      assert.ok(text.endsWith("data: [DONE]\n\n"));
    } else {
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error, true);
      assert.equal(
        calls.length,
        mode === "tool_error" || mode === "context_error"
          ? 1
          : mode === "tokenizer_error"
          ? 2
          : 3,
      );
    }
  });
}

test("冲突输入通过路由返回 422，不调用设计或模型服务", async (t) => {
  const previous = process.env.CSGPT_CS2_BASE_URL;
  process.env.CSGPT_CS2_BASE_URL = "https://llm.invalid/v1";
  t.after(() => {
    if (previous === undefined) delete process.env.CSGPT_CS2_BASE_URL;
    else process.env.CSGPT_CS2_BASE_URL = previous;
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("冲突输入不应发起 HTTP 请求");
  });
  const response = await POST(
    new NextRequest("http://localhost/api/csgpt/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CSGPT_MODEL_2,
        messages: [
          {
            role: "user",
            content:
              "生成2组FEM-ready复合材料耐压壳方案，外压20MPa，长度600mm，内半径150mm，两端固支，两端简支。",
          },
        ],
      }),
    }),
    { params: { provider: "csgpt", path: ["chat", "completions"] } },
  );
  assert.equal(response.status, 422);
  assert.match((await response.json()).message, /边界.*冲突/);
});

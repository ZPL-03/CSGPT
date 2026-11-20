import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  CSGPT_DEFAULT_MODEL,
  CSGPT_MODEL_2,
  CSGPT_MODEL_3,
} from "../app/constant";
import { designArtifactMessage } from "../app/utils/design-context";
import { CSGPT_SYSTEM_PROMPT } from "../app/prompts/csgpt";
import { POST } from "../app/api/[provider]/[...path]/route";
import { CSGPT_DESIGN_ARTIFACT_FIELD } from "../app/utils/structured-design";
import {
  designFixture,
  designNarrativeFixture,
} from "./helpers/design-fixtures";

const question =
  "设计50组复合材料耐压壳方案，水深5000米，圆柱壳长度600mm，内半径150mm。";
const sessionPrompt = "按用户指定工况解释设计。";

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
          assert.deepEqual(body.chat_template_kwargs, {
            enable_thinking: false,
          });
          assert.equal(body.messages.at(-1)?.role, "user");
          assert.ok(body.messages.at(-1)?.content.includes(question));
          assert.ok(
            body.messages.at(-1)?.content.includes('"当前有限元结果":null'),
          );
          return mode === "tokenizer_error"
            ? Response.json({ error: "unavailable" }, { status: 503 })
            : Response.json({ count: 31000, max_model_len: 32768 });
        }
        assert.equal(url, "https://llm.invalid/v1/chat/completions");
        assert.equal(body.model, "test-adapter");
        assert.equal(body.response_format.type, "json_schema");
        assert.deepEqual(
          body.response_format.json_schema.schema.required,
          Object.keys(designNarrativeFixture),
        );
        assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
        assert.ok(body.max_tokens > 0 && body.max_tokens < 4096);
        assert.equal(body.messages.at(-1)?.role, "user");
        assert.ok(body.messages.at(-1)?.content.includes(question));
        assert.equal(
          body.messages.filter(
            (message: any) =>
              message.role === "system" &&
              message.content === CSGPT_SYSTEM_PROMPT,
          ).length,
          1,
        );
        assert.equal(
          body.messages.some(
            (message: any) =>
              message.role === "system" && message.content === sessionPrompt,
          ),
          mode === "stream",
        );
        assert.ok(
          body.messages.at(-1)?.content.includes('"当前有限元结果":null'),
        );
        if (mode === "stream") {
          const events = [
            {
              choices: [
                {
                  index: 0,
                  delta: { content: JSON.stringify(designNarrativeFixture) },
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
                content:
                  mode === "empty"
                    ? ""
                    : JSON.stringify(designNarrativeFixture),
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
              ? [{ role: "system", content: sessionPrompt }]
              : []),
            { role: "user", content: question },
          ],
        }),
      }),
      {
        params: Promise.resolve({
          provider: "csgpt",
          path: ["chat", "completions"],
        }),
      },
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
      assert.ok(data.choices[0].message.content.startsWith("### 方案取舍"));
    } else if (mode === "stream") {
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(
        text.indexOf("| 50 |") < text.lastIndexOf('"finish_reason":"stop"'),
      );
      assert.ok(text.endsWith("data: [DONE]\n\n"));
      assert.ok(text.includes("### 有限元校核"));
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

// 普通问答走 CS1 通用代理或 CS2/CS3 专用代理，均需要验证终态。
for (const model of [CSGPT_DEFAULT_MODEL, CSGPT_MODEL_2, CSGPT_MODEL_3]) {
  for (const stream of [false, true]) {
    for (const reason of [
      "stop",
      "length",
      "content_filter",
      "tool_calls",
      null,
    ]) {
      test(`${model} 普通问答 stream=${stream} finish_reason=${reason}`, async (t) => {
        const env = {
          CSGPT_CS1_BASE_URL: "https://llm.invalid/v1",
          CSGPT_CS2_BASE_URL: "https://llm.invalid/v1",
          CSGPT_CS3_BASE_URL: "https://llm.invalid/v1",
        };
        const previous = Object.fromEntries(
          Object.keys(env).map((key) => [key, process.env[key]]),
        );
        Object.assign(process.env, env);
        t.after(() => {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        });
        t.mock.method(
          globalThis,
          "fetch",
          async (url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            assert.deepEqual(body.chat_template_kwargs, {
              enable_thinking: false,
            });
            if (url.endsWith("/tokenize"))
              return Response.json({ count: 1000, max_model_len: 32768 });
            assert.equal(url, "https://llm.invalid/v1/chat/completions");
            return stream
              ? new Response(
                  `data: ${JSON.stringify({
                    choices: [
                      {
                        index: 0,
                        delta: { content: "一般理论说明" },
                        finish_reason: reason,
                      },
                    ],
                  })}\n\ndata: [DONE]\n\n`,
                )
              : Response.json({
                  choices: [
                    {
                      message: { content: "一般理论说明" },
                      finish_reason: reason,
                    },
                  ],
                });
          },
        );
        const response = await POST(
          new NextRequest("http://localhost/api/csgpt/chat/completions", {
            method: "POST",
            body: JSON.stringify({
              model,
              stream,
              messages: [{ role: "user", content: "什么是复合材料" }],
            }),
          }),
          {
            params: Promise.resolve({
              provider: "csgpt",
              path: ["chat", "completions"],
            }),
          },
        );
        if (stream) {
          const text = await response.text();
          assert.equal(
            text.includes('"finish_reason":"stop"'),
            reason === "stop",
          );
          assert.equal(text.endsWith("data: [DONE]\n\n"), reason === "stop");
          assert.equal(
            text.includes('"code":"invalid_completion"'),
            reason !== "stop",
          );
        } else {
          assert.equal(response.status, reason === "stop" ? 200 : 502);
          assert.equal(
            Boolean((await response.json()).error),
            reason !== "stop",
          );
        }
      });
    }
  }
}

test("长历史追问绑定完整工件，拒绝模型把未求解写成未达标", async (t) => {
  const previous = process.env.CSGPT_CS2_BASE_URL;
  process.env.CSGPT_CS2_BASE_URL = "https://llm.invalid/v1";
  t.after(() => {
    if (previous === undefined) delete process.env.CSGPT_CS2_BASE_URL;
    else process.env.CSGPT_CS2_BASE_URL = previous;
  });
  const artifact = designFixture("concept");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.ok(!url.includes("design/"));
    const factsMessage = body.messages.find((message: any) =>
      message.content.includes('"design_fingerprint"'),
    );
    const facts = JSON.parse(
      factsMessage.content.slice(factsMessage.content.indexOf("{")),
    );
    assert.equal(facts.design_fingerprint, artifact.result.design_fingerprint);
    assert.equal(facts.candidate_count, 50);
    assert.deepEqual(facts.calculated_facts["当前求解状态分组"], {
      not_run: 50,
    });
    if (url.endsWith("tokenize"))
      return Response.json({ count: 8000, max_model_len: 32768 });
    calls++;
    return Response.json({
      choices: [
        {
          message: { content: "当前没有候选达到安全阈值。" },
          finish_reason: "stop",
        },
      ],
    });
  });
  const response = await POST(
    new NextRequest("http://localhost/api/csgpt/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: CSGPT_MODEL_2,
        stream: false,
        messages: [
          designArtifactMessage(artifact),
          ...Array.from({ length: 35 }, () => [
            { role: "user", content: "继续讨论" },
            { role: "assistant", content: "候选层数未知" },
          ]).flat(),
          {
            role: "user",
            content: "从已有候选中推荐最安全的方案，不要生成候选。",
          },
        ],
      }),
    }),
    {
      params: Promise.resolve({
        provider: "csgpt",
        path: ["chat", "completions"],
      }),
    },
  );
  assert.equal(calls, 1);
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /未求解/);
});

test("FEM-ready 自然语言追问按 TMP 编号绑定工件，未知编号在请求模型前返回 422", async (t) => {
  const previous = process.env.CSGPT_CS2_BASE_URL;
  process.env.CSGPT_CS2_BASE_URL = "https://llm.invalid/v1";
  t.after(() => {
    if (previous === undefined) delete process.env.CSGPT_CS2_BASE_URL;
    else process.env.CSGPT_CS2_BASE_URL = previous;
  });
  const artifact = designFixture("fem");
  const answer =
    "TMP_1 包含40层，当前未求解，不能根据历史参考判定当前设计安全。";
  const calls: string[] = [];
  let tokenizedMessages: unknown;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.ok(
      url === "https://llm.invalid/tokenize" ||
        url === "https://llm.invalid/v1/chat/completions",
    );
    const body = JSON.parse(String(init.body));
    const factMessage = body.messages.find((message: any) =>
      message.content.includes('"design_fingerprint"'),
    );
    assert.equal(factMessage.role, "system");
    assert.deepEqual(Object.keys(factMessage).sort(), ["content", "role"]);
    const facts = JSON.parse(
      factMessage.content.slice(factMessage.content.indexOf("{")),
    );
    assert.equal(facts.design_fingerprint, artifact.result.design_fingerprint);
    assert.deepEqual(
      facts.candidates.map((item: any) => item.candidate_id),
      ["TMP_1"],
    );
    assert.equal(facts.candidates[0].layer_count, 40);
    assert.equal(
      facts.candidates[0].screening.current_design_verdict,
      "pending",
    );
    if (url.endsWith("tokenize")) {
      tokenizedMessages = body.messages;
      return Response.json({ count: 8000, max_model_len: 32768 });
    }
    assert.deepEqual(body.messages, tokenizedMessages);
    return Response.json({
      choices: [{ message: { content: answer }, finish_reason: "stop" }],
    });
  });
  const ask = (question: string) =>
    POST(
      new NextRequest("http://localhost/api/csgpt/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: CSGPT_MODEL_2,
          stream: false,
          messages: [
            designArtifactMessage(artifact),
            { role: "user", content: question },
          ],
        }),
      }),
      {
        params: Promise.resolve({
          provider: "csgpt",
          path: ["chat", "completions"],
        }),
      },
    );
  const response = await ask("解释候选1");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.choices[0].message.content, answer);
  assert.equal(body.choices[0].finish_reason, "stop");
  assert.equal(body.csgpt_design_artifact, undefined);
  const completedCalls = calls.length;
  assert.ok(completedCalls > 0);
  const unknown = await ask("解释候选51");
  assert.equal(unknown.status, 422);
  assert.match((await unknown.json()).message, /候选编号/);
  assert.equal(calls.length, completedCalls);
});

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
    {
      params: Promise.resolve({
        provider: "csgpt",
        path: ["chat", "completions"],
      }),
    },
  );
  assert.equal(response.status, 422);
  assert.match((await response.json()).message, /边界.*冲突/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { getServerSideConfig } from "../app/config/server";
import {
  CSGPT_DEFAULT_MODEL,
  CSGPT_MODEL_2,
  CSGPT_MODEL_3,
  DEFAULT_MODELS,
} from "../app/constant";
import {
  applyCSGPTModelSources,
  collectModelsWithDefaultModel,
} from "../app/utils/model";

test("公开模型配置只提供路由与上游标识，展示不改变原始 ID 或可用性", async () => {
  const env = {
    CSGPT_MODEL_NAME: CSGPT_DEFAULT_MODEL,
    CSGPT_CS1_UPSTREAM_MODEL_NAME: "deepseek-v4.1-flash",
    CSGPT_CS2_UPSTREAM_MODEL_NAME: "csllm",
    CSGPT_CS3_UPSTREAM_MODEL_NAME: "qwen3-14b-base",
    CSGPT_CS1_BASE_URL: "https://private-fixture.invalid/v1",
    CSGPT_CS1_API_KEY: "fixture-secret-not-public",
  };
  const before = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    const config = getServerSideConfig();
    const models = collectModelsWithDefaultModel(
      DEFAULT_MODELS,
      config.customModels,
      config.defaultModel,
    );
    const display = applyCSGPTModelSources(models, config.csgptModelSources);
    for (const [id, source] of [
      [CSGPT_DEFAULT_MODEL, "deepseek-v4.1-flash"],
      [CSGPT_MODEL_2, "csllm"],
      [CSGPT_MODEL_3, "qwen3-14b-base"],
    ]) {
      const current = display.find(
        (model) => model.name === id && model.provider?.id === "csgpt",
      )!;
      const original = models.find(
        (model) => model.name === id && model.provider?.id === "csgpt",
      )!;
      assert.equal(current.name, original.name);
      assert.equal(current.available, original.available);
      assert.equal(current.isDefault, original.isDefault);
      assert.ok(current.displayName.includes(source));
      assert.ok(!current.displayName.includes("QWen3-14B"));
    }
    const { GET } = await import("../app/api/config/route");
    const body = await (await GET()).json();
    assert.deepEqual(body.csgptModelSources, config.csgptModelSources);
    assert.ok(!JSON.stringify(body).includes(env.CSGPT_CS1_BASE_URL));
    assert.ok(!JSON.stringify(body).includes(env.CSGPT_CS1_API_KEY));
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("旧展示名与自定义别名不充当基座来源，未配置与其他 Provider 分开处理", () => {
  const models = collectModelsWithDefaultModel(
    DEFAULT_MODELS,
    `${CSGPT_DEFAULT_MODEL}@CSGPT=QWen3-14B-CS1,-${CSGPT_MODEL_2}@CSGPT`,
    "",
  );
  const unknown = applyCSGPTModelSources(models, []);
  assert.equal(
    unknown.find((model) => model.name === CSGPT_DEFAULT_MODEL)?.displayName,
    "CS1（当前上游未确认）",
  );
  const configured = applyCSGPTModelSources(models, [
    { id: CSGPT_DEFAULT_MODEL, displayName: "CS1", upstreamModel: null },
  ]);
  assert.equal(
    configured.find((model) => model.name === CSGPT_DEFAULT_MODEL)?.displayName,
    "CS1（当前上游：未显式配置）",
  );
  assert.equal(
    configured.find((model) => model.name === CSGPT_MODEL_2)?.available,
    false,
  );
  assert.deepEqual(
    configured.filter((model) => model.provider?.id !== "csgpt"),
    models.filter((model) => model.provider?.id !== "csgpt"),
  );
});

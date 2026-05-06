import { ServiceProvider } from "../constant";
import {
  collectModelsWithDefaultModel,
  getModelProvider,
  isModelNotavailableInServer,
} from "./model";

describe("model utilities", () => {
  it("parses provider from the last @ in a model identifier", () => {
    expect(getModelProvider("model@revision@OpenAI")).toEqual([
      "model@revision",
      "OpenAI",
    ]);
  });

  it("matches custom default models by provider display name", () => {
    const models = collectModelsWithDefaultModel(
      [],
      "+my-model@OpenAI=Internal Model",
      "my-model@OpenAI",
    );

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      name: "my-model",
      displayName: "Internal Model",
      isDefault: true,
      provider: { providerName: ServiceProvider.OpenAI },
    });
  });

  it("recognizes models disabled by provider name or provider id", () => {
    expect(
      isModelNotavailableInServer(
        "-gpt-4@OpenAI",
        "gpt-4",
        ServiceProvider.OpenAI,
      ),
    ).toBe(true);
  });
});

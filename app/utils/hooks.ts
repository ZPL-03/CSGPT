import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { applyCSGPTModelSources, collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    return applyCSGPTModelSources(
      collectModelsWithDefaultModel(
        configStore.models,
        [configStore.customModels, accessStore.customModels].join(","),
        accessStore.defaultModel,
      ),
      accessStore.useCustomConfig ? [] : accessStore.csgptModelSources,
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    accessStore.csgptModelSources,
    accessStore.useCustomConfig,
    configStore.customModels,
    configStore.models,
  ]);

  return models;
}

import fixtures from "../fixtures/design-service.json";
import { validateDesignContract } from "../../app/utils/design-contract";

// 固定响应由 CS_LLM 正式设计服务生成，来源脚本哈希保存在同一文件。
export function designFixture(
  name: "concept" | "fem" | "fem_custom" | "concept_partial",
) {
  return validateDesignContract(structuredClone(fixtures[name]));
}

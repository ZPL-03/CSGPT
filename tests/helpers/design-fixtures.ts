import fixtures from "../fixtures/design-service.json";
import { validateDesignContract } from "../../app/utils/design-contract";

// 候选来自正式服务快照，来源脚本哈希保存在同一文件；解释摘要按当前消费契约复算。
export function designFixture(
  name: "concept" | "fem" | "fem_custom" | "concept_partial",
) {
  return validateDesignContract(structuredClone(fixtures[name]));
}

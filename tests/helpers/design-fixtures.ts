import fixtures from "../fixtures/design-service.json";
import { validateDesignContract } from "../../app/utils/design-contract";

export const designNarrativeFixture = {
  tradeoffs: "同几何基线可用于比较，探索组用于扩大筛选范围。",
  layup: "通过中面两侧层序判断对称性，通过正负角配对判断均衡性。",
  manufacturing: "按工艺能力核对铺放角、张力和固化过程。",
  verification: "校核应包含边界约束、几何缺陷与失稳模式。",
};

// 候选来自正式服务快照，来源脚本哈希保存在同一文件；解释摘要按当前消费契约复算。
export function designFixture(
  name: "concept" | "fem" | "fem_custom" | "concept_partial",
) {
  return validateDesignContract(structuredClone(fixtures[name]));
}

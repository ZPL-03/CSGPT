import { validateDesignContract } from "./design-contract";
import type { CSGPTDesignArtifact } from "./structured-design";

/** 对可明确识别的事实冲突报错；不将自由文本检查当作完整科学语义证明。 */
export function designNarrativeValidator(artifact: CSGPTDesignArtifact) {
  const response = validateDesignContract(artifact);
  const sequences =
    response.generation_mode === "concept_layup_enumeration"
      ? response.result.candidates.map((item) => item.layup_deg)
      : response.result.candidates.map((item) => item.layup.angles_deg);
  const actualAngles = new Set(sequences.flat());
  return (text: string) => {
    for (const sentence of text.replace(/[*`]/g, "").split(/[。！？；;\n]/)) {
      // 否定或条件式是在说明证据边界，不是声明候选已经通过或失败。
      if (
        /(?:不能|无法|不应|并非|不代表|不表示|尚不能|如果|若|待.*后)/.test(
          sentence,
        )
      )
        continue;
      if (
        /(?:没有|无一|无任何|全部|所有|均|已|未|不)[^。；]{0,20}(?:达到安全阈值|满足安全要求|通过(?:安全|有限元|FEM)校核|校核通过|校核失败)/i.test(
          sentence,
        )
      ) {
        throw new Error(
          "模型解释与工件冲突：当前候选未求解，不能判为安全通过或未达阈值。",
        );
      }
      if (
        !/用户|输入未|未指定/.test(sentence) &&
        /(?:物理层数|完整层序|完整物理层序)[^。；]{0,60}(?:未知|尚未给定|未确定|未生成|缺失)/.test(
          sentence,
        )
      ) {
        throw new Error("模型解释与工件冲突：候选层数及完整层序已经生成。");
      }
      if (
        /(?:实际(?:采用|使用|包含)|已经?(?:采用|包含)|均有角度参与|候选(?:中)?(?:含有|包含))/.test(
          sentence,
        )
      ) {
        const actualStart = sentence.search(
          /实际(?:采用|使用|包含)|已经?(?:采用|包含)|候选(?:中)?(?:含有|包含)/,
        );
        const actualClause =
          actualStart < 0 ? sentence : sentence.slice(actualStart);
        const claims = [
          ...actualClause.matchAll(
            /(±|\+\s*\/\s*-|[+−-])?\s*(\d+(?:\.\d+)?)\s*(?:°|度|deg\b)/gi,
          ),
        ];
        // 无单位只识别“实际采用-45”这类完整短句，不把层数或厚度当成角度。
        const bareAngle =
          /^(?:实际(?:采用|使用|包含)|已经?(?:采用|包含)|候选(?:中)?(?:含有|包含))\s*(±|\+\s*\/\s*-|[+−-])\s*(\d+(?:\.\d+)?)\s*$/.exec(
            actualClause,
          );
        if (bareAngle) claims.push(bareAngle);
        for (const match of claims) {
          const sign = match[1] || "";
          const magnitude = Number(match[2]);
          // ± 表示正负角均有实际层，不据此推定正负层数相等。
          const angles =
            sign === "±" || sign.includes("/")
              ? [magnitude, -magnitude]
              : [sign === "-" || sign === "−" ? -magnitude : magnitude];
          if (angles.some((angle) => !actualAngles.has(angle)))
            throw new Error(
              "模型解释与工件冲突：声明的实际角度未出现在完整层序中。",
            );
        }
      }
    }
  };
}

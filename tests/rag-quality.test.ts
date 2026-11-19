import assert from "node:assert/strict";
import { test } from "node:test";
import { assessRagQuality } from "../app/utils/rag-quality";

test("公式缺失、损坏定界符和失去列含义的表格不能作为完整证据", () => {
  for (const [text, issue] of [
    ["刚度满足 formula-not-decoded", "missing_formula"],
    ["按 equation_not_parsed 计算。", "missing_formula"],
    ["由 \\[ A = 1 得到", "damaged_formula"],
    ["\\begin{bmatrix} 1 & 2", "damaged_formula"],
    ["公式中的 N _ { _ {xy} }", "damaged_formula"],
    ["该结论的适用条件如下：", "incomplete_context"],
    ["| 1 | 57.471 |\n| 2 | 60.000 |", "missing_table_header"],
    [
      "| 编号 | 临界载荷 |\n| --- | --- |\n| 1 | 57.471 |",
      "missing_table_unit",
    ],
    ["1 57.471 2.01\n2 60.000 3.00", "missing_table_header"],
  ]) {
    const quality = assessRagQuality(text);
    assert.equal(quality.usable, false);
    assert.ok(quality.issues.includes(issue as any));
  }
});

test("有列单位或明确无量纲的表格与带条件的完整理论均可消费", () => {
  for (const text of [
    "| 编号 | 临界载荷/kN/m | BLF（无量纲） |\n| --- | --- | --- |\n| 1 | 57.471 | 0.479 |",
    "层数较多且相对耦合足够小时，可近似忽略D16，但这不是一般层合板的严格零项结论。",
    "只对材料和厚度关于中面对称的层合板，\\[B=0\\]。",
    "\\begin{bmatrix} A & B \\\\ B & D \\end{bmatrix}",
  ])
    assert.equal(assessRagQuality(text).usable, true);
  const long = "条件在末尾。".repeat(1000);
  assert.equal(assessRagQuality(long, 100).usable, false);
  assert.equal(assessRagQuality(long, long.length).usable, true);
});

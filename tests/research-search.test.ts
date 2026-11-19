import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeResearchSearch,
  isCompositeMaterialsResult,
  isPatentDocumentUrl,
  type ResearchSearchResult,
} from "../app/utils/research-search-registry";

const titleOnlyResult = (title: string): ResearchSearchResult => ({
  title,
  url: "https://example.org/title-only",
  provider: "semantic-scholar",
  mode: "academic",
});

test("无摘要英文题名通过复合或层合结构语境判定", () => {
  for (const title of [
    "Buckling of composite pressure hulls",
    "Buckling of laminated cylindrical shells",
    "Free vibration of laminated plates and beams",
    "Failure of stiffened composite panels under compression",
    "Filament wound composite pressure vessels",
  ])
    assert.ok(isCompositeMaterialsResult(titleOnlyResult(title)), title);
});

test("中文材料及层合结构题名保留语义，混合中英文缩写可匹配", () => {
  for (const title of [
    "复合材料耐压壳屈曲分析",
    "层合圆柱壳的稳定性研究",
    "层合球壳的稳定性研究",
    "碳纤维增强树脂基复合材料拉伸性能",
    "复合加筋壁板承载研究",
    "层压梁的弯曲与振动",
    "ＣＦＲＰ圆筒的损伤演化",
  ])
    assert.ok(isCompositeMaterialsResult(titleOnlyResult(title)), title);
});

test("专利模式约束文献来源并排除产业博客和检索首页", async (t) => {
  const key = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "fixture-research-key";
  t.after(() => {
    if (key === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = key;
  });
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string);
      assert.deepEqual(body.include_domains, [
        "patents.google.com",
        "patentscope.wipo.int",
        "worldwide.espacenet.com",
      ]);
      assert.equal(body.max_results, 3);
      return Response.json({
        results: [
          {
            title: "Pressure vessel patent landscape",
            url: "https://example.org/blog/patents",
          },
          { title: "Patent search", url: "https://patents.google.com/" },
          {
            title: "Filament wound vessel",
            url: "https://patents.google.com/patent/US1234567A/en",
          },
        ],
      });
    },
  );
  const response = await executeResearchSearch({
    query: "filament winding patent",
    mode: "patent",
    maxResults: 1,
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    response.results.map((entry) => entry.url),
    ["https://patents.google.com/patent/US1234567A/en"],
  );
  assert.ok(
    isPatentDocumentUrl(
      "https://patentscope.wipo.int/search/en/detail.jsf?docId=WO2026000001",
    ),
  );
  assert.ok(
    isPatentDocumentUrl(
      "https://worldwide.espacenet.com/patent/search/family/123/publication/EP1234567A1",
    ),
  );
  assert.ok(
    !isPatentDocumentUrl(
      "https://patents.google.com.example.org/patent/US1234567A/en",
    ),
  );
  assert.ok(!isPatentDocumentUrl("javascript:alert(1)"));
});

test("复合材料相关性要求材料体系，孤立的 fiber 或 carbon 不构成依据", () => {
  const result = (title: string, snippet?: string): ResearchSearchResult => ({
    title,
    snippet,
    url: "https://example.org/paper",
    provider: "springer-openaccess",
    mode: "academic",
    venue: "Composite Materials Research",
  });
  for (const entry of [
    result("Carbon fiber reinforced polymer composites"),
    result("Hybrid fiber-reinforced high-strength concrete"),
    result("Cellulose reinforcement in fiber-cement composites"),
    result("CFRP laminate damage evolution"),
    result(
      "Interlaminar fracture",
      "The composite epoxy matrix contains continuous carbon fibres.",
    ),
  ])
    assert.ok(isCompositeMaterialsResult(entry), entry.title);
  for (const entry of [
    result("Small Fiber Neuropathy", "Sensory nerves and patient burden."),
    result("Dietary fiber and patient outcomes"),
    result("Carbon footprint of tourism"),
    result("Composite clinical endpoints in a patient cohort"),
    result("Composite endpoints in blood vessel disease"),
    result("Composite endpoints assess structural nerve damage"),
    result("小纤维神经病的症状评估"),
    result("临床试验中的复合终点与疗效评价"),
    result("临床试验中的复合终点与血小板功能"),
    result("碳排放与旅游业发展"),
    result(
      "Clinical outcomes",
      "A study published in the journal named above.",
    ),
  ])
    assert.ok(!isCompositeMaterialsResult(entry), entry.title);
});

test("学术接口过滤同名非材料记录，保留可追溯材料论文", async (t) => {
  const base = process.env.SEMANTIC_SCHOLAR_BASE_URL;
  process.env.SEMANTIC_SCHOLAR_BASE_URL = "https://example.org/graph/v1";
  t.after(() => {
    if (base === undefined) delete process.env.SEMANTIC_SCHOLAR_BASE_URL;
    else process.env.SEMANTIC_SCHOLAR_BASE_URL = base;
  });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: [
        {
          title: "Small Fiber Neuropathy",
          abstract: "Recent review of fiber nerve symptoms",
          url: "https://example.org/medical",
          year: 2026,
        },
        {
          title: "Natural Fiber Reinforced Polymer Composites",
          abstract: "Recent advances in composite materials",
          url: "https://example.org/material",
          year: 2026,
          externalIds: { DOI: "10.1234/material" },
        },
      ],
    }),
  );
  const response = await executeResearchSearch({
    query: "最新的复合材料研究进展有哪些？",
    mode: "academic",
    provider: "semantic-scholar",
    maxResults: 3,
  });
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].doi, "10.1234/material");
});

test("实际学术筛选保留无摘要中英文结构题名，中文主题参与相关性评分", async (t) => {
  const base = process.env.SEMANTIC_SCHOLAR_BASE_URL;
  process.env.SEMANTIC_SCHOLAR_BASE_URL = "https://example.org/graph/v1";
  t.after(() => {
    if (base === undefined) delete process.env.SEMANTIC_SCHOLAR_BASE_URL;
    else process.env.SEMANTIC_SCHOLAR_BASE_URL = base;
  });
  const titles = [
    "Buckling of composite pressure hulls",
    "Buckling of laminated cylindrical shells",
    "复合材料耐压壳屈曲分析",
    "层合圆柱壳的屈曲研究",
    "Composite clinical endpoints in a patient cohort",
    "小纤维神经病的临床研究",
  ];
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: titles.map((title, index) => ({
        title,
        url: `https://example.org/paper/${index}`,
      })),
    }),
  );
  for (const [query, expected] of [
    ["复合材料耐压壳屈曲", [titles[0], titles[2]]],
    ["层合圆柱壳屈曲", [titles[1], titles[3]]],
  ] as const) {
    const result = await executeResearchSearch({
      query,
      mode: "academic",
      provider: "semantic-scholar",
      maxResults: 10,
    });
    const found = result.results.map((entry) => entry.title);
    for (const title of expected)
      assert.ok(found.includes(title), `${query}: ${title}`);
    assert.ok(!found.includes(titles[4]));
    assert.ok(!found.includes(titles[5]));
  }
});

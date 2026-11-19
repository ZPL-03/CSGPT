# 工程验收与部署

## 职责与验证

CSGPT 是网页版专家问答应用。确定性服务负责候选枚举、完整层序和 ABD 数值，模型解释输入事实。协议完成、工具计算、解释正确性和实际结构安全分别验收。

| 命令                                                              | 验证内容                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm test`                                                        | 固定候选快照、模拟 HTTP、实际 Route Handler、工件绑定、完成终态、文件解析、MCP 权限和错误传播 |
| `npm run test:parsers`                                            | 独立无登录态浏览器中的 XLS/XLSX 解析、PDF worker 文本与页面像素；资源由本地安装包提供         |
| `npm run test:ui:compat`                                          | 本地生产构建的导航、会话、面具分享、公式矩阵、Mermaid、导出与上传；使用内存接口样本           |
| `npm run eval:csgpt`                                              | 当前本地 RAG/KG 运行包；在线检索由 `CSGPT_EVAL_ONLINE=1` 启用                                 |
| `npm run test:csllm`                                              | 只读真实运行包的聊天与 KG Route Handler、引用追溯、网络与数据库隔离、文件指纹一致性           |
| `GET /api/health`                                                 | 只读生产运行包 manifest、文件字节和 Vercel 构建身份；不访问数据库或模型                             |
| `npm run lint` / `npm run build`                                  | ESLint 9 flat config 检查和生产构建；构建配置独立于 lint                                      |
| `npx next typegen`，再执行 `npx tsc --noEmit --incremental false` | TypeScript 与 Next.js 路由类型；不要求保留生产构建产物                                        |
| `npm audit --omit=dev`                                            | 生产依赖公告；非零退出码表示仍有公告项                                                        |
| `npm audit`                                                       | 全部依赖公告；核对原始结果与公告当前状态，来源差异见依赖核查                                  |
| `npm run test:e2e`                                                | 已授权账号的真实页面、认证、数据库、应用路由和模型响应；服务须已运行                          |

## 本地浏览器兼容测试

`playwright.ui.config.ts` 启动回环地址上的 Next standalone 构建，默认端口 3317，不复用已有服务。`tests/ui/start-server.mjs` 配套复制 `public` 和 `.next/static`；认证、会话及文件接口由每个测试的内存样本响应，数据库连接指向不可用回环端口，MCP 关闭。浏览器上下文不加载已有 profile 或登录态。

```powershell
npm ci
npm run build
$env:CSGPT_UI_BROWSER_CHANNEL = 'msedge'
npm run test:ui:compat
$env:CSGPT_PARSER_BROWSER_CHANNEL = 'msedge'
npm run test:parsers
```

也可使用已安装的 Playwright Chromium，不设置 browser channel。端口冲突时设置 `CSGPT_UI_PORT`。套件覆盖桌面 1440×1000 和移动端 390×844，截图及导出 PNG 位于 `output/playwright/ui`；页面异常和未声明 API 请求使测试失败，重试为 0。外网请求被阻断，PDF 资源使用本地安装包，头像 CDN 使用仓库图片样本；文本 PDF 与 XLS/XLSX 解析不依赖 OCR 下载。

内存接口用于验证真实页面与依赖兼容，真实身份、数据库和模型服务使用下方登录态验收。内置面具分享与聊天 Markdown、JSON、PNG 导出有行为检查；桌面图片复制使用测试剪贴板捕获实际 PNG 字节，移动端检查图片弹窗。页面仅提供这些本地导出和面具链接功能，不提供 ShareGPT 发布动作。

## 登录态长对话

支持已授权账号，也可使用专用测试账号和隔离数据库。测试先确认 `/api/auth/me` 返回的用户 ID，再读取已有会话清单。原有会话只读，写入仅限页面新建且登记的测试会话。测试凭据保留在仓库外。

文件解析测试独立于登录态测试。`npm run test:parsers` 默认使用 Playwright Chromium；已安装 Edge 时，可设置 `CSGPT_PARSER_BROWSER_CHANNEL=msedge`，测试使用临时无登录态上下文，不读取已有 profile。

已有仓库外 `storageState` 文件可直接复用。需要保存登录态时，在独立浏览器中登录已授权账号：

```powershell
npx playwright install chromium
npx playwright codegen --save-storage="$env:TEMP\csgpt-test-auth.json" http://127.0.0.1:3000
```

从该登录会话的 `/api/auth/me` 响应确认 `user.id`，关闭登录浏览器后配置：

```powershell
$env:CSGPT_E2E_BASE_URL = 'http://127.0.0.1:3000'
$env:CSGPT_E2E_AUTH_STATE = "$env:TEMP\csgpt-test-auth.json"
$env:CSGPT_E2E_EXPECTED_USER_ID = '<已确认的用户ID>'
$env:CSGPT_E2E_AUTHORIZED = '1'
npm run test:e2e -- --project=desktop
npm run test:e2e -- --project=mobile
```

`CSGPT_E2E_AUTHORIZED=1` 表示该账号已获真实实测授权。未启用时跳过；启用后配置缺失、身份不符或登录过期均失败。每次运行创建三个 `CSGPT验收 <运行ID> <用途>` 会话，分别用于 RAG 关闭、RAG 开启、候选与 ABD。浏览器写请求白名单同时约束自动保存；越界请求被阻断并记为失败。

会话默认保留供复核。设置 `CSGPT_E2E_CLEANUP=1` 时，测试成功后重新确认身份，按记录的会话 ID 与完整名称核对目标，再逐条调用 `DELETE /api/conversations/{id}`。证据记录已删除 ID；失败时保留尚存测试会话。后续手动清理也只处理证据中列出的新建 ID，不使用全量删除或按名称批量匹配。

## 用例与证据

`evals/csgpt/conversation-cases.json` 定义同题 RAG 开关对照、5000 m/50 候选、12 次追问、页面重载和 ABD 解释。自动检查涵盖 SSE `stop` 终态、设计合同、候选数、工件指纹、追问工件、数据库保存与页面恢复。

CSGPT 请求默认 `chat_template_kwargs.enable_thinking=false`；显式启用 thinking 时，推理与正文共用输出预算。CS2 的 `/tokenize` 和生成请求携带相同模板参数，输出额度按实测输入长度分配。`finish_reason=length` 明确失败，不能计为完整回答。

`output/playwright/` 保存运行 ID、新建会话 ID、清理结果、测试问答、来源/工具响应头和最后回答截图。认证头、浏览器存储及原有会话内容不进入证据；trace、HAR 和视频关闭。失败响应原样保留，自动重试次数为 0。

报告中的 `semantic_review=required` 表示仍需逐条复核原始回答：

1. 对照 RAG 引用、单位、公式、近似条件和层合板类型；引用数量与 HTTP 200 只证明相应协议事实。
2. 用户固定项、工具选择项与已计算事实分别陈述。用户未指定层数时，工具已生成的层数和完整层序仍是已知事实；角度比例按实际层序计算。
3. `not_run/pending` 表示待求解、待判定。安全阈值结论需要对应求解结果；历史参考绑定对应源行。
4. 对称条件约束整个 B；均衡的 A16/A26 相消需要材料和层厚配对，D16/D26 仍依赖厚度坐标权重。N、mm 单位制下 A/B/D 分别为 N/mm、N、N\*mm。
5. 单层 ABD 测例：A16=30、A26=6、B16=B26=0、D16=0.225、D26=0.045；解释保留截面 A 身份、单位与计算范围。

文本质量检查识别可观测解析缺陷，叙述冲突检查覆盖指定事实冲突；完整科学语义和跨块适用条件由源库核查及人工复核确认。

## 消费契约

CS_LLM 的 `schema_version=1` 摘要包含 `完整层序已生成的候选数量`、`实际使用角度/deg`、`实际角度层数合计` 和 `当前求解状态分组`。角度合计是 `{angle_deg, layer_count}` 列表。消费端按完整候选复算，缺失或不一致则拒绝。固定候选快照用于离线测试；在线服务身份单独验收。

“候选1”“方案编号1”“第1组”和 `TMP_1` 按当前工件的 `generation_mode` 归一为概念候选 `1` 或 FEM-ready 候选 `TMP_1`，重复别名只选取一次。未知编号在调用模型或层序服务前报错。角度事实保留正负号；`±45°` 要求完整层序同时包含 `+45°` 与 `-45°`，不据此推定层数均衡。

ABD 合同校验数学字段、单位、模式、指纹格式、截面身份与贡献算术；说明文字校验字段形状。发布身份通过受控服务入口确认，指纹格式本身不证明来源。

## 知识证据契约

`app/utils/rag-evidence.ts` 定义 RAG、KG、模型上下文和页面证据共用的数据结构。消费端只接受 `content_quality_version="3"`、`retrieval_eligible=true` 且质量问题列表为空的分块。每个 `table_evidence` 必须提供字符串数组 `structure_issues`，可检索表格要求该数组为空；缺失、格式错误或包含表头错位、列宽冲突等问题时拒绝整块证据。v2 数据与缺少身份、使用范围或条件字段的记录不进入检索。

| 字段                                         | 消费规则                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `record_id`、`chunk_id`、`chunk_fingerprint` | 保留来源与当前分块身份。分块指纹采用上游 40 位 SHA1 格式；运行包完整性另用 manifest 与 SHA256 校验 |
| `evidence_kind`、`evidence_usage`            | 随证据进入上下文；`source_conditions_only` 限于原文条件，近似结论仍保留近似范围                    |
| `applicability_context`                      | 原文逐段保留，包含换行和公式，不改写为省略条件的摘要                                               |
| `table_evidence`                             | 完整保留 `structure_issues`、列名、单位判定、无量纲列、标识列、条件列及条件原文；表头须与正文对应  |
| `column_projection`                          | 保留父分块身份、选中原始列索引和排除列及原因。KG 引用当前投影分块，不以不可检索的父表替代          |

`server-rag-kg.ts` 对每次请求建立当前可用分块索引。KG 的分块 ID、指纹、来源记录、证据类型、使用范围和适用条件必须与索引一致，关系检索、概览和展示采用相同约束。入选分块再次读取时核对完整证据摘要，运行期间内容变化明确失败。分块指纹核对证明当前包内绑定一致，不等同于来源真实性认证。

模型引用按分块分配 `[S编号]`，KG 的 `[K编号]` 指向同一完整证据。正文、公式、条件、列投影、身份和引用头共同参与预算；12000 字符预算不足时整包排除，不截断证据。外层共享 token 窗口保留知识上下文的原子性，无法容纳时按错误返回。通用质量检查识别缺失公式、损坏定界符、表头或单位不完整等可观测缺陷，质量通过不证明科学结论正确。

图谱详情展示绑定分块的原文、条件和列投影；桌面关系面板独立滚动，小屏页面整体滚动以容纳完整证据。聊天来源保留紧凑身份信息；旧会话没有分块身份时明确显示缺失，不为历史记录补造当前依据。

### 运行包实测

质量版本 3 的运行包生成时间为 `2026-11-19T02:20:22.345703+00:00`。2026-11-19 在 Node.js 24.14.1 / Windows x64 执行的本地验收保存数据与实现 SHA256、完整上下文、引用、图谱边和资源采样：18 项通过，0 项失败，5 项在线检查跳过，评估前后文件指纹一致。一次性评估 JSON 不纳入发布提交；本地证据中的进程级网络拦截记录为 0 次出站尝试，未调用模型、教师或外部检索 API，数据库检查仅读取迁移 SQL 文件。相同运行包的函数级基线不作为当前 KG 排序的验收结果。

| 检查           | 结果                                                        |
| -------------- | ----------------------------------------------------------- |
| 运行包         | 157480 文本块、234030 关系、2218 实体；`verify:csllm` 通过  |
| 耐压壳检索     | 9 个引用、11329 字符；条件原文完整保留                      |
| 层合板耦合检索 | 5 个引用、5743 字符；保留近似范围与弯扭耦合适用条件         |
| 表格投影检索   | 5 个引用、6614 字符；命中当前投影分块及其原始列映射         |
| 数字和单位问题 | 无证据，不注入无关资料                                      |
| 压力容器图谱   | 40 节点、46 条证据绑定关系；候选预算优先覆盖不同三元组       |
| KG 概览路由    | 32 节点、46 条边；157729 条可用关系参与概览候选排序           |
| 路由与回归测试 | `test:csllm` 8/8、`npm test` 196/196；TypeScript、lint 和 production build 通过 |

| 文件                                  | SHA256                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| `provenance/manifest.json`            | `14c849981032bba51f4b9e4b241dacde8dc44f7231dd34d637051aefc44becdd` |
| `runtime/rag_chunks.compact.jsonl.gz` | `e48896afc6e0c4828878a583401ae51fb8c68c6ab0b51769f17ef605c8b39800` |
| `runtime/relations.compact.jsonl.gz`  | `47781ab6c1f6496834f520a174c40961408c2ccfc59a08f3b4659ce4a07a1bf1` |

报告同时保存实体、统计、来源清单、lockfile 和检索实现的完整哈希。复用命令：

```powershell
$env:CSGPT_EVAL_ONLINE = '0'
$env:CSGPT_EVAL_DESIGN_ONLINE = '0'
$env:CSGPT_CSLLM_RUNTIME_SOURCE = ''
npm run verify:csllm
$report = "evals/csgpt/results/runtime-$(Get-Date -Format yyyyMMdd-HHmmss).json"
npm run eval:csgpt -- --report $report
npm run test:csllm
npm test
```

报告路径限定在 `evals/csgpt/results`，已有文件不覆盖。当前报告和原始失败证据保留；被完整覆盖的成功阶段报告进入回收站。`output/playwright` 和 `.next` 是可重新生成的测试及构建输出。资料科学审查与线上模型问答分别验收。

对应源码为 `app/utils/{server-rag-kg,rag-evidence,rag-quality,rag-kg-sources}.ts`、`app/components/{rag-evidence-view,knowledge-graph,chat}.tsx` 和 `knowledge-graph.module.scss`；行为测试为 `tests/rag-evidence.test.ts`、`tests/rag-quality.test.ts`、`tests/runtime/csllm-runtime.test.ts`、`tests/ui/compatibility.spec.ts`，合成样本位于 `tests/helpers/rag-fixtures.ts`。运行包由同步流程管理，消费端验证只读 `data/csllm`。

KG 查询与概览先按既有分数排序，再为每个不同三元组选取一份证据进入候选预算；预算剩余位置保留重复三元组的其他证据。边 ID、分块指纹、使用范围和条件绑定不变，不把重复证据合并为无条件结论。回归用例包含 180 份同一三元组证据和 6 个其他目标，同时检查查询、概览的目标覆盖、关系总数与独立证据身份。

`test:csllm` 直接调用正式 Route Handler，不启动服务或登录真实账号。聊天模型响应和 KG 认证查询使用内存替身，实际检索、上下文预算、来源响应头、SSE 完成事件、查询子图和概览均使用正式代码；网络与 Prisma 查询被拦截。测试将引用逐项与 gzip 内的分块身份、条件和列投影比对，70 个不同分块通过，并复核整个包的前后 SHA256。该测试不验证生产 HTTP、真实认证或模型回答质量。

评估跳过项为显式铺层序列在线复核、真实确定性设计服务、标准真实检索、专利真实检索和中文学术检索。在线检查需要独立授权；离线通过不覆盖这些能力。

### 资源实测

评测在原有查询执行期间每 50 ms 采样 RSS，同时保存操作系统提供的进程 RSS 高水位，不增加检索次数。下表是同一进程中的串行结果，RSS 包含已有模块、缓存和未回收对象，不是单请求增量内存。

| 用例           | 耗时/s | 采样峰值 RSS/MiB |
| -------------- | -----: | ---------------: |
| 耐压壳 RAG     |  33.62 |           312.77 |
| 层合板耦合 RAG |  24.92 |           322.67 |
| 表格投影 RAG   |  14.93 |           330.50 |
| 数字和单位问题 |   1.79 |           330.52 |
| 压力容器 KG    |  18.34 |           387.39 |

整个评测耗时 93.95 s，进程 RSS 高水位 447.35 MiB，包含报告文件指纹读取。这是本地进程采样，不是隔离性能基准，不用于推断部署环境的并发能力或响应时延。

仓库部署说明记录的目标为 Node.js 24、Hobby、Fluid compute，`vercel.json` 未单独设置 `maxDuration`。托管套餐与资源配额未通过远程 API 复核。[Vercel 官方限制](https://vercel.com/docs/functions/limitations)的既有 2026-11-19 记录为 Hobby Fluid 的 2 GB / 1 vCPU、300 s 默认及最大时长，标准函数解包体积上限为 250 MB。质量版本 2 的 Windows 构建记录中，聊天路由与图谱路由 `.nft.json` 依赖文件合计分别为 132492773 B、132478845 B；这些体积不代表当前 v3 包的构建产物。

当前 v3 包的 production standalone build 已通过，`.next/standalone/server.js` 包含全部七项运行包文件；本地 standalone HTTP 的 `/api/health` 返回 200，manifest 和文件字节全部匹配。Vercel 冷启动、并发驻留、网络和模型等待仍须目标环境实测；线上版本以 `/api/health` 的 manifest、记录数和构建提交身份为准，不根据本地检索通过推定线上数据一致。

## 真实外部检索

2026-11-19 使用现有 Next.js 环境配置执行六次 HTTP 请求，全部返回 200：Tavily 标准一次、专利两次，AI4Scholar、Elsevier Scopus、Springer Open Access 各一次。专利第二次请求使用明确的文献来源约束；其余已通过的 API 调用未重复执行。五次初始请求及脱敏响应正文保存在 [原始证据](../evals/csgpt/results/online-research-raw-2026-11-19.json)，专利定向请求保存在 [专利证据](../evals/csgpt/results/online-research-patent-2026-11-19.json)。当前报告的 `acceptance` 和 `results` 汇总有效结论，`response_capture.result_review` 与 `replay_*` 保留初始来源问题及回放失败。

| 用例     | 真实结果与验证                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标准     | 2.69 s，返回 GSO ISO 11119-1:2014 标准目录记录，标题、链接和模式通过                                                                                                          |
| 专利     | 初始 2.23 s 返回产业博客，来源类别失败；带专利来源约束的定向请求 3.42 s，通过并返回 Google Patents 的 EP2583020A2，摘要包含纤维缠绕复合材料压力容器                           |
| 中文学术 | AI4Scholar 2.91 s、Scopus 1.03 s、Springer 4.76 s。9 条结果含 1 条神经病论文；材料相关性按题名及摘要中的材料体系判定，原响应回放保留 8 条结果（7 个唯一 DOI），医学论文被排除 |

复合或层合表述与材料体系或工程结构语境共同决定学术相关性；无摘要的压力壳、圆柱壳、板、梁等题名可凭结构语境通过。归一化保留中文并统一全角字符，中文主题词参与相关性评分。单独的 `fiber`、`carbon` 或期刊名不构成材料依据，医学复合终点与纤维神经病仍被排除。专利模式使用 Tavily 的 `include_domains` 限定 Google Patents、WIPO 和 Espacenet，结果必须定位到具体文献，博客与检索首页不进入专利上下文。相关请求字段见 [Tavily API](https://docs.tavily.com/documentation/api-reference/endpoint/search)。

当前报告嵌入三类外部检索证据：`#/original_research_capture/report` 保存初始 API 请求与响应，`#/academic_context_replay/report` 保存当前代码的无网络学术回放，`#/patent_response_evidence/report` 保存专利定向请求。每项均有嵌入内容哈希，结果条目直接引用对应 JSON Pointer。原始响应文件保留供逐字核对，已被完整嵌入的成功回放文件进入回收站；历史失败保存在 `response_capture.result_review` 和 `replay_failures`。学术回放使用三个原响应，保留 8 条结果、7 个唯一 DOI，网络请求为 0。

`--online-research-only` 执行外部检索用例，`--research-mode` 可限定 `standard`、`patent` 或 `academic`，不执行其他模式。`--reuse-report` 逐项核对已有成功报告的应用与数据指纹并嵌入完整证据；评测入口独立记录版本。`--replay-research` 从原始响应执行同一解析和筛选代码，禁止网络请求，请求参数变化或缺少对应响应时明确失败。当前外部检索结论为标准与专利真实请求通过、学术真实响应回放通过；v2 包的 18 项本地结果保留原指纹，在线 ABD 与候选服务 2 项仍未执行。

无网络回放命令：

```powershell
$env:CSGPT_EVAL_ONLINE = '1'
$env:CSGPT_EVAL_DESIGN_ONLINE = '0'
$report = "evals/csgpt/results/research-replay-$(Get-Date -Format yyyyMMdd-HHmmss).json"
npm run eval:csgpt -- --online-research-only --research-mode academic --replay-research evals/csgpt/results/online-research-raw-2026-11-19.json --report $report
```

标准回放选 `standard` 并使用同一原始证据；专利回放选 `patent` 并使用 `online-research-patent-2026-11-19.json`。完整执行命令、时间、配置开关和实现指纹保存在对应证据中。真实执行使用同一入口、不传 `--replay-research`，须按检索调用授权运行。Provider 失败及原始响应进入报告，同一次运行不再次请求失败 Provider。三个外部检索用例均不调用 CS1/CS2/CS3 或设计服务。正式测试为 `tests/research-search.test.ts`、`tests/evaluation-research.test.ts`，报告记录与指纹校验位于 `scripts/evaluation-research.ts`。

## 模型身份展示

`QWen3-14B-CS1`、`QWen3-14B-CS2`、`QWen3-14B-CS3` 是请求与会话持久化的路由 ID，不是基座身份。现有 `/api/config` 的 `csgptModelSources` 仅提供路由 ID、CS1/CS2/CS3 标签与 `CSGPT_CS*_UPSTREAM_MODEL_NAME`，不提供地址或密钥；`useAllModels` 统一供模型选择、设置、消息标签和 PNG 导出使用。来源未确认时明确显示未知，自定义接口模式不使用内置服务的来源声明。

当上游配置分别为 `deepseek-v4.1-flash`、`csllm`、`qwen3-14b-base` 时，页面显示对应当前上游标识，CSGPT 头像使用品牌图。PNG 导出将当前配置和路由 ID 分列；当前上游配置不证明历史回答的生成模型。配置和展示变化不迁移会话、不改变请求映射或数据库 schema。行为测试核对选择器、设置、保存、重载及导出，写入的模型 ID 保持不变。

相关文件为 `app/constant.ts`、`app/config/server.ts`、`app/api/config/route.ts`、`app/store/access.ts`、`app/utils/{model,hooks}.ts`、`app/components/{chat,emoji,exporter,settings}.tsx`、导出样式与 `app/locales/{cn,en}.ts`；测试入口为 `tests/model-display.test.ts` 和浏览器兼容套件。

## 配置与部署

仓库配置快照（2026-11-19）：`.vercel/project.json` 关联项目 `csgpt`，`vercel.json` 使用 Next.js 框架、`npm run build` 和 `.next` 输出；项目说明采用 GitHub、Vercel 和 Cloudflare DNS。仓库没有提供 Web 服务固定物理机器或 SSH 发布入口，也没有配置 `CSGPT_CSLLM_RUNTIME_SOURCE` 的默认源目录。验证机器是本地 Windows x64 / Node.js 24.14.1，不是已验证的生产主机。

现有本地配置的 CS1 指向 `api.deepseek.com`，CS2/CS3 指向 `csllm.ipen03.com`。这些域名只能证明客户端配置目标，不能证明远端模型部署身份、物理机器或服务在线状态；生产环境变量由托管平台独立管理，未读取远程凭据或调用其 API。

知识包消费同步入口为 `npm run sync:csllm -- --source "<runtime-package-dir>"`，目标为 `data/csllm`；也可通过 `CSGPT_CSLLM_RUNTIME_SOURCE` 指定源目录。Web 发布需要携带代码和运行包，核对 manifest 与构建产物。服务进程缓存 KG 实体和统计，运行包切换后应通过已授权发布流程重启或替换进程。工作站模型服务及上游资料构建的同步不属于此仓库的消费同步命令。

1. 确认模型、tokenizer 和统一设计服务可用，记录发布身份、输入精度元数据和实际请求结果。
2. 在服务端配置数据库、认证、`CSGPT_CS*_BASE_URL`、`CSGPT_CS*_API_KEY`、CS2 设计服务地址及对应上下文窗口。密钥由部署平台管理。
3. 使用 Node.js 24 LTS（也支持 22.13+ 的 22 LTS）及与清单一致的 RAG/KG 运行包，记录 manifest 指纹；运行 `npm ci`、`npm run verify:csllm`、`npm run eval:csgpt`、`npm test`、`npx next typegen`、`npx tsc --noEmit --incremental false`、`npm run lint`、`npm run build`、`npm audit --omit=dev`。数据库迁移按已授权的迁移方案执行 `npm run db:migrate`。
4. 自托管使用 `node .next/standalone/server.js`，配置 `HOSTNAME`、`PORT`，将 `public` 和 `.next/static` 分别配套到 `.next/standalone/public`、`.next/standalone/.next/static`，并提供运行知识库。`output: standalone` 不使用 `next start`。Vercel 使用 Next.js 框架预设、Node.js 24、`npm ci` 和 `npm run build`。应用依赖服务端路由、认证和数据库。
5. 对目标环境运行授权登录态测试并复核问答，分别保存部署验收、模型解释结论和运行包指纹。

## 运行兼容性

- Next.js、`@next/third-parties`、`eslint-config-next` 同为 15.5.28，React 保持 18。动态路由在服务端等待 `params`；URL、请求体、响应格式、JWT cookie 和 Bearer 认证协议保持一致，文件与会话继续按用户 ID 过滤。
- React Router 7.18.5 保留 HashRouter 声明式路由；KaTeX 0.18.10、Mermaid 12.3.0 与配套 Markdown 插件共用同版本数学渲染和 CSS。两个 KaTeX scoped override 的调用依据与兼容测试见依赖核查。
- 工具链使用 ESLint CLI、Webpack 5.112.2、tsx 4.23.15 与 esbuild 0.28.2。`tests/tooling-compatibility.test.ts` 检查 TSX 规则、实际 Next Webpack 配置下的动态分块和生产压缩；`npm test` 包含该入口。安装遵循 npm lockfile，无跨版本 peer 绕过。
- MCP Server Actions 使用当前请求中的 JWT 和 `ADMIN_USERNAMES` 验证管理员身份，并要求 `ENABLE_MCP=true`；配置读取、写入、进程管理和工具调用均受约束。Next.js 的 Server Action ID 属于构建产物，发布后旧页面可能需要刷新。部署保留已有 `JWT_SECRET`，不以迁移依赖为由轮换令牌密钥。
- PDF.js 6.5.438 使用相同版本的 jsDelivr worker、renderer、CMap、字体、WASM 和 ICC 资源；部署网络和 CSP 需允许这些资源及模块 worker。Node 端使用其 legacy 入口，旧 `canvas` / `node-pre-gyp` / `tar` 安装链不参与该依赖。
- SheetJS 0.20.3 从 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` 安装，完整性由 lockfile 的 SHA-512 固定。安装需要官方 CDN 可达。解析测试使用内存文件覆盖 XLS、XLSX、公式缓存值、PDF 与 DOCX，不访问用户附件。

依赖版本、公告范围和验证证据见 [依赖核查](dependency-audit.md)。

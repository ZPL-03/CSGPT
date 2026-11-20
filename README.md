<div align="center">

<img src="public/favicon.png" width="160" alt="CSGPT Logo"/>

# CSGPT

**复合材料结构设计助手**

面向复合材料结构概念设计、层合设计、材料体系选型、制造工艺约束、失效与稳定性分析、标准合规和工程验证的专业对话平台。

[![GitHub](https://img.shields.io/badge/GitHub-ZPL--03/CSGPT-blue?logo=github)](https://github.com/ZPL-03/CSGPT)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

## 项目简介

CSGPT 基于 NextChat 改造，提供 CSGPT 系列复合材料领域模型、通用 Provider 接入、文件解析、内部知识库、外部检索、知识图谱可视化、用户认证、会话持久化、附件管理和管理后台。平台围绕复合材料结构对象、设计任务、材料与工艺、失效机理、标准规范和验证流程组织专业问答。

聊天链路采用用户显式开关控制的增强模式。服务端按当前会话配置执行内部知识库、会话文件知识、用户文件知识、联网搜索和文献搜索；工具是否进入模型请求由用户开关决定。

## 核心功能

- **复合材料结构工程问答**：覆盖层合板、梁、加筋壁板与壳体、夹层结构、连接件、圆柱壳与封头、纤维缠绕壳体、外压耐压壳、内压复合材料压力容器、COPV、储氢容器和航空航天复合材料构件等典型对象；围绕载荷工况、几何参数、材料体系、铺层/缠绕方案、制造约束、失效与稳定性、标准条款和验证路径组织回答。
- **预设工程面具**：内置耐压壳设计、铺层设计、材料选型、有限元指导、标准合规、失效分析等任务视角。耐压壳设计面具聚焦外压工况、几何尺寸、材料体系、铺层/缠绕角、屈曲与塌陷校核、缺陷敏感性、制造质量和试验验证；铺层、材料、有限元、标准和失效面具按工程任务组织输入、约束、证据和验证路径。
- **内部知识库**：默认开启，读取项目内 `data/csllm` 的领域知识库和知识图谱，把可追溯上下文注入模型请求。当前 KG 覆盖材料、结构、失效模式、制造工艺、标准、性能、应用、任务类别、文献、载荷、设计公式、刚度系数、设计变量和验证方法等实体类型。
- **知识图谱可视化**：展示全局领域 KG 的概览或关键词查询子图，可从侧边栏或聊天输入工具栏进入。
- **文件解析与文件知识**：选择附件时在浏览器内解析，当前消息附件直接进入模型请求；会话文件知识用于后续追问当前会话前序附件；用户文件知识用于检索当前登录用户已解析附件正文形成的重叠文本块。
- **外部检索**：聊天输入区提供“联网搜索”和“文献搜索”快捷开关，按当前问题注入网页、标准规范、专利或学术检索上下文。
- **会话与后台管理**：用户、会话、消息、附件、来源和工具执行记录持久化到 PostgreSQL，管理后台用于查看和删除当前数据库记录。

## 技术栈

- 前端：Next.js 15、React 18、TypeScript、Zustand。
- 后端：Next.js Route Handlers、OpenAI 兼容流式代理。
- 数据库：PostgreSQL、Prisma ORM。
- 文件解析：pdfjs-dist、mammoth、xlsx、tesseract.js、内置 OLE 文本读取器。
- 知识图谱可视化：Cytoscape.js。
- 部署：GitHub、Vercel、Cloudflare DNS。

## 模型

- CS1 默认路由 ID：`QWen3-14B-CS1`
- CS2 路由 ID：`QWen3-14B-CS2`
- CS3 路由 ID：`QWen3-14B-CS3`

这些 ID 用于请求和会话持久化，不代表实际基座。模型选择、消息标签和图片导出显示 CS1/CS2/CS3 及服务端 `CSGPT_CS*_UPSTREAM_MODEL_NAME` 指定的当前上游标识；图片导出单列路由 ID。来源信息由现有 `/api/config` 提供，不包含上游地址或密钥。当前配置不证明历史回答的实际生成模型；自定义接口模式不引用内置服务的来源声明。

三个内置模型均通过自训练微调接口部署，并以 OpenAI 兼容协议接入。OpenAI、Anthropic 等 Provider 和用户自定义 Provider 使用同一套会话配置和增强链路。

## 设置优先级

- 全局设置是新会话的默认配置。
- 当前会话设置保存在该会话自己的 `mask.modelConfig` 中。
- 当前会话开启“同步全局配置”时，全局设置会覆盖当前会话设置。
- 当前会话关闭“同步全局配置”时，当前会话设置优先于全局设置。
- 聊天输入区的“联网搜索”和“文献搜索”是当前会话快捷开关，切换后当前会话自动脱离全局同步。
- 内部知识库默认开启；外部检索、会话文件知识和用户文件知识默认关闭，由用户按会话选择。

## 知识边界

- **当前消息附件**：当前用户消息携带的附件解析文本直接进入模型请求。
- **会话文件知识**：检索当前会话已发送附件的解析文本，适合追问“刚才那个文件”“第二张图”等当前会话资料。
- **用户文件知识**：检索当前登录用户已解析附件正文拆分出的私有重叠文本块，适合跨会话检索该用户自己的资料。
- **内部知识库**：读取 `data/csllm` 中的全局领域知识库和知识图谱。
- **会话摘要记忆**：保存当前会话历史摘要，用于长对话上下文控制。

附件解析文本和用户文件正文检索块属于当前用户数据链路，与 `data/csllm` 的全局领域知识库分离。知识图谱页面展示全局领域 KG 概览或用户输入关键词对应的查询子图。

当前消息附件、会话文件知识和用户文件知识按附件 ID 去重。当前请求或会话文件知识已覆盖的附件 ID 会从用户文件知识检索中排除。内部知识库与用户附件是不同来源层级，命中内容分别记录在 `ragKgSources`、`sessionFileSources` 和 `userFileSources` 中，前端和管理后台按来源类型分开显示。

## API 路由

- `/api/[provider]/[...path]`：通用 Provider 代理，处理模型列表和聊天补全。
- `/api/auth/login`、`/api/auth/register`、`/api/auth/me`：用户认证。
- `/api/conversations`、`/api/conversations/[id]`：会话列表、保存、读取和删除。
- `/api/files`、`/api/files/[filename]`、`/api/files/[filename]/parse`：附件上传、读取和解析状态。
- `/api/knowledge-graph`：登录保护的知识图谱概览和查询子图接口。
- `/api/research-search`：登录保护的网页、标准规范、专利和学术检索接口。
- `/api/admin/stats`：管理后台统计、详情读取和删除接口。
- `/api/config`：前端运行配置。

## 来源与工具记录

服务端代理在增强链路执行后通过响应头返回来源和工具记录：

- `x-csgpt-rag-kg-sources` → `ragKgSources`
- `x-csgpt-research-sources` → `researchSources`
- `x-csgpt-session-file-sources` → `sessionFileSources`
- `x-csgpt-user-file-sources` → `userFileSources`
- `x-csgpt-controlled-tools` → `tools`

来源面板展示可读文献题名、文件原始名称、可核对链接和去重后的知识图谱关系。哈希、UUID、CUID 等机器生成文件名显示为通用附件来源名称。

## 文件处理链路

```text
选择附件 -> 浏览器解析/OCR -> 附件记录与解析文本写入数据库 -> 用户发送消息 -> 附件引用和解析文本快照写入消息 -> 模型请求
```

- 附件选择后立即解析并显示进度。
- 附件发送后出现在对话消息中。
- 已解析附件会生成用户文件正文检索块；删除附件会删除原始文件、解析文本和该文件的用户文件正文检索块。
- 删除对话会删除该对话中没有被同一用户其他消息引用的附件记录。
- 删除文件后，历史消息中的文件名、附件引用和解析文本快照保留在消息记录中；对应文件的打开和下载不可用。
- 单个附件上限为 50 MB。
- PDF 优先提取可复制文本；没有可读文本的页面进入 OCR。
- OCR 目标是识别文字，不承诺还原曲线图数值、坐标轴数据、复杂公式语义或工程图结构关系。

## 支持的附件类型

- **表格文本**：`csv`、`tsv`
- **工作簿**：`xlsx`、`xls`、`xlsm`、`xlsb`、`ods`
- **文本文件**：`txt`、`md`、`json`、`xml`、`yaml`、`yml`、`log`、`ini`、`cfg`、`conf`、`toml`、`env`
- **代码文件**：`py`、`js`、`ts`、`jsx`、`tsx`、`html`、`css`、`scss`、`sh`、`ps1`、`bat`、`java`、`go`、`rs`、`php`、`sql`、`tex`
- **图片**：`png`、`jpg`、`jpeg`、`webp`、`gif`、`bmp`、`tif`、`tiff`
- **Word 文档**：`docx`、`docm`、`doc`
- **PDF**：`pdf`
- **演示文稿**：`pptx`、`pptm`、`ppt`

压缩包、音视频、CAD、CAE 和专有工程文件当前属于附件记录对象，正文解析范围以本节列出的类型为准。

## 外部检索

`/api/research-search` 是独立外部检索接口，支持的 Provider：

- `tavily`：网页、标准规范、专利检索，使用 `TAVILY_API_KEY`。
- `semantic-scholar`：学术论文检索，使用 `SEMANTIC_SCHOLAR_BASE_URL`、`SEMANTIC_SCHOLAR_AUTH_MODE`、`AI4SCHOLAR_API_KEY` 或 `SEMANTIC_SCHOLAR_API_KEY`。
- `elsevier-scopus`：Scopus 学术论文检索，使用 `ELSEVIER_API_KEY` 和可选 `ELSEVIER_INSTTOKEN`。
- `springer-openaccess`：Springer Nature Open Access 学术论文检索，使用 `SPRINGER_OPENACCESS_API_KEY`。

检索模式包括 `web`、`standard`、`patent` 和 `academic`。聊天链路中的外部检索来源保存到 `researchSources`，与内部知识库来源分离。

联网搜索会结合当前问题的领域词和时间意图组织网页检索式。文献搜索会将中文工程问题转换为适合英文论文库的检索式，聚合已配置的学术 Provider，并按题名、期刊、摘要和主题词过滤不相关来源。

## 知识图谱

运行数据位于：

```text
data/csllm/
  runtime/rag_chunks.compact.jsonl.gz
  runtime/relations.compact.jsonl.gz
  kg/entities.jsonl
  kg/kg_stats.json
  provenance/manifest.json
  provenance/file_manifest.jsonl
```

运行包只包含 Web 服务端实际读取的文本块、关系、实体、统计信息和 provenance 清单，不包含向量矩阵、SQLite 检索索引或离线评测文件。

内部检索使用中英文词项和 BM25 排序，忽略单独的数字与单位，并围绕命中位置提取正文。文献按来源记录区分，图谱关系按实体与关系去重；上下文和来源编号共同受长度与响应头容量限制。

知识图谱可视化读取同一套全局领域 KG 数据。没有关键词时显示代表性全局概览，有关键词时显示查询相关子图。用户文件内容保存在附件与用户文件正文检索块链路中。

运行包校验：

```bash
npm run verify:csllm
```

运行包同步：

```bash
npm run sync:csllm -- --source "<csllm-runtime-package-dir>"
```

## CS2 工程候选

`QWen3-14B-CS2` 通过语言模型回答领域知识、需求分析和结果解释问题。RAG、知识图谱、附件知识和外部检索按会话设置提供证据。复合材料压力壳与压力容器的批量候选由工程工具生成，模型负责解释输入、假设、结果与验证条件。

明确请求 FEM-ready、有限元输入包或 CSDM_cph 候选包，且给出水深或外压、圆柱段长度和内半径时，服务端可调用源表候选工具。该工具限定于源表的 40 层圆柱壳模板，返回材料、几何、铺层、来源工况和修订指纹；这些字段不是通用问答约束。CSDM_cph 的 harness 负责将提案转换为项目分析条件并执行有限元校核。历史结果仅对应来源模型与工况。

带有明确数量的批量生成请求使用概念铺层组合工具；未提供的材料类别、层数和角度空间记录为初始筛选假设，不作为用户输入或有限元结果。工具检查数量、编号、唯一性、逐层展开、角度、对称、均衡和厚度算术。单层厚度与总厚度分别采用给定值；给定等厚层数据时按层数计算总厚度。结果讨论和否定生成的请求不触发枚举。工具失败返回错误。`QWen3-14B-CS1` 和 `QWen3-14B-CS3` 不经过该工具路径。

层合板数值请求使用 `/v1/design/laminate-stiffness` 的版本 2 合同。每层提供角度、厚度和统一正交各向异性材料，或提供逐层 Qbar16/Qbar26；两种刚度输入不混用。计算范围为 A16/A26、B16/B26、D16/D26，单位分别为 N/mm、N、N·mm，参考面为几何中面，层序从负 z 到正 z。返回结果作为模型回答依据，普通理论问答仍由模型回答。层序检查只判定角度镜像和正负层数，不据此推定材料与厚度对称。

## 环境变量

```env
DATABASE_URL="postgresql://user:password@localhost:5432/csgpt?schema=public"
JWT_SECRET="your-random-jwt-secret"
ADMIN_USERNAMES=admin

CSGPT_MODEL_NAME=QWen3-14B-CS1
DEFAULT_MODEL=QWen3-14B-CS1@CSGPT
CUSTOM_MODELS=

CSGPT_CS1_BASE_URL=https://your-cs1-server/v1
CSGPT_CS1_API_KEY=your-api-key
CSGPT_CS1_UPSTREAM_MODEL_NAME=
CSGPT_CS1_CONTEXT_LENGTH=16384

CSGPT_CS2_BASE_URL=https://your-cs2-server/v1
CSGPT_CS2_API_KEY=your-api-key
CSGPT_CS2_UPSTREAM_MODEL_NAME=
CSGPT_CS2_CONTEXT_LENGTH=16384
CSGPT_CS2_DESIGN_BASE_URL=https://your-cs2-server/v1
CSGPT_CS2_DESIGN_API_KEY=your-api-key

CSGPT_CS3_BASE_URL=https://your-cs3-server/v1
CSGPT_CS3_API_KEY=your-api-key
CSGPT_CS3_UPSTREAM_MODEL_NAME=
CSGPT_CS3_CONTEXT_LENGTH=16384

TAVILY_API_KEY=
AI4SCHOLAR_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=
SEMANTIC_SCHOLAR_BASE_URL=https://ai4scholar.net/graph/v1
SEMANTIC_SCHOLAR_AUTH_MODE=bearer
ELSEVIER_API_KEY=
ELSEVIER_INSTTOKEN=
SPRINGER_OPENACCESS_API_KEY=
```

`CSGPT_CS*_CONTEXT_LENGTH` 表示对应上游的总上下文窗口，输入消息和输出消息共用该窗口。CSGPT 上游默认按 16384 tokens 配置；如果上游服务使用其他窗口，应按实际服务能力填写。CSGPT 模型的 `max_tokens` 默认目标输出预算为 16384，不是输入长度。服务端保留最新消息，按估算的 token 数优先为系统上下文分配空间，必要时压缩上下文或裁剪较早的历史轮次，再分配剩余输出预算。CS2 还会调用上游 `/tokenize`，按实际输入 token 数和后端上下文窗口校核预算；分词失败或回答空间不足时不发送生成请求。其他 Provider 的 `max_tokens` 请求不经过这套 CSGPT 专用预算处理。

`CSGPT_CS2_DESIGN_BASE_URL` 和 `CSGPT_CS2_DESIGN_API_KEY` 是 CS2 统一设计接口配置。未填写时分别复用 `CSGPT_CS2_BASE_URL` 和 `CSGPT_CS2_API_KEY`；浏览器通过 CSGPT 服务端访问上游。服务端和浏览器共用候选合同，核对请求参数、逐层厚度、历史压力、源行和当前求解状态。候选表由工件字段渲染。候选接口的 `interpretation_context` 由服务端按工件复算，模型据此说明方案取舍、铺层与厚度、制造和有限元校核。CS2 的工程说明请求使用 `response_format: json_schema`，服务端校验四段正文后，与完整候选表一起返回。合同不一致或说明无效时返回错误。

FEM-ready 请求中的单层厚度按 40 层转换为源表总厚度筛选条件；同时给出总厚度时须满足厚度算术。指定分析缺陷比时只选择对应源行，不覆盖源行工况。缺陷比支持小数、百分比和千分比；未指定时保留各源行取值。端部边界的肯定与否定要求分别解析，冲突或仅排除边界的请求返回输入错误。

CS2 客户端请求超时为 5 分钟，以覆盖确定性候选生成、知识库上下文和长表格响应所需的等待时间。CS1、CS2、CS3 的成功回答要求正文非空且 `finish_reason=stop`；流式回答还要求完整 SSE 结束标记 `[DONE]`。截断、过滤、缺少终态和错误事件均返回错误，不追加成功候选表或工件。

CSGPT 默认请求 `chat_template_kwargs.enable_thinking=false`。显式启用 thinking 时，推理与正文共用输出额度；CS2 的 `/tokenize` 和生成请求使用同一组模板参数。终态为 `length` 时按截断处理，不扩大预算自动重试。

工程工具上下文和内部检索单元保持完整；预算不足时返回上下文超限错误，不从中间裁切层序、单位、公式或适用条件。普通历史对话仍可按窗口预算压缩。

候选摘要的 `schema_version=1` 包含完整层序已生成数量、实际使用角度、按 `{angle_deg, layer_count}` 保存的角度层数合计，以及当前求解状态分组。CSGPT 从完整候选复算并核对这些事实。用户固定项与工具选择项分开保存；用户未指定层数不等于候选没有层数。`not_run/pending` 表示未求解、待判定，不表示安全通过或未达阈值。

连续追问携带消息中已完成的 `designArtifact`，服务端重新校验合同并构造解释上下文。汇总覆盖全部候选，点名候选才展开完整层序、实际角度分布、材料、几何和历史参考；无需模型重新枚举 50 行。清空上下文后不再携带旧工件。可识别的错误安全状态、层序未知声明和角度集合混淆会使解释失败，不生成替代答案；自由文本检查不是完整科学语义验证。

ABD 接口严格检查字段、单位、计算模式、指纹格式、截面身份、逐层坐标、贡献合计和终态。中文定义及范围说明检查字段形状，不要求逐字相等。内部 RAG 排除可识别的公式缺失、损坏定界符、缺表头或列单位的表格，并完整保留入选文本块。质量通过不证明公式正确；相邻块中缺失的条件、未标记的 OCR 错误仍需源库修订和人工核查。

## 本地运行

运行环境为 Node.js 22.13+（22 LTS）或 24 LTS，部署建议使用 24 LTS。包管理器为 npm，`package-lock.json` 锁定生产与开发依赖；SheetJS 使用官方 CDN 的 0.20.3 tarball，保留 XLS 与 XLSX 解析能力。

```bash
npm ci
npm run db:migrate
npm run dev
```

生产构建：

```bash
npm run build
npm audit --omit=dev
```

自托管使用 Next.js standalone 入口 `node .next/standalone/server.js`，并配套 `public`、`.next/static` 和运行知识库。静态文件位置及 Vercel 配置见 [工程验收指南](docs/engineering-validation.md)。

## 验证命令

```bash
npm test
npm run eval:csgpt
npx prisma validate
npx next typegen
npx tsc --noEmit --incremental false
npm run lint
npm run build
npm run test:ui:compat
npm run test:parsers
npm audit
```

`npm run lint` 使用 ESLint flat config 和 Next core-web-vitals 规则；单元测试包含工具链兼容检查。浏览器兼容测试覆盖本地 Markdown/JSON/PNG 导出及面具分享，页面不提供 ShareGPT 发布动作。依赖版本、审计原始结果与撤回公告证据见 [依赖核查](docs/dependency-audit.md)。

真实登录态测试支持已授权账号中新建测试会话，原有会话只读；凭据保留在仓库外，清理仅按登记的新建会话 ID 执行。配置、证据范围和部署方式见 [工程验收指南](docs/engineering-validation.md)。

MCP Server Actions 仅允许 `ENABLE_MCP=true` 且用户名位于 `ADMIN_USERNAMES` 的登录用户调用。配置与子进程是服务端全局资源，管理员凭据具有执行工具进程的权限；普通账号的聊天、文件及会话认证不受该权限控制影响。

在线检索样例：

```bash
CSGPT_EVAL_ONLINE=1 npm run eval:csgpt
```

## 项目结构

```text
app/
  api/                 # API 路由
  components/          # React 组件
  config/              # 客户端和服务端配置
  masks/               # 预设面具
  prompts/             # CSGPT 系统提示词
  store/               # Zustand 状态
  utils/               # 文件解析、检索、同步、知识库工具
data/csllm/            # 内部知识库运行数据
evals/csgpt/           # 确定性评测用例
prisma/                # Prisma schema 和迁移
public/                # 静态资源
scripts/               # 数据同步、校验和评测脚本
```

## 许可证

MIT License

## 致谢

基于 [NextChat](https://github.com/ChatGPTNextWeb/NextChat) 开源项目改造。

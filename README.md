<div align="center">

<img src="public/favicon.png" width="200" alt="CSGPT Logo"/>

# CSGPT

**复合材料结构设计助手**

基于大语言模型的复合材料压力壳智能设计平台

[![GitHub](https://img.shields.io/badge/GitHub-ZPL--03/CSGPT-blue?logo=github)](https://github.com/ZPL-03/CSGPT)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

## 项目简介

CSGPT 是一个专注于复合材料结构设计的智能助手平台，基于大语言模型技术，为工程师提供专业的复合材料压力壳设计支持。

### 核心功能

- **压力壳设计助手** - 压力容器铺层方案设计、缠绕角度优化
- **铺层设计顾问** - 复合材料铺层设计、对称性检查、角度优化
- **材料选型专家** - 碳纤维/玻纤/芳纶选型、树脂体系推荐
- **有限元指导** - ABAQUS/ANSYS 复合材料建模指导
- **标准合规检查** - ISO 11439、ASME X、EN 12245 等标准检查
- **失效分析专家** - Hashin、Puck、Tsai-Wu 准则应用

### 技术架构

```
用户浏览器 → CSGPT 前端(Next.js) → CSGPT 后端(API Routes) → OpenAI 兼容推理服务
```

### 知识层边界

- **本轮输入附件**：用户当前消息携带的附件解析文本直接进入本轮模型请求，用于回答当前问题。
- **会话文件知识**：只检索当前会话中本轮之前已发送附件的解析文本，用于后续追问时找回当前会话资料。
- **用户文件知识**：只检索当前登录用户已解析附件的私有索引，当前请求和当前会话已覆盖的附件 ID 不重复命中。
- **全局 RAG/KG**：只检索 `data/csllm` 中的领域知识库和知识图谱数据，不读取用户上传文件。
- **会话摘要记忆**：只保存当前会话历史摘要，用于控制长对话上下文长度，不作为文件检索索引。

这些链路的来源字段分别保存到 `sessionFileSources`、`userFileSources`、`ragKgSources` 和 `memoryPrompt`，不会把同一份附件内容作为多个知识层重复注入。

- **前端**：Next.js 14 + TypeScript + Zustand
- **后端**：Next.js API Routes（SSE 流式代理）
- **默认模型**：QWen3-14B-CS1（复合材料领域模型，通过 OpenAI 兼容接口部署）
- **第二模型**：QWen3-14B-CS2（Qwen3-14B 复合材料领域微调模型，通过裸 vLLM OpenAI 兼容接口部署）
- **第三模型**：QWen3-14B-CS3（Qwen3-14B 原始基座模型，通过裸 vLLM OpenAI 兼容接口部署）
- **外部 RAG/KG 增强**：网页会话设置中的可选开关，开启后允许服务端按当前问题检索项目内部 `data/csllm` 知识库并拼接检索上下文，裸模型服务器不执行检索；内置模型和经本项目代理的自定义 Provider 均可使用。回答完成后，界面显示可读文献题名，若数据包里存在链接映射则显示链接，并展示去重知识图谱关系，不显示哈希文件名、页码或正文摘录。
- **用户文件知识**：网页会话设置中的可选开关，开启后允许服务端按当前问题检索当前登录用户已解析附件对应的 `UserFileRagChunk` 索引块，并把命中的附件来源保存到消息记录的 `userFileSources` 字段；该能力不读取全局 RAG/KG 数据，也不读取其他用户附件。当前请求或会话文件知识已覆盖的附件 ID 会从用户文件知识检索中排除，避免重复注入同一附件内容。
- **会话文件知识**：网页会话设置中的可选开关，开启后允许服务端按当前问题检索当前会话中本轮之前已发送附件的解析文本，并把命中的附件来源保存到消息记录的 `sessionFileSources` 字段；该能力不读取全局 RAG/KG 数据。本轮新上传附件的解析文本直接随本轮用户消息进入模型请求，不再作为会话文件知识重复检索。
- **知识图谱可视化**：对话工具栏和侧边栏检索入口可打开知识图谱页面。页面展示 `data/csllm` 全局领域 KG 的代表性概览，或按当前输入、有效会话问题提炼出的短主题词、手动关键词展示查询子图。
- **设计计算**：`/api/design-calculation` 提供登录保护的确定性工程计算；会话设置中的“设计计算”开关允许服务端按当前问题中明确给出的工程参数执行受控计算，并把计算记录保存到消息记录的 `designCalculations` 字段。
- **结构可视化**：网页会话设置中的可选开关，开启后允许服务端按当前问题中的尺寸、形状和铺层信息生成圆柱壳、球壳或铺层截面示意，并把结果保存到消息记录的 `structureVisualizations` 字段。
- **仿真任务**：`/api/simulation-jobs` 提供登录保护的有限元任务记录、状态更新和可选外部求解器提交入口；会话设置中的“仿真任务”开关允许服务端按当前问题识别有限元或仿真需求，生成结构化仿真任务草案并保存到消息记录的 `simulationJobDrafts` 字段，同时约束模型只整理真实求解任务输入，不生成虚假的有限元云图或仿真结论。
- **外部检索**：`/api/research-search` 提供登录保护的受控检索工具目录；会话设置中的“联网搜索”和“学术检索”开关允许服务端按当前问题执行网页、标准规范、专利或学术检索，把检索结果拼接到模型请求，并把来源保存到消息记录的 `researchSources` 字段。
- **受控工具规划与记录**：聊天链路中的 RAG/KG、用户文件知识、会话文件知识、网页检索、标准规范检索、专利检索、学术检索、设计计算、结构可视化和仿真任务由服务端规划器在开关允许范围内选择执行，规划结果保存到消息记录的 `agentPlan` 字段，执行记录保存到消息记录的 `tools` 字段，受控计算、结构示意和仿真草案分别保存到对应结构化字段。
- **工程评测**：`evals/csgpt/engineering-cases.json` 保存核心工程评测集，`npm run eval:csgpt` 执行本地确定性评测；设置 `CSGPT_EVAL_ONLINE=1` 时额外执行已配置检索 Provider 的在线样例。
- **扩展模型**：可在设置中切换 OpenAI、Anthropic 等服务商，也可添加自定义模型名和接口地址
- **会话持久化**：用户发送消息后将聊天记录和附件引用写入 PostgreSQL
- **文件解析**：选择附件时在浏览器内解析文本、代码、表格、工作簿、图片 OCR、PDF、Word 文档、演示文稿和 OLE 复合文档可读文本，界面显示解析进度

### 输出长度与上下文

- 前端默认单次回复预算为 `8192`，设置页的“单次回复限制 (max_tokens)”可以由用户改低或改高，输入范围为 `1` 到 `512000`。
- 设置页中的模型配置是全局默认配置，用于新会话和选择“同步全局配置”的会话。当前会话配置保存在该会话自己的 `mask.modelConfig` 中；当前会话设置中的模型、温度、上下文条数和回复预算优先于全局默认配置。
- 普通 OpenAI 兼容模型使用 `max_tokens`；GPT-5、o1、o3 系列按接口协议使用 `max_completion_tokens`，数值来自同一项用户设置。
- CS1、CS2、CS3 服务端代理按当前会话模型配置构造 OpenAI 兼容请求，生成预算随请求发送给对应上游接口。
- 自定义模型和自定义 Provider 使用当前会话的同一套模型配置；上下文窗口、输入长度和可生成长度由上游服务实际能力决定。

### 文件处理链路

```
用户选择文件 → 浏览器解析/OCR → 原始文件和解析文本写入附件记录 → 附件引用就绪 → 用户发送消息 → 写入聊天消息和解析文本快照 → 发送模型请求
```

- 附件选择后立即解析；解析完成后原始文件按 2MB 分片写入数据库，解析文本写入附件记录。
- 附件记录保存解析状态：`pending` 表示记录已初始化，`uploaded` 表示原始文件已完整保存，`parsing` 表示解析文本正在写入，`parsed` 表示解析文本可用于文件知识检索，`failed` 表示服务端重解析失败并保存错误信息。
- 删除输入框中的附件会删除该附件记录；未发送的附件不会进入当前对话。
- 聊天消息在发送后保存文件引用、文件名、大小、MIME 类型和本轮模型使用的解析文本快照。
- “用户文件知识”开启时，服务端只检索当前登录用户状态为 `parsed` 的附件索引块，当前请求或会话文件记录中已出现的附件不重复命中，命中的附件名称通过回答下方来源面板展示。
- “会话文件知识”开启时，后续问题会检索当前会话中本轮之前已发送消息的附件解析文本，命中的附件名称通过回答下方来源面板展示。
- CS1、CS2、CS3 当前按上游接口能力发送请求：文本接口接收解析文本，多模态接口接收图片内容和解析文本。
- 附件内容通过 `/api/files/{id}` 读取，解析结果通过管理后台对话消息查看。
- 单个附件上限为 50MB；超过上限会在选择文件后直接提示，不进入解析流程。
- 长文档按页或按内嵌资源分段解析并刷新进度，避免单个大任务长时间占用浏览器界面。
- PDF 解析优先提取全部可复制文本；只有没有可读文本的页面才进入 OCR，不按文件大小限制 OCR 页数。
- OCR 会对图片做白底、缩放、灰度和对比度预处理。OCR 的目标是识别文字，不会可靠还原曲线图数据、坐标轴数值、工程图结构关系或复杂公式语义。

### 支持的附件类型

- **表格文本**：`csv`、`tsv`
  - 按行列读取为表格文本。
- **工作簿**：`xlsx`、`xls`、`xlsm`、`xlsb`、`ods`
  - 读取工作表、单元格显示值和公式；OOXML 表格内图片会进入 OCR。
- **文本文档**：`txt`、`md`、`json`、`xml`、`yaml`、`yml`、`log`、`ini`、`cfg`、`conf`、`toml`、`env` 等
  - 按文本编码读取。
- **代码文件**：`py`、`js`、`ts`、`jsx`、`tsx`、`html`、`css`、`scss`、`sh`、`ps1`、`bat`、`java`、`go`、`rs`、`php`、`sql`、`tex` 等
  - 按源码文本读取。
- **图片**：`png`、`jpg`、`jpeg`、`webp`、`gif`、`bmp`、`tif`、`tiff`
  - 执行图片 OCR。
- **Word 文档**：`docx`、`docm`
  - 读取正文、表格文本和内嵌图片 OCR。
- **二进制 Word 文档**：`doc`
  - 从 OLE 复合文档流中提取可读文本。
- **PDF**：`pdf`
  - 提取可复制文本；无可读文本的扫描页执行 OCR。
- **演示文稿**：`pptx`、`pptm`
  - 读取幻灯片文本和内嵌图片 OCR。
- **二进制演示文稿**：`ppt`
  - 从 OLE 复合文档流中提取可读文本。

未列出的二进制格式会保留附件引用，但不会承诺提取出可读正文；压缩包、音视频和专有工程文件当前不作为正文解析对象。

### 搜索与知识图谱

- **搜索聊天记录**：侧边栏检索入口中的“搜索聊天记录”会搜索当前用户已加载的会话消息，搜索范围包含消息文本、多模态文本、附件名称和附件解析文本快照。
- **知识图谱页面**：侧边栏检索入口中的“知识图谱”和对话输入栏的“知识图谱”按钮会查询 `data/csllm` 内部 KG 数据。没有关键词时显示全局领域 KG 的代表性概览；有关键词时显示查询相关子图。从对话中进入时，系统优先从当前输入提炼短主题词；当前输入为空时从最近的有效用户问题和会话标题提炼短主题词；空会话和只有问候语的会话显示全局概览。搜索框内容可以手动修改，并按新的关键词返回动态查询子图。KG 数据源始终是同一套全局领域图谱。
- **图谱数据形态**：`kg/entities.jsonl` 是实体节点，`runtime/relations.compact.jsonl.gz` 是关系边；前端使用 Cytoscape.js 渲染可缩放、可拖拽、可选择节点的实体关系图，支持按节点类型和关系类型筛选当前子图，不一次性渲染全量图谱。
- **向量库关系**：知识图谱可视化不依赖向量库。向量库用于语义检索，图谱可视化使用实体和关系数据。

### 外部检索接口

`/api/research-search` 是登录用户可访问的受控检索接口。接口不调用大模型，不读取本地 RAG/KG 数据。`GET` 返回受控工具目录、默认 Provider 和 Provider 配置状态，工具名为 `run_research_search`；`POST` 执行指定检索。会话设置中的“联网搜索”开关允许网页、标准规范和专利检索；“学术检索”开关允许学术论文检索。检索结果作为额外上下文发送给上游模型。

```json
{
  "mode": "standard",
  "provider": "tavily",
  "query": "ISO composite pressure vessel hydrogen storage",
  "maxResults": 6
}
```

支持的检索 Provider：

- `tavily`：网页、标准规范和专利检索，使用 `TAVILY_API_KEY`。
- `brave`：网页、标准规范和专利检索，使用 `BRAVE_SEARCH_API_KEY`。
- `semantic-scholar`：学术论文检索，使用 `SEMANTIC_SCHOLAR_BASE_URL`、`SEMANTIC_SCHOLAR_AUTH_MODE`、`AI4SCHOLAR_API_KEY` 或 `SEMANTIC_SCHOLAR_API_KEY`。
- `elsevier-scopus`：Scopus 学术论文检索，使用 `ELSEVIER_API_KEY`，机构令牌使用 `ELSEVIER_INSTTOKEN`。
- `springer-openaccess`：Springer Nature 开放获取论文检索，使用 `SPRINGER_OPENACCESS_API_KEY`。
- `core`：CORE 开放获取论文检索，使用 `CORE_API_KEY`。

检索模式包括 `web`、`standard`、`patent` 和 `academic`。检索结果统一返回 `title`、`url`、`snippet`、`source`、`provider`、`mode`、`publishedAt`、`year`、`authors`、`venue`、`doi` 和 `score` 等字段。聊天链路中的外部检索来源保存到 `researchSources`，与本地 RAG/KG 来源 `ragKgSources` 分离。

### 受控工具规划与记录

经服务端代理处理的聊天请求会返回 `x-csgpt-agent-plan` 响应头，记录每个增强工具是否被当前会话设置允许、是否被当前问题选中以及选择原因。前端把该响应头保存到 assistant 消息的 `agentPlan` 字段。

实际执行的增强能力会返回 `x-csgpt-controlled-tools` 响应头。前端把该响应头中的记录合并到 assistant 消息的 `tools` 字段，并在回答下方显示工具名称和命中结果。该字段记录工具是否执行、是否命中、命中数量和记录单位；来源详情仍分别保存在 `ragKgSources`、`researchSources`、`userFileSources`、`sessionFileSources` 和 `designCalculations` 字段。

### 工程评测

`evals/csgpt/engineering-cases.json` 保存项目核心评测集，覆盖工具规划、设计计算、结构可视化、仿真任务草案、仿真任务参数、本地 RAG/KG、知识图谱查询、文件解析、检索模式兼容性和可选在线检索样例。`npm run eval:csgpt` 执行本地确定性评测，不调用聊天模型，不写入数据库。

```bash
npm run eval:csgpt
```

需要验证已配置的在线检索 Provider 时使用：

```bash
CSGPT_EVAL_ONLINE=1 npm run eval:csgpt
```

在线评测只读取环境变量中的检索 API Key，输出不包含密钥内容。

### 设计计算接口

`/api/design-calculation` 是登录用户可访问的确定性工程计算接口。接口不调用大模型，不读取 RAG/KG 数据，输入和输出均为结构化 JSON。`GET` 返回受控工具目录和计算类型清单，工具名为 `run_design_calculation`；`POST` 执行指定计算。会话设置中的“设计计算”开关使用同一套计算能力，对当前问题中明确给出的工程参数执行受控计算，把计算结果作为额外上下文发送给上游模型。

```json
{
  "type": "hydrostatic-pressure",
  "input": {
    "depthM": 6000,
    "densityKgM3": 1025,
    "gravityMS2": 9.80665,
    "safetyFactor": 1.5
  }
}
```

支持的计算类型：

- `hydrostatic-pressure`：静水外压换算。
- `cylindrical-shell`：圆柱壳膜应力、壁体体积和质量估算。
- `preliminary-thickness`：按环向膜应力控制的初始厚度估算。
- `layup-summary`：铺层总厚度、角度比例和材料比例统计。
- `laminate-abd`：经典层合板 A、B、D 矩阵和等效面内工程常数。
- `maximum-stress`：最大应力失效判据。
- `hashin`：Hashin 平面应力失效判据。
- `tsai-wu`：Tsai-Wu 平面应力失效判据。
- `layup-angle-search`：按候选铺层角生成平衡铺层序列，计算等效刚度并按目标权重排序。
- `multi-objective-screening`：按质量、厚度、失效指数、储备系数、成本和制造性等数值指标筛选候选设计。
- `parameter-sensitivity`：对已有计算类型的指定输入参数扫参，输出目标指标变化和弹性系数。

聊天链路中的设计计算结果通过 `x-csgpt-design-calculations` 响应头返回前端，并保存到 assistant 消息的 `designCalculations` 字段。自动计算只覆盖能够从当前用户问题中明确识别的深度、压力、半径、长度、厚度、材料密度、许用应力和安全系数等参数；未形成完整输入的计算类型不会执行。

### 结构可视化

结构可视化由网页会话设置中的“结构可视化”开关控制。服务端只基于当前问题中明确给出的尺寸、形状和铺层信息生成示意数据，不展示仿真云图，不把知识图谱可视化伪造成结构模型。生成结果通过 `x-csgpt-structure-visualizations` 响应头返回前端，并保存到 assistant 消息的 `structureVisualizations` 字段。

支持的结构示意类型：

- `cylindrical-shell`：圆柱壳结构示意，显示内半径、长度、壁厚和外半径等尺寸。
- `spherical-shell`：球壳结构示意，显示内半径、壁厚和外半径等尺寸。
- `laminate-section`：复合材料铺层截面，显示铺层角、单层厚度、总厚度和铺层数。

### 仿真任务接口

`/api/simulation-jobs` 是登录用户可访问的有限元任务管理接口。接口保存结构化任务输入、求解器类型、状态、外部任务编号和求解器返回结果。未配置外部求解服务时，任务保存在本项目数据库中，状态为 `queued`；配置 `FEM_SERVICE_BASE_URL` 后，创建任务时可请求提交到外部求解服务。

```json
{
  "title": "6000 m 外压耐压壳有限元校核",
  "solver": "abaqus",
  "input": {
    "geometry": {
      "innerRadiusMm": 1200,
      "lengthMm": 3000,
      "thicknessMm": 120
    },
    "load": {
      "externalPressureMPa": 60
    },
    "layup": "[90/45/-45/90]"
  },
  "submitToExternal": true
}
```

支持的求解器标识：`calculix`、`abaqus`、`ansys`、`comsol`、`custom`。支持的任务状态：`queued`、`submitted`、`running`、`completed`、`failed`、`cancelled`。任务结果只来自外部求解服务或显式状态回写；平台不会把聊天回答、结构示意图或知识图谱结果当作有限元结果。聊天链路中的“仿真任务”受控工具只负责识别仿真需求和整理任务输入。聊天链路中的仿真任务草案通过 `x-csgpt-simulation-job-drafts` 响应头返回前端，并保存到 assistant 消息的 `simulationJobDrafts` 字段；用户在聊天界面保存草案后，草案会写入 `/api/simulation-jobs` 任务记录并关联当前会话和回答消息。

### 管理后台数据口径

- **数据库占用**：当前 PostgreSQL 数据库整体物理占用，包含数据库系统开销、索引、TOAST 和未回收物理空间。
- **表存储**：CSGPT 应用表、索引和 TOAST 存储的物理占用。
- **当前内容**：当前文件二进制、附件解析文本、用户文件 RAG 索引文本、消息文本与仿真任务内容合计，删除文件、对话、仿真任务或用户后按现有记录重新计算。

用户清空某个对话时，没有该对话引用且没有被该用户其他消息引用的附件文件会从文件表删除，该对话关联的仿真任务会同步删除。管理后台文件列表区分原始文件大小、解析文本大小、用户文件 RAG 索引块数、解析状态和解析时间。消息详情区分来源记录、设计计算记录、结构可视化记录、仿真任务草案、工具规划记录和工具执行记录。管理后台删除文件只删除文件表中的原始文件、解析文本和该文件的用户文件 RAG 索引块，消息里的文件名、附件引用和解析文本快照保持不变；该文件的打开和下载会变为不可用。删除对话会清理该对话中没有其他消息引用的附件记录和该对话关联的仿真任务；删除用户会级联删除该用户的令牌、对话、消息、附件、用户文件 RAG 索引块和仿真任务。

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 yarn
- conda 环境（推荐）

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/ZPL-03/CSGPT.git
cd CSGPT

# 安装依赖
npm install

# 配置环境变量
cp .env.template .env.local
# 编辑 .env.local，配置你的 API 地址和密钥

# 初始化或更新数据库结构
npm run db:migrate

# 启动开发服务器
npm run dev
```

### 环境变量配置

在 `.env.local` 文件中配置以下变量：

```env
# ===== CS1 上游 OpenAI 兼容接口（必填）=====
CSGPT_CS1_BASE_URL=https://your-cs1-server/v1
CSGPT_CS1_API_KEY=your-api-key

# CS1 上游实际模型名称（可选，不填则使用请求中的模型名）
# CSGPT_CS1_UPSTREAM_MODEL_NAME=

# ===== CS2 复合材料领域微调模型裸 vLLM 接口（可选）=====
# CSGPT_CS2_BASE_URL=https://csllm.ipen03.com/v1
# CSGPT_CS2_API_KEY=your-vllm-api-key
# CSGPT_CS2_UPSTREAM_MODEL_NAME=csllm

# ===== CS3 原始基座模型裸 vLLM 接口（可选）=====
# CSGPT_CS3_BASE_URL=https://csllm.ipen03.com/v1
# CSGPT_CS3_API_KEY=your-vllm-api-key
# CSGPT_CS3_UPSTREAM_MODEL_NAME=qwen3-14b-base

# 外部 RAG/KG 增强由网页会话设置控制，数据目录为 data/csllm。
# data/csllm/provenance 保存知识库文件清单、记录数量和哈希。

# ===== 外部有限元任务服务（可选）=====
# FEM_SERVICE_BASE_URL=
# FEM_SERVICE_API_KEY=
# FEM_SERVICE_JOBS_PATH=/jobs

# ===== 外部检索服务（可选）=====
# TAVILY_API_KEY=
# BRAVE_SEARCH_API_KEY=
# AI4SCHOLAR_API_KEY=
# SEMANTIC_SCHOLAR_API_KEY=
# SEMANTIC_SCHOLAR_BASE_URL=https://ai4scholar.net/graph/v1
# SEMANTIC_SCHOLAR_AUTH_MODE=bearer
# ELSEVIER_API_KEY=
# ELSEVIER_INSTTOKEN=
# SPRINGER_OPENACCESS_API_KEY=
# CORE_API_KEY=

# ===== 前端展示 =====
CSGPT_MODEL_NAME=QWen3-14B-CS1

# ===== 模型配置 =====
CUSTOM_MODELS=
DEFAULT_MODEL=QWen3-14B-CS1@CSGPT

# ===== 数据库配置（必填）=====
DATABASE_URL="postgresql://user:password@localhost:5432/csgpt?schema=public"

# ===== JWT 密钥（必填）=====
JWT_SECRET="your-random-jwt-secret"

# ===== 可选配置 =====
# 管理员用户名（逗号分隔，可访问 /admin 管理后台）
# ADMIN_USERNAMES=admin
```

## 项目结构

```
CSGPT/
├── app/
│   ├── api/           # API 路由
│   │   └── [provider]/ # 通用 Provider 代理路由
│   │   └── design-calculation/ # 设计计算接口
│   │   └── research-search/ # 外部检索接口
│   │   └── simulation-jobs/ # 仿真任务接口
│   │   └── files/     # 附件读写接口
│   ├── components/    # React 组件
│   ├── config/        # 配置文件
│   ├── masks/         # 预设模板
│   ├── prompts/       # CSGPT 系统提示词
│   ├── utils/         # 文件解析、请求流、同步工具、设计计算、检索和仿真任务工具
│   └── store/         # 状态管理
├── data/csllm/    # 外部 RAG/KG 增强使用的运行知识库数据和追溯清单
├── prisma/            # PostgreSQL 数据模型
├── public/            # 静态资源
└── .env.local         # 环境变量
```

## 开发指南

### 添加新的预设模板

在 `app/masks/csgpt.ts` 中添加新的 Mask 配置：

```typescript
{
  avatar: "🤖",
  name: "你的模板名称",
  context: [{
    role: "system",
    content: "你的系统提示词",
  }],
  modelConfig: { model: "QWen3-14B-CS1", providerName: "CSGPT" },
}
```

### 自定义模型和接口

设置页开启"自定义接口"后，可以为当前服务商填写 API 地址和 Key。自定义模型名支持 `model@Provider=显示名` 语法，例如 `my-model@OpenAI=内部模型`；选择 CSGPT 默认模型时走内置模型，选择其他模型时会按所选模型名请求，不会被内置默认模型覆盖。外部 RAG/KG、外部检索或学术检索开启时，自定义接口请求经本项目服务端代理转发，以便服务端注入对应上下文。

### 外部 RAG/KG 数据

运行时读取 `data/csllm/runtime/rag_chunks.compact.jsonl.gz`、`data/csllm/runtime/relations.compact.jsonl.gz` 和 `data/csllm/kg/entities.jsonl`。`data/csllm/provenance/` 保存数据清单、记录数量、字节大小和 SHA256 哈希。

聊天请求启用外部 RAG/KG 增强时，服务端检索文本块和知识图谱关系，把检索正文作为内部 system 上下文发送给上游模型。检索来源元数据通过响应头返回前端，并保存到消息记录的 `ragKgSources` 字段。来源面板只展示可读文献题名，若存在链接映射则显示链接，并展示去重知识图谱关系；没有可读题名的哈希文件名不会作为来源展示。

知识图谱可视化接口读取同一套实体和关系数据，没有关键词时返回全局概览子图，有关键词时返回查询相关的局部节点与关系边；该接口要求用户登录。

### 会话文件知识

“会话文件知识”是会话级模型配置项，对所有经过本项目服务端代理的聊天 Provider 生效。开启后，浏览器把当前会话中本轮之前已发送消息的附件解析文本作为检索记录发送到代理层，代理按当前问题检索命中片段，把会话附件上下文插入上游请求。命中的附件来源通过 `x-csgpt-session-file-sources` 响应头返回前端，并保存到 assistant 消息的 `sessionFileSources` 字段。

该能力只使用当前会话消息里的附件解析文本，不读取 `data/csllm` 全局 RAG/KG 数据，不生成会话专属知识图谱。用户本轮上传的附件解析文本仍随本轮消息直接进入模型请求；会话文件知识用于后续追问时从本轮之前已发送附件中检索相关内容。

### 用户文件知识

“用户文件知识”是会话级模型配置项，对所有经过本项目服务端代理的聊天 Provider 生效。开启后，服务端代理根据当前登录用户 ID 读取状态为 `parsed` 的附件对应的 `UserFileRagChunk` 索引块，按当前问题检索命中片段，把用户私有附件上下文插入上游请求。命中的附件来源通过 `x-csgpt-user-file-sources` 响应头返回前端，并保存到 assistant 消息的 `userFileSources` 字段。

该能力只读取当前登录用户的附件索引记录，不读取其他用户数据，不读取 `data/csllm` 全局 RAG/KG 数据，不写入全局知识库。用户文件知识与会话文件知识同时开启时，会话附件优先，当前请求和会话文件记录中已出现的附件 ID 不再从用户文件知识中重复检索。用户删除附件后，该附件的索引块随附件记录删除，该附件不再作为用户文件知识来源；已经保存到历史消息中的来源名称仍保留在消息记录里。

### 验证命令

```bash
npm run eval:csgpt
npx prisma validate
npx tsc --noEmit
npm run lint
npm run build
```

### CSGPT 系统提示词

编辑 `app/prompts/csgpt.ts` 中的 `CSGPT_SYSTEM_PROMPT` 常量。

## 许可证

MIT License

## 致谢

基于 [NextChat](https://github.com/ChatGPTNextWeb/NextChat) 开源项目改造。

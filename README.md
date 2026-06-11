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
- **文件解析与文件知识**：选择附件时在浏览器内解析，当前消息附件直接进入本轮模型请求；会话文件知识用于后续追问当前会话前序附件；用户文件知识用于检索当前登录用户已解析附件正文形成的重叠文本块。
- **外部检索**：聊天输入区提供“联网搜索”和“文献搜索”快捷开关，按当前问题注入网页、标准规范、专利或学术检索上下文。
- **会话与后台管理**：用户、会话、消息、附件、来源和工具执行记录持久化到 PostgreSQL，管理后台用于查看和删除当前数据库记录。

## 技术栈

- 前端：Next.js 14、React 18、TypeScript、Zustand。
- 后端：Next.js Route Handlers、OpenAI 兼容流式代理。
- 数据库：PostgreSQL、Prisma ORM。
- 文件解析：pdfjs-dist、mammoth、xlsx、tesseract.js、内置 OLE 文本读取器。
- 知识图谱可视化：Cytoscape.js。
- 部署：GitHub、Vercel、Cloudflare DNS。

## 模型

- 默认模型：`QWen3-14B-CS1`
- 第二模型：`QWen3-14B-CS2`
- 第三模型：`QWen3-14B-CS3`

三个内置模型均通过自训练微调接口部署，并以 OpenAI 兼容协议接入。OpenAI、Anthropic 等 Provider 和用户自定义 Provider 使用同一套会话配置和增强链路。

## 设置优先级

- 全局设置是新会话的默认配置。
- 当前会话设置保存在该会话自己的 `mask.modelConfig` 中。
- 当前会话开启“同步全局配置”时，全局设置会覆盖当前会话设置。
- 当前会话关闭“同步全局配置”时，当前会话设置优先于全局设置。
- 聊天输入区的“联网搜索”和“文献搜索”是当前会话快捷开关，切换后当前会话自动脱离全局同步。
- 内部知识库默认开启；外部检索、会话文件知识和用户文件知识默认关闭，由用户按会话选择。

## 知识边界

- **当前消息附件**：用户本轮消息携带的附件解析文本直接进入本轮模型请求。
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
- `core`：CORE 开放获取论文检索，使用 `CORE_API_KEY`。

检索模式包括 `web`、`standard`、`patent` 和 `academic`。聊天链路中的外部检索来源保存到 `researchSources`，与内部知识库来源分离。

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

知识图谱可视化读取同一套全局领域 KG 数据。没有关键词时显示代表性全局概览，有关键词时显示查询相关子图。用户文件内容保存在附件与用户文件正文检索块链路中。

运行包校验：

```bash
npm run verify:csllm
```

运行包同步：

```bash
npm run sync:csllm -- --source "<csllm-runtime-package-dir>"
```

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

CSGPT_CS2_BASE_URL=https://your-cs2-server/v1
CSGPT_CS2_API_KEY=your-api-key
CSGPT_CS2_UPSTREAM_MODEL_NAME=

CSGPT_CS3_BASE_URL=https://your-cs3-server/v1
CSGPT_CS3_API_KEY=your-api-key
CSGPT_CS3_UPSTREAM_MODEL_NAME=

TAVILY_API_KEY=
AI4SCHOLAR_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=
SEMANTIC_SCHOLAR_BASE_URL=https://ai4scholar.net/graph/v1
SEMANTIC_SCHOLAR_AUTH_MODE=bearer
ELSEVIER_API_KEY=
ELSEVIER_INSTTOKEN=
SPRINGER_OPENACCESS_API_KEY=
CORE_API_KEY=
```

## 本地运行

```bash
npm install
npm run db:migrate
npm run dev
```

生产构建：

```bash
npm run build
npm run start
```

## 验证命令

```bash
npm run eval:csgpt
npx prisma validate
npx tsc --noEmit
npm run lint
npm run build
```

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

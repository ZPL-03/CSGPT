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

- **前端**：Next.js 14 + TypeScript + Zustand
- **后端**：Next.js API Routes（SSE 流式代理）
- **默认模型**：QWen3-14B-CS1（Qwen3-14B 复合材料领域微调模型，通过自训练微调接口部署）
- **第二模型**：QWen3-14B-CS2（Qwen3-14B 复合材料领域微调模型，通过自训练微调接口部署）
- **第三模型**：QWen3-14B-CS3（Qwen3-14B 复合材料领域微调模型，通过自训练微调接口部署）
- **第四模型**：QWen3-14B-CS4（Qwen3-14B 原始基座模型，通过 OpenAI 兼容接口部署）
- **第五模型**：QWen3-14B-CS5（Qwen3-14B 复合材料领域微调模型，通过 OpenAI 兼容接口部署，不经过 RAG/KG）
- **扩展模型**：可在设置中切换 OpenAI、Anthropic 等服务商，也可添加自定义模型名和接口地址
- **会话持久化**：用户发送消息后将聊天记录和附件引用写入 PostgreSQL
- **文件解析**：选择附件时在浏览器内解析文本、代码、表格、工作簿、图片 OCR、PDF、Word 文档、演示文稿和 OLE 复合文档可读文本，界面显示解析进度

### 输出长度与上下文

- 前端默认单次回复预算为 `8192`，设置页的“单次回复限制 (max_tokens)”可以由用户改低或改高，输入范围为 `1` 到 `512000`。
- 设置页中的模型配置是全局默认配置，用于新会话和选择“同步全局配置”的会话。当前会话配置保存在该会话自己的 `mask.modelConfig` 中；当前会话设置中的模型、温度、上下文条数和回复预算优先于全局默认配置。
- 普通 OpenAI 兼容模型使用 `max_tokens`；GPT-5、o1、o3 系列按接口协议使用 `max_completion_tokens`，数值来自同一项用户设置。
- CS1、CS2、CS3、CS4、CS5 服务端代理按当前会话模型配置构造 OpenAI 兼容请求，生成预算随请求发送给对应上游接口。
- 自定义模型和自定义 Provider 使用当前会话的同一套模型配置；上下文窗口、输入长度和可生成长度由上游服务实际能力决定。

### 文件处理链路

```
用户选择文件 → 浏览器解析/OCR → 原始文件和解析文本写入附件记录 → 附件引用就绪 → 用户发送消息 → 写入聊天消息和解析文本快照 → 发送模型请求
```

- 附件选择后立即解析；解析完成后原始文件按 2MB 分片写入数据库，解析文本写入附件记录。
- 删除输入框中的附件会删除该附件记录；未发送的附件不会进入当前对话。
- 聊天消息在发送后保存文件引用、文件名、大小、MIME 类型和本轮模型使用的解析文本快照。
- CS1、CS2、CS3、CS4、CS5 当前按上游接口能力发送请求：文本接口接收解析文本，多模态接口接收图片内容和解析文本。
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

### 管理后台数据口径

- **数据库占用**：当前 PostgreSQL 数据库整体物理占用，包含数据库系统开销、索引、TOAST 和未回收物理空间。
- **表存储**：CSGPT 应用表、索引和 TOAST 存储的物理占用。
- **当前内容**：当前文件二进制与消息文本内容合计，删除文件、对话或用户后按现有记录重新计算。

用户清空某个对话时，没有该对话引用且没有被该用户其他消息引用的附件文件会从文件表删除。管理后台删除文件只删除文件表中的二进制文件，消息里的文件名、附件引用和解析文本保持不变；该文件的打开和下载会变为不可用。删除对话会清理该对话中没有其他消息引用的附件记录；删除用户会级联删除该用户的令牌、对话、消息和附件。

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

# 启动开发服务器
npm run dev
```

### 环境变量配置

在 `.env.local` 文件中配置以下变量：

```env
# ===== CS1 上游推理服务（必填）=====
CSGPT_CS1_BASE_URL=http://your-server:8000/v1
CSGPT_CS1_API_KEY=your-api-key

# CS1 上游实际模型名称（可选，不填则使用请求中的模型名）
# CSGPT_CS1_UPSTREAM_MODEL_NAME=

# ===== CS2 上游推理服务（可选）=====
# CSGPT_CS2_BASE_URL=http://your-server:8080/v1
# CSGPT_CS2_API_KEY=your-api-key
# CSGPT_CS2_UPSTREAM_MODEL_NAME=

# ===== CS3 上游推理服务（可选）=====
# CSGPT_CS3_BASE_URL=http://your-server:8000/v1
# CSGPT_CS3_API_KEY=your-api-key
# CSGPT_CS3_UPSTREAM_MODEL_NAME=

# ===== CS4 原始基座模型接口（可选）=====
# CSGPT_CS4_BASE_URL=https://your-csllm-server/raw-vllm/v1
# CSGPT_CS4_API_KEY=your-vllm-api-key
# CSGPT_CS4_UPSTREAM_MODEL_NAME=qwen3-14b-base

# ===== CS5 微调模型裸接口（可选）=====
# CSGPT_CS5_BASE_URL=https://your-csllm-server/raw-vllm/v1
# CSGPT_CS5_API_KEY=your-vllm-api-key
# CSGPT_CS5_UPSTREAM_MODEL_NAME=csllm-cpv

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
│   │   └── files/     # 附件读写接口
│   ├── components/    # React 组件
│   ├── config/        # 配置文件
│   ├── masks/         # 预设模板
│   ├── prompts/       # CSGPT 系统提示词
│   ├── utils/         # 文件解析、请求流、同步工具
│   └── store/         # 状态管理
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

设置页开启"自定义接口"后，可以为当前服务商填写 API 地址和 Key。自定义模型名支持 `model@Provider=显示名` 语法，例如 `my-model@OpenAI=内部模型`；选择 CSGPT 默认模型时走内置模型，选择其他模型时会按所选模型名请求，不会被内置默认模型覆盖。

### 验证命令

```bash
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

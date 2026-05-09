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
- **默认模型**：QWen3-14B-CS1（Qwen3-14B 复合材料领域微调模型，通过 OpenAI 兼容接口部署）
- **第二模型**：QWen3-14B-CS2（Qwen3-14B 复合材料领域微调模型，通过独立 OpenAI 兼容接口部署）
- **第三模型**：QWen3-14B-CS3（Qwen3-14B 复合材料领域微调模型，通过自训练微调接口部署）
- **扩展模型**：可在设置中切换 OpenAI、Anthropic 等服务商，也可添加自定义模型名和接口地址
- **文件存储**：用户发送消息时将原始文件二进制数据保存到 PostgreSQL
- **文件解析**：选择附件时在浏览器内解析文本、图片 OCR、DOCX、PDF、XLSX/XLS、ODS、PPTX，界面显示解析进度

### 文件处理链路

```
用户选择文件 → 浏览器解析/OCR → 用户发送消息 → 写入 UploadedFile.data → 写入 Message.fileContent → 发送模型请求
```

- 删除未发送的附件不会写入数据库。
- 文件表保存原始文件，消息表保存本轮模型使用的解析文本。
- 聊天消息保存文件引用、文件名、大小、MIME 类型和本轮模型使用的解析文本。
- CS1、CS2、CS3 当前按上游接口能力发送请求：文本接口接收解析文本，多模态接口接收图片内容和解析文本。
- 原始文件通过 `/api/files/{id}` 读取，解析结果通过管理后台对话消息查看。
- 单个原始文件保存上限为 50MB；PDF 解析优先提取可复制文本，仅对无可读文本的页面执行 OCR。
- OCR 会对图片做白底、缩放、灰度和对比度预处理；复杂版式、手写内容、低清扫描、公式和工程图仍以识别结果为准。

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
│   │   └── files/     # 上传文件读写与解析结果接口
│   ├── components/    # React 组件
│   ├── config/        # 配置文件
│   ├── masks/         # 预设模板
│   ├── prompts/       # 系统提示词
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

### 自定义系统提示词

编辑 `app/prompts/csgpt.ts` 中的 `CSGPT_SYSTEM_PROMPT` 常量。

## 许可证

MIT License

## 致谢

基于 [NextChat](https://github.com/ChatGPTNextWeb/NextChat) 开源项目改造。

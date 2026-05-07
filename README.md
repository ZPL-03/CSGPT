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
用户浏览器 → CSGPT 前端(Next.js) → CSGPT 后端(API Routes) → vLLM 推理服务
```

- **前端**：Next.js 14 + TypeScript + Zustand
- **后端**：Next.js API Routes（SSE 流式代理）
- **默认模型**：CSGPT-Qwen3-14B（Qwen3-14B 复合材料领域微调模型，通过 vLLM/OpenAI 兼容接口部署）
- **扩展模型**：可在设置中切换 OpenAI、Anthropic 等服务商，也可添加自定义模型名和接口地址

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
# 模型 API 地址
CSGPT_BASE_URL=http://your-server:8000/v1

# API Key
CSGPT_API_KEY=your-api-key

# 前端展示的内置默认模型
CSGPT_MODEL_NAME=CSGPT-Qwen3-14B

# 临时上游实际模型名（可选）
# 如果当前 CSGPT_BASE_URL 仍指向中转服务，可填写真实上游模型；
# 正式切回 vLLM Qwen3-14B 后留空即可。
# CSGPT_UPSTREAM_MODEL_NAME=

# 默认会话模型
DEFAULT_MODEL=CSGPT-Qwen3-14B@CSGPT

# 访问控制码（可选）
ACCESS_CODE=your-access-code

# 管理员用户名（逗号分隔，可访问 /admin 管理后台）
ADMIN_USERNAMES=admin
```

## 项目结构

```
CSGPT/
├── app/
│   ├── api/           # API 路由
│   │   └── csgpt/     # CSGPT 专用 API
│   ├── components/    # React 组件
│   ├── config/        # 配置文件
│   ├── masks/         # 预设模板
│   ├── prompts/       # 系统提示词
│   └── store/         # 状态管理
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
  modelConfig: { model: "CSGPT-Qwen3-14B", providerName: "CSGPT" },
}
```

### 自定义模型和接口

设置页开启“自定义接口”后，可以为当前服务商填写 API 地址和 Key。自定义模型名支持 `model@Provider=显示名` 语法，例如 `my-model@OpenAI=内部测试模型`；选择 CSGPT 默认模型时走内置 CSGPT-Qwen3-14B，选择其他模型时会按所选模型名请求，不会被内置默认模型覆盖。

### 验证命令

```bash
npx tsc --noEmit
npm run lint
npm run test:ci
npm run build
```

### 自定义系统提示词

编辑 `app/prompts/csgpt.ts` 中的 `CSGPT_SYSTEM_PROMPT` 常量。

## 许可证

MIT License

## 致谢

基于 [NextChat](https://github.com/ChatGPTNextWeb/NextChat) 开源项目改造。

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
- **模型**：Qwen3-14B-QLoRA（通过 vLLM 部署）

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
cp .env.example .env.local
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

# 模型名称
CSGPT_MODEL_NAME=CSGPT-V1

# 访问控制码（可选）
ACCESS_CODE=your-access-code
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
  modelConfig: { model: "CSGPT-V1" },
}
```

### 自定义系统提示词

编辑 `app/prompts/csgpt.ts` 中的 `CSGPT_SYSTEM_PROMPT` 常量。

## 许可证

MIT License

## 致谢

基于 [NextChat](https://github.com/ChatGPTNextWeb/NextChat) 开源项目改造。

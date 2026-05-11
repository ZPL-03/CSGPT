# CLAUDES.md

## 项目概览

- 这是一个复合材料结构设计大模型 CSGPT 全栈项目，默认内置 CSGPT 系列复合材料领域模型，同时保留 OpenAI、Anthropic 等 Provider 的自定义接口能力。
- 项目地址：[CSGPT](https://github.com/ZPL-03/CSGPT)

## 项目架构

- 开发环境使用本地 conda 虚拟环境，名为 GPT
- 基于 NextChat 开源项目改造（https://github.com/ChatGPTNextWeb/NextChat）
- 前端：Next.js 14 + React 18 + Zustand 状态管理
- 后端 API：Next.js Route Handlers，对接多 Provider 流式推理
- 数据库：PostgreSQL（Prisma ORM），含用户认证与附件管理
- 文件解析：浏览器端 pdfjs-dist + mammoth + xlsx + tesseract.js OCR + OLE 复合文档读取（.doc/.ppt 二进制文本提取）
- 模型接入：内置 CS1、CS2、CS3 三个自研复合材料领域模型（CS1 为默认模型），均走 OpenAI 兼容协议。当前部分模型临时接入第三方 API 作为占位，后续替换为自训推理服务即可

## 关联项目

- `D:\Project\VS_Code\CS_LLM_cpv` 是 CSGPT 领域模型训练项目，基于 LLaMA-Factory 对 Qwen3-14B 基座模型进行 LoRA 微调，采用 FSDP 分布式训练。具备完整的领域数据处理管线：MinerU 文档解析（pipeline/hybrid-auto-engine 双后端）与 Docling 后备解析，pyNastran/meshio 工程文件解析（Nastran BDF、Abaqus INP、网格文件），LaTeX 公式提取与验证，工程文本规范化。内置 Neo4j 知识图谱（复合材料结构设计领域，含 9 类节点标签与 7 种关系类型）。包含领域训练数据、评测数据集与提示词模板。

## 代码与文档

- 所有文档和代码注释使用中文。
- 文档和代码注释只描述当前事实和当前流程，不写过程说明。
- 校验文件、缓存、临时日志和无用脚本不保留在项目目录中。

## 核心原则

- **绝不偷懒**：出现错误找到根因，不要临时修复，坚持资深开发者标准
- **最小影响**：只修改必要部分，避免引入新 bug，不要引入无效繁琐兜底逻辑
- **最终整理**：清理所有代码冗余、旧逻辑，更新所有文档、代码注释

# 依赖核查

## 范围与结论

2026-11-19，Windows x64、Node.js 24.14.1、npm 11.12.1 下，`npm audit --omit=dev` 与包含开发依赖的 `npm audit` 均报告 **0 项**，退出码均为 0。审计没有提高告警门槛或配置公告忽略项；结果是当日依赖公告快照，锁文件 SHA256 见验证记录。

迁移对照：Router 6.30.6 → 7.18.5，KaTeX 0.16.45 → 0.18.10，Mermaid 10.9.8 → 12.3.0；React Markdown 8.0.7 → 10.1.0，rehype-katex 6.0.3 → 7.0.1，remark-math 5.1.1 → 6.0.0。配套插件为 remark-gfm 3.0.1 → 4.0.1、remark-breaks 3.0.2 → 4.0.0、rehype-highlight 6.0.0 → 7.0.2、micromark-extension-math 2.1.2 → 3.1.0。React 18.2.0 保持不变。

| 依赖                                                   | 锁定版本               | 用途与选择依据                                                                     |
| ------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| Next.js / `@next/third-parties` / `eslint-config-next` | 15.5.28                | Windows 文件系统、图像优化和 Server Action 拒绝服务相关补丁                        |
| React / React DOM                                      | 18.2.0                 | 满足 Next.js 与 React Router 的 peer 范围                                          |
| `react-router-dom` / `react-router`                    | 7.18.5                 | 公告修复范围 `>=7.18.0`；保留声明式 HashRouter                                     |
| KaTeX                                                  | 0.18.10                | 原型 trust 公告修复范围 `>=0.18.2`；0.18.11 因误发不兼容变更被 npm 标记 deprecated |
| Mermaid                                                | 12.3.0                 | 原生声明 `katex ^0.18.0`，不需要 KaTeX override                                    |
| `react-markdown` / `rehype-katex` / `remark-math`      | 10.1.0 / 7.0.1 / 6.0.0 | unified 11 数学渲染链                                                              |
| `remark-gfm` / `remark-breaks` / `rehype-highlight`    | 4.0.1 / 4.0.0 / 7.0.2  | 与当前 Markdown AST 和插件类型配套                                                 |
| `micromark-extension-math`                             | 3.1.0                  | 数学语法扩展，由 remark-math 引入                                                  |
| Sharp / Zod                                            | 0.35.5 / 4.6.7         | 图像处理与数组校验公告修复版本                                                     |
| SheetJS                                                | 0.20.3                 | 官方 CDN 分发，保留 XLS 与 XLSX                                                    |
| PDF.js                                                 | 6.5.438                | 使用 `@napi-rs/canvas`，锁定树不含 `canvas`、`@mapbox/node-pre-gyp`、`tar`         |
| PostCSS（Next.js 内）                                  | 8.5.23                 | 限定于 Next.js 的 override                                                         |

SheetJS 来源：`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`。安装包 SHA-256 为 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`；SHA-512 完整性保存在 lockfile，由单元测试核对。

相关公告：[Next.js Server Action DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)、[Next.js Windows RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36)、[Sharp](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。

## Router 接口核对

两条相关公告为[反斜线开放重定向](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)（`>=6.0.0 <7.18.0`）和 [SSR hydration 构造器注入](https://github.com/advisories/GHSA-337j-9hxr-rhxg)（`>=6.4.0 <7.18.0`）。`react-router-dom` 包节点继承 `react-router` 风险，不是第三条独立漏洞。

依据 [7.18.5 的 v6 迁移指南](https://github.com/remix-run/react-router/blob/react-router%407.18.5/docs/upgrading/v6.md)，核对结果如下：

| 接口或行为                                   | 应用使用方式与兼容证据                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Node / React 基线                            | Router 7 要求 Node 20+、React 18+；项目 Node 22.13+/24、React 18.2 满足要求                                  |
| HashRouter、Routes、Route、Link、useNavigate | 沿用公开接口及 `react-router-dom` 兼容导出；无需将 13 个文件的导入改成新包名                                 |
| 路径匹配                                     | 路由使用绝对 `Path` 常量，没有依赖多段 `*` 相对匹配的调用                                                    |
| transition 导航                              | `next/dynamic` 位于模块作用域；没有在组件渲染期间创建 lazy 组件                                              |
| useSearchParams                              | 面具链接与 `fill` 使用 URL 查询项；测试核对编码内容保留、命令消费和查询项移除                                |
| Data Router                                  | 未使用 loader、action、fetcher、StaticRouterProvider 或 Router SSR hydration；Next.js 页面预渲染不是上述接口 |

导航实测覆盖设置、主题持久化、前进后退、深链接刷新、会话切换、新建命名、保存恢复、带反斜线和 `&` 的输入填充。外部原文不作为 `navigate/to`；Markdown 内部链接仍由原生 `a` 处理。

分享实测针对内置面具的 `/#/new-chat?mask=<id>`。聊天导出提供 Markdown 复制/下载、JSON 下载/正文点击复制、PNG 下载及桌面图片复制；移动端 PNG 使用图片弹窗。应用不提供 ShareGPT 发布按钮、`ClientApi.share` 或离屏 HTML 发布渲染器。浏览器测试核对各预览中的按钮、导出内容和 PNG 像素。

## 数学链与 Override

[KaTeX 原型 trust 公告](https://github.com/advisories/GHSA-238p-pmpm-9mq7)范围为 `>=0.11.0 <0.18.2`。页面的用户和模型文本经 rehype-katex 渲染，Mermaid 数学标签也调用 KaTeX，属于运行期可达路径。默认 `trust:false` 不能代替原型污染补丁。

`rehype-katex@7.0.1`、`micromark-extension-math@3.1.0` 的 npm 依赖仍是 `katex ^0.16.0`。两个 scoped override 指向直接依赖 `$katex`；Mermaid 12.3.0 自身接受 `^0.18.0`。安装树只有一个 KaTeX 0.18.10，不保留有公告的嵌套副本。

| 兼容点         | 核对与行为证据                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公共调用       | rehype 的 `lib/index.js` 与 micromark 的 `lib/html.js` 调用 `renderToString`，传入 `displayMode`、`throwOnError`、`strict` 等公开选项；测试直接执行两条链 |
| 错误契约       | KaTeX 保留 `ParseError`；损坏公式经生产插件链输出错误标记和源文本，不伪装为正常公式                                                                       |
| 内部 API       | [KaTeX changelog](https://github.com/KaTeX/KaTeX/blob/v0.18.10/CHANGELOG.md)中的 `__defineFunction` 私有接口变化不涉及应用和上述插件调用                  |
| CSS            | 0.18 的内部类名前缀与包内 CSS 配套；应用导入同版本 `katex/dist/katex.min.css`，无依赖旧内部类名的自定义选择器                                             |
| 信任边界       | 行内链接和图片命令不获得默认授权；`Object.create({trust:true})` 不产生可点击链接                                                                          |
| React Markdown | 组件子节点使用可选 `ReactNode`；AST `node` 不透传到 `p/a` DOM；页面和单元测试共用 `app/utils/markdown-plugins.ts`                                         |
| Mermaid        | `parse` 返回值按 `diagramType` 验证；`run` 的异常进入现有错误分支，原始代码块保留；真实浏览器渲染含公式标签的流程图与 ER 图                               |

这些证据支持当前调用集合的兼容性，不是上游对跨版本 override 的正式保证。更新数学插件、KaTeX 或 Mermaid 时应重新运行同一组测试；父依赖支持安全版本后可移除对应 override。

## 其他依赖可达性

`--omit=dev` 按安装分类统计，不能据此推断漏洞函数一定在生产请求中执行。

| 包                         | 锁定状态与公告范围           | 应用可达性                                                           |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `@babel/core`              | 7.29.13；相关公告 `<=7.29.0` | `@svgr/webpack` 构建 SVG 组件，`sourceMappingURL` 输入不来自上传附件 |
| `@babel/helpers`           | 7.29.14；修复 `>=7.26.10`    | 构建期 helper；应用未调用公告涉及的命名捕获组 `wrapRegExp`           |
| `@babel/runtime`           | 7.29.14；修复 `>=7.26.10`    | DnD、React Redux、Redux 浏览器代码使用 runtime，不能归为仅构建依赖   |
| `yaml`                     | 1.10.3；1.x 修复 `>=1.10.3`  | SVGR 的 cosmiconfig 读取构建配置；用户 YAML 附件按文本解析           |
| `diff` / `uuid`            | 锁定树无此包                 | Mermaid 12.3 的依赖树不引入这两项                                    |
| `micromark-extension-math` | 3.1.0 + KaTeX 0.18.10        | 应用调用数学语法扩展；附带的 `mathHtml` 路径也有直接行为测试         |

对应公告：[Babel 文件读取](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)、[Babel RegExp](https://github.com/advisories/GHSA-968p-4wvh-cqc8)、[diff](https://github.com/advisories/GHSA-73rr-hh4g-fpgx)、[UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq)、[YAML](https://github.com/advisories/GHSA-48c2-rrv3-qjmp)。

## 开发工具与审计来源

| 包或依赖链                       | 当前状态                                                    | 执行范围与兼容证据                                                                                                           |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `watch` → `exec-sh` → `merge`    | 均不在锁定树                                                | 仓库脚本与源码没有引用；开发监听由现有 `next dev` 承担。`app/utils/merge.ts` 是应用源码，与 npm `merge` 无关                 |
| `concurrently` → `shell-quote`   | 均不在锁定树                                                | npm scripts 没有并行命令入口；无相应运行需求                                                                                 |
| ESLint / `@eslint/eslintrc`      | 9.39.5 / 3.3.7                                              | `eslint.config.mjs` 通过 `FlatCompat` 加载 `next/core-web-vitals`；`eslint . --max-warnings=0` 检查源码                      |
| `@typescript-eslint`             | 8.73.0                                                      | 由 Next 配置引入；接受 ESLint 9 和 TypeScript 5.2.2，真实 TSX lint 检查 Hooks、图片替代文本与 Next 规则                      |
| `ajv` / `flatted` / `micromatch` | 6.15.0、8.20.0 / 3.4.4 / 4.0.8                              | lint 配置、缓存及路径匹配；当前审计没有公告项                                                                                |
| Webpack / 压缩器                 | 5.112.2 / `minimizer-webpack-plugin` 5.14.0 / Terser 5.51.2 | 生产构建；锁定树不含 `terser-webpack-plugin` 和 `serialize-javascript`，正式测试执行默认分块、`DISABLE_CHUNK` 与 export 配置 |
| `tsx` / `esbuild`                | 4.23.15 / 0.28.2                                            | TypeScript 测试与脚本入口；195 项单元测试实际经 tsx 运行                                                                     |
| `lint-staged`                    | 16.4.0                                                      | Git 提交前检查；Node 要求 `>=20.17`，保留项目 22.13 基线，17.x 要求 `>=22.22.1`                                              |

`app/components/chat.tsx` 的有效 ESLint 配置在迁移前后均为 52 条规则，规范化严重性后逐项一致。正式测试同时验证合法 TSX 通过、非法 Hooks 和图片可访问性输入被检出。`.lintstagedrc.json` 的代码文件顺序执行 ESLint 与 Prettier，其余支持的文本格式只执行 Prettier；未启用规则的 Prettier ESLint 插件与配置包不在依赖中。

ESLint 9.39.5 已被 npm 标记为停止维护。`eslint-config-next@15.5.28` 的 peer 范围止于 ESLint 9，`eslint-plugin-react@7.37.5` 也不接受 ESLint 10；当前配置遵守这些 peer 范围。生产依赖零公告不等于所有开发工具均处于上游维护期。

### 公告来源核对

[GitHub 公告 API](https://api.github.com/advisories/GHSA-fc5q-39xc-vjpf) 返回：

- `summary`: `Withdrawn Advisory: picomatch vulnerable to ReDoS through single-branch repeated extglobs`
- `withdrawn_at`: `2026-11-18T15:38:56Z`；`updated_at`: `2026-11-18T15:38:58Z`
- 公告范围 `<=4.0.7`，`first_patched_version: null`；锁定树为 Picomatch 2.3.2 和 4.0.7。
- [维护者说明](https://github.com/micromatch/picomatch/pull/235#issuecomment-6315749381)不将该报告认定为漏洞。

该公告曾由 npm 独立空缓存请求返回，涉及 15 个开发包节点：`picomatch`、`micromatch`、`fast-glob`、`globby`、`fdir`、`tinyglobby`、`lint-staged`、`eslint-import-resolver-typescript`、`@next/eslint-plugin-next`、`eslint-config-next` 和 `@typescript-eslint/{eslint-plugin,parser,type-utils,typescript-estree,utils}`。当前 npm 全量审计已不返回该撤回公告，锁文件保持不变。这些路径用于开发检查、Git hook 和文件匹配，不进入生产安装分类。

## Polyfill 与接口

- Next.js 15.5.28 自带 Array.at polyfill；独立 VM 测试移除原生方法后核对负索引、小数索引和越界。应用没有重复的 Array.at 文件或入口。
- 根级 `regenerator-runtime` 不在锁定树中；Tesseract 7 的入口和 worker 仍引用嵌套副本 0.13.11。Babel runtime 的被引用 helper 同样保留。应用没有自建 `Promise.withResolvers` 或 `DOMMatrix` shim。
- Sharp 的跨平台可选 WASM 节点属于包声明，Windows 原生 Sharp 内存 PNG 编码已核对；PDF.js legacy 入口与原生 canvas 依赖用于 Node PDF 解析。
- 动态 Route Handler 等待异步 `params`。URL、请求体、响应格式、JWT cookie、Bearer 认证和数据库 schema 保持一致；文件和会话仍按用户 ID 过滤。
- MCP Server Actions 要求 `ENABLE_MCP`、有效 JWT、数据库用户和 `ADMIN_USERNAMES`；配置与进程管理限管理员。Next Server Action ID 随构建生成，目标环境旧页面可能需要刷新。
- Zod 字符串键 record 显式声明键类型；候选角色仍要求完整键集和数值核对。
- PDF loading task 在 `finally` 中销毁；worker、renderer、CMap、字体、WASM、ICC 使用相同版本资源。

## 验证与边界

可复现命令、配置和授权登录态验收入口见 [工程验收与部署](engineering-validation.md)。

验证使用的 `package-lock.json` SHA-256：`2278f41cdb19c8be48188d93dd7126a7759dfa132fb6b59fbcb164d2f9e0952b`。

| 命令                                                       | 结果                                               |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `npm ci`                                                   | 通过，按锁文件重装                                 |
| `npm test`                                                 | 196/196 通过，0 skipped                            |
| `npm run test:ui:compat`，Edge                             | 18/18 通过，桌面与移动端各 9 项                    |
| `npm run test:parsers`，Edge                               | 3/3 通过，PDF 页面另核对非空白像素                 |
| `npx next typegen`、`npx tsc --noEmit --incremental false` | 通过                                               |
| `npm run lint`                                             | 通过，0 错误、0 告警                               |
| `npm run build`                                            | v3 运行包 standalone 构建通过，包含 `/api/health`  |
| `npm audit --omit=dev`                                     | 0 项，退出码 0                                     |
| `npm audit`                                                | 0 项，退出码 0；包含开发依赖                       |
| `git diff --check`                                         | 通过                                               |

- `npm test`：195 项通过，含候选编号、带符号角度、完成终态、文件解析、MCP 权限、数学链公共 API、trust、Next polyfill、开发工具兼容、RAG/KG v3 证据绑定、外部检索中英文材料与结构语境、报告嵌入证据及模型展示与路由身份分离。Webpack 测试核对动态导入执行结果、分块数量与不可达代码消除，临时模块由测试生成并清理。
- 浏览器兼容套件使用本地生产 standalone 构建、全新 Edge 上下文和内存认证/会话/上传接口。覆盖桌面 1440×1000 与移动端 390×844；XLS/XLSX/PDF 经实际选择文件入口解析，检查上传原始字节及提取文本。
- 图谱证据检查覆盖分块指纹、条件原文、表格投影及正文末尾。移动端通过滚轮进入证据区域，条件和正文要求完整进入可视区域；长证据随页面滚动，截图同时核对展开前后的显示。真实包检索、上下文与文件哈希见工程验收文档中的运行包报告。
- 数学测试检查三组矩阵 MathML、公式单位、Mermaid SVG 尺寸和标签。Markdown 导出保留源公式，JSON 导出按实际协议检查角色与正文。PNG 测试检查文件签名、尺寸、非空像素、标志与标题无交叠及长代码行无裁切；桌面与移动端的页面、图表和最终 PNG 均经目视检查。桌面复制捕获实际 `ClipboardItem` 内容，测试剪贴板不读写系统剪贴板。头像 CDN 请求由仓库图像样本响应，验证图像嵌入。
- PDF CDN 请求在兼容测试中由当前安装包提供；外网、模型和未声明 API 请求被阻断。测试 PDF 有完整文本层，不覆盖扫描件 OCR；短文本页会触发现有 OCR 规则，OCR 资源不可达会产生 worker 错误。
- 真实认证、数据库、模型长对话及目标环境 CSP/网络由授权登录态测试与部署验收覆盖；离线兼容套件不提供这些结论。Node 22.13 符合本机 x64 依赖的版本声明，此处执行证据来自 Node 24.14.1，未实测 Node 22。
- PDF.js 6.5.438 的 worker、renderer、日文 CMap、LiberationSans 字体、OpenJPEG WASM、QCMS WASM 和 ICC 文件已核对 CDN HTTP 200 及逐文件 SHA-256 与安装包一致。

## 文件与部署

依赖清单为 `package.json`、`package-lock.json`；检查配置为 `eslint.config.mjs`、`.lintstagedrc.json`。数学兼容代码位于 `app/components/markdown.tsx`、`app/utils/markdown-plugins.ts`；导出位于 `app/components/exporter.tsx`、`app/components/exporter.module.scss`。正式测试入口包括 `tests/dependency-runtime.test.ts`、`tests/tooling-compatibility.test.ts`、`tests/ui/compatibility.spec.ts`、`tests/ui/local-app.ts`、`tests/ui/start-server.mjs` 和 `playwright.ui.config.ts`；文件样本生成器为 `tests/helpers/parser-fixtures.ts`。

安装和部署使用 npm lockfile：Node.js 24 LTS 或 22.13+ 的 22 LTS，`npm ci`、`npm run build`。Vercel 使用 Next.js 预设；自托管使用配套静态文件与知识库的 standalone 服务。`/api/health` 只读核对运行包 manifest、文件字节和构建身份。真实账号验收需独立执行；一次性构建缓存、测试运行输出和评估 JSON 不进入发布提交，正式源代码、测试及审计结论保留。

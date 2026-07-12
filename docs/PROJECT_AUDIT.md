# 项目审计报告

审计日期：2026-07-12。工作目录：`C:\Users\kaikai\Desktop\Project\聊天ai备份`。

本报告基于当前一方源码、测试结果、生产构建和目录元数据。没有读取真实 `.env*`、证书、`storage/` 内容、根遗留 `data.json`、媒体、用户数据或归档内容；大型目录仅统计文件数与未压缩字节，不输出媒体文件名。报告不包含真实账号、密码、令牌、IP 或密钥。

## 1. 结论

本轮采用有边界的渐进式重构，并在用户缩减产品范围后完成 AI-only 清理。公开 AI 接口路径、任务响应结构和 AI 助手行为保持兼容；好友聊天、登录、私聊、贴纸、好友视频通话、智慧黄科/Hhstu、Socket.IO 与无关下载子项目不再进入主运行树和发布包。

当前产品职责为：AI 对话与会话管理、图片生成、视频生成、语音、文件上下文和 Markdown 展示。智慧黄科已独立放在 `C:\Users\kaikai\Desktop\Project\智慧黄科模块`，本报告不读取或展开该目录。

代码、测试、lint 和生产构建已在本地通过；没有服务器地址，因此没有连接或部署到阿里云。文档中的部署状态不能替代线上验证。

## 2. 统计口径与目录元数据

统计使用文件系统只读元数据递归汇总，目录本身不计数，字节为文件未压缩长度。根目录一方文件包含 `.env.example`，排除其他 `.env*`、根 `data.json`、压缩发布包和归档；`public/`、`dist/`、`storage/` 与 `node_modules/` 只汇总，不读取内容或列文件名。`workspace-artifacts/` 是主任务仍可能写入的本地验收/归档目录，明确排除在稳定统计外，且未读取内容。

| 路径/类别 | 文件数 | 字节 | 说明 |
| --- | ---: | ---: | --- |
| 根目录一方文件 | 18 | 337,346 | 源码入口、锁文件、配置与根文档 |
| `src/` | 48 | 239,463 | 前端源码与同目录测试 |
| `server/` | 19 | 156,643 | AI、媒体、存储与静态交付模块 |
| `tests/` | 18 | 67,343 | 构建、服务端、可达性、UTF-8 与 smoke 测试 |
| `scripts/` | 4 | 15,555 | 构建输出验证及浏览器/图片/视频 smoke |
| `deploy/` | 4 | 3,421 | systemd、Nginx 与部署文档；APK 材料已移出主项目 |
| `docs/` | 5 | 148,920 | 审计、计划与设计文档 |
| `public/` | 42 | 10,831,245 | 静态源与历史媒体，仅元数据 |
| `dist/` | 124 | 6,071,875 | 最新 Vite 构建，仅元数据/关键资源尺寸 |
| `storage/` | 16 | 29,327,637 | 运行时数据，仅元数据，禁止发布覆盖 |
| `node_modules/` | 24,989 | 387,343,807 | 当前本地完整开发依赖，仅元数据，不审查逐文件内容 |

主项目根目录已不存在 `hhstu/`、`dydownload-main/`、`Social/` 等旧功能目录。外部 `Project` 下的其他项目不是本应用构建输入。

## 3. 当前核心树与职责

完整核心文件树见 [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md)。当前职责边界如下：

| 模块 | 职责 |
| --- | --- |
| `src/App.tsx` | owner 初始化、会话选择/同步、页面可见性与同步代次协调 |
| `src/components/AiChat/` | AI 对话编排、紧凑居中标题、输入附件、任务动作/轮询、语音消息与视频生成 |
| `src/components/Chat/` | 消息列表、纯文本流式边界、Markdown/图片/视频渲染 |
| `src/components/Shared/` | 内容错误边界和通用附件卡片 |
| `src/services/` | AI HTTP 合约、请求重试/解析；`api.ts` 仅作兼容重导出 |
| `src/store/` | 聊天、设置与去重持久化；不再含社交状态 |
| `server.js` | Express、中间件、模块装配、静态路由与启动 |
| `server/aiRoutes.js` | AI 会话、任务、语音/图片/视频 HTTP 路由 |
| `server/aiTasks.js` | 任务状态、执行、取消与恢复编排 |
| `server/aiProviders.js` | 聊天、搜索、语音、图片上游适配 |
| `server/aiSessions.js` | owner 范围内会话与消息持久化 |
| `server/staticDelivery.js` | `/assets`、媒体路由、缓存、404 和 SPA fallback |
| `tests/build/` | `public` 白名单与禁止媒体进入 `dist` 的构建回归 |
| `tests/server/` | AI-only 表面、会话、媒体、静态交付和 provider 回归 |

已从主项目移除：`src/components/Social/`、`socialStore`、`realtime`、社交类型、Hhstu API/桥接/Python 入口、Socket.IO 服务/代理/Nginx 遗留、AI 通话入口/面板/hook，以及 `dydownload` 发布说明。旧 APK 材料已迁移到 `C:\Users\kaikai\Desktop\Project\聊天ai旧APK材料`，不再属于构建或发布输入。源码可达性与 AI-only 表面测试防止这些模块回流。

顶部标题已移除头像并压缩高度；标题位于对称的左右控制轨道之间，因此在窄屏与桌面均相对聊天区域居中，不会因单侧按钮数量发生偏移。

## 4. 请求与数据链路

```text
App owner/session coordinator
  -> 解析严格 XOR owner（user 或 guest）并选择 session
  -> AiChat / useAiChatActions
  -> POST /api/ai-task/chat|voice|image（视频走对应 AI 路由）
  -> server/aiRoutes
  -> server/aiTasks
  -> server/aiProviders / imageProvider / videoProvider
  -> 配置的上游模型 API
  -> aiSessions / storage 保存任务关联消息
  -> GET /api/ai-task/:taskId 轮询
  -> useAiChatSync 的 taskId/请求代次相关性检查
  -> chatStore 与服务端会话同步
  -> MessageList / MessageBubble
  -> 流式阶段纯文本；完成后按需 Markdown / KaTeX / Mermaid
```

前端 owner 类型使用严格 XOR：空 owner 或同时提供 user/guest 会在请求前失败。轮询对终态、taskId 代次、迟到成功/失败/取消均有保护；`App` 后台同步在流式或页面隐藏时暂停，并以请求代次阻止旧响应覆盖新会话。

## 5. 网页加载性能

本次数据来自最新 `dist/index.html` 引用关系、文件原始字节和 Node `gzipSync`。首屏关键资源定义为入口 JS、两个 module preload、主 CSS 和懒加载后立即进入 AI 页面所需的 `AiChat` chunk；不含只有消息完成并出现富文本后才加载的 Markdown/KaTeX/Mermaid。

| 资源 | raw | gzip |
| --- | ---: | ---: |
| 主入口 `index-*.js` | 28,894 B（构建摘要 28.14 kB） | 10.03 kB |
| 首屏 preload：`ui` + `vendor` | 153,679 B | 49.43 kB |
| 主 CSS | 42,945 B（构建摘要 42.95 kB） | 8.33 kB |
| `AiChat` chunk | 49,322 B（构建摘要 47.85 kB） | 15.29 kB |
| **首屏关键资源合计** | **274,840 B** | **83.08 kB** |

相较最初审计的 AI 路由关键资源 `2,357,477 B / 678,056 B gzip`，当前同类关键集合 raw 下降约 88.3%，gzip 下降约 87.7%。好友聊天与 AI 通话均已删除，因此不再沿用旧 `FriendChat` 或通话 chunk 指标。

富文本按需资源不阻塞空会话首屏：

| 按需资源 | raw | gzip |
| --- | ---: | ---: |
| `MarkdownContent` JS | 297,194 B | 91,793 B |
| `MarkdownContent` CSS | 29,232 B | 8,039 B |
| Markdown vendor | 1,004,883 B | 322,751 B |
| KaTeX | 261,395 B | 77,591 B |
| Mermaid core | 603,041 B | 141,251 B |

已处理的加载瓶颈包括：移除背景启动等待、Google Fonts 非阻塞加载、Markdown/KaTeX/Mermaid 动态导入、流式阶段不加载 Markdown chunk、localStorage 去重、Express compression、静态缓存分层、SSE/媒体压缩过滤和 Nginx buffering 策略。

## 6. 代码清理与编码

- 修复 37 处真实 mojibake/replacement/private-use 文本问题，并以 `.editorconfig` 固定 UTF-8/LF。
- `tests/sourceTextQuality.test.js` 扫描一方运行时文本，当前严格回归为 0 个问题。
- 删除原先 15 个不可达模块，随后按产品决策继续删除整个社交/Hhstu 运行面。
- `src/services/api.ts` 从 1,107 行巨石缩为兼容 barrel；HTTP 与 AI 合约分别由 `http.ts`、`aiTasksApi.ts` 负责。
- 生产 `dependencies` 只保留 Express/中间件、HTTP 客户端和服务端文件解析包；React、Zustand、Markdown/KaTeX/Mermaid、DOMPurify、图标与样式辅助库迁入 `devDependencies`，因为它们只参与 Vite 构建。未引用的 `pptxgenjs` 已删除，测试直接依赖的 `@testing-library/dom` 已显式声明。
- 锁文件中的直接/间接运行版本没有改变。远端 `npm ci --omit=dev` 实测使 release 总占用约从 350 MB 降至 152 MB，`node_modules` 约从 343 MB 降至 145 MB；数值会随平台与文件系统计量略有变化。
- 音频默认写入 `storage/audios`，`public/audios` 只作历史只读回退；Vite 只复制安全 public 白名单，构建验证拒绝 `dist/audios`、`dist/uploads` 和 `dist/videos`。
- 旧 Socket proxy、Nginx 和 fallback 遗留已清理；静态媒体路由优先于 `dist` 并明确返回资源 404。当前 SPA navigation fallback 只接受无扩展名的 HTML 导航，合法 `%25` 及嵌套百分号路径不会再被误判为 404。
- 上传目录默认总配额为 1 GiB、最多 5,000 个文件；同一客户端默认 10 分钟最多 30 次上传。四项 `.env` 参数必须为严格正十进制安全整数，无效时服务启动失败。目录 usage 默认缓存 60 秒，成功写入后增量更新，疑似超限时强制重扫，避免每请求 O(n) 扫描与小文件/inode 耗尽。validation 保持 400、quota 为 413、非预期文件系统错误为通用 500；客户端键只在直连对端为 loopback 代理时接受 `X-Forwarded-For` 覆盖。
- AI-only 新安装的空数据结构只包含 `aiSessions` 与 `videoJobs`。兼容读取旧数据时仍原样保留未知字段，避免在没有受控迁移和备份时破坏历史数据。

## 7. 超长文件

口径：当前一方代码的物理行数，包含空行和注释；统计 `.js/.mjs/.ts/.tsx/.css`，包含测试，阈值为严格大于 300 行。

| 文件 | 行数 |
| --- | ---: |
| `server/aiProviders.js` | 1,440 |
| `server/aiRoutes.js` | 750 |
| `src/styles/globals.css` | 598 |
| `server/aiTasks.js` | 485 |
| `src/App.tsx` | 476 |
| `src/services/apiModules.test.ts` | 462 |
| `server.js` | 458 |
| `tests/server/staticDelivery.test.js` | 405 |
| `src/App.test.tsx` | 372 |
| `src/components/AiChat/useAiChatSync.test.ts` | 346 |
| `server/aiSessions.js` | 330 |
| `src/components/AiChat/AudioMessage.tsx` | 315 |
| `tests/server/uploadFiles.test.js` | 310 |
| `src/components/AiChat/useAiChatSync.ts` | 306 |

优先拆分建议：`aiProviders.js` 按聊天/搜索/语音/图片 provider 拆分；`aiRoutes.js` 按会话/任务/媒体路由拆分；`globals.css` 按 shell/chat/media 分层。任何拆分都应先保持现有导出和 HTTP 合约。

## 8. 超长函数

口径：使用项目当前 `typescript` AST 解析 `.js/.mjs/.ts/.tsx`，函数跨度包含注释、空行及其内部嵌套函数；阈值为严格大于 80 行。factory、React 组件、hook 和测试 `describe` callback 的跨度不能直接等同于圈复杂度。

### 运行时代码

| 函数/组件 | 位置 | AST 行跨度 |
| --- | --- | ---: |
| `createAiProviders` | `server/aiProviders.js:7` | 1,434 |
| `registerAiRoutes` | `server/aiRoutes.js:4` | 747 |
| `createAiTaskStore` | `server/aiTasks.js:1` | 485 |
| `createAiSessionStore` | `server/aiSessions.js:1` | 330 |
| `useAiChatSync` | `src/components/AiChat/useAiChatSync.ts:19` | 288 |
| `runAiTask` | `server/aiTasks.js:191` | 224 |
| `MessageBubbleComponent` | `src/components/Chat/MessageBubble.tsx:20` | 201 |
| `AudioMessage` | `src/components/AiChat/AudioMessage.tsx:17` | 195 |
| `App` | `src/App.tsx:288` | 191 |
| `useAiChatActions` | `src/components/AiChat/useAiChatActions.ts:42` | 190 |
| `performStreamingChatCompletion` | `server/aiProviders.js:950` | 182 |
| `AppSidebar` | `src/App.tsx:115` | 172 |
| `MarkdownContent` | `src/components/Chat/MarkdownContent.tsx:13` | 167 |
| `performImageGeneration` | `server/aiProviders.js:1248` | 164 |
| Zustand persist callback | `src/store/chatStore.ts:65` | 156 |
| `AiChat` | `src/components/AiChat/AiChat.tsx:62` | 133 |
| task poll callback | `src/components/AiChat/useAiChatSync.ts:72` | 120 |
| `POST` callback | `server/aiRoutes.js:631` | 119 |
| `createServerConfig` | `server/config.js:19` | 114 |
| `createWavRecorder` | `src/utils/audioCapture.ts:188` | 111 |
| `MessageList` | `src/components/Chat/MessageList.tsx:16` | 106 |
| `VoiceRecorder` | `src/components/AiChat/AudioMessage.tsx:219` | 97 |
| Markdown effect callback | `src/components/Chat/MarkdownContent.tsx:75` | 96 |
| `createVideoProvider` | `server/videoProvider.js:79` | 93 |
| `POST` callback | `server/aiRoutes.js:539` | 91 |
| `performChatCompletion` | `server/aiProviders.js:861` | 88 |
| `POST` callback | `server/aiRoutes.js:353` | 88 |
| `createVideoFileStore` | `server/videoFiles.js:95` | 87 |
| `ImageMessage` | `src/components/Chat/ImageMessage.tsx:39` | 84 |
| `POST` callback | `server/aiRoutes.js:271` | 81 |
| `createUploadFileStore` | `server/uploadFiles.js:33` | 81 |

### 测试 callback

| 位置 | AST 行跨度 |
| --- | ---: |
| `src/App.test.tsx:92` | 281 |
| `src/components/AiChat/useAiChatSync.test.ts:72` | 275 |
| `src/utils/aiOwner.test.ts:15` | 157 |
| `tests/server/uploadFiles.test.js:116` | 195 |
| `src/components/Chat/MarkdownContent.test.tsx:17` | 126 |
| `src/services/apiModules.test.ts:235` | 125 |
| `tests/server/staticDelivery.test.js:190` | 103 |
| `src/components/AiChat/useAiChatActions.test.ts:119` | 92 |
| `tests/server/staticDelivery.test.js:321` | 85 |
| `src/services/apiModules.test.ts:361` | 81 |

## 9. 风险与处理状态

| 风险 | 状态 | 当前判断/后续动作 |
| --- | --- | --- |
| 构建/发布包夹带历史媒体 | 已处理 | public 白名单、构建失败检查、发布输入与归档条目双校验；尚需在线上首次部署验证旧副本已不可达 |
| 乱码回流 | 已处理 | UTF-8 规则与自动测试覆盖 |
| 不可达模块与职责混乱 | 已处理 | 可达性测试、API 拆分、AI-only 目录边界 |
| owner/会话竞态 | 已处理 | XOR owner、请求代次、taskId 相关性与终态哨兵 |
| 社交、Socket.IO、Hhstu、AI 通话暴露 | 已处理 | 主项目源码、依赖、路由、代理配置和发布说明均移除 |
| 上传滥用与磁盘/inode 耗尽 | 已处理基础保护 | 默认 1 GiB/5,000 文件双配额、60 秒 usage 缓存+成功增量+超限重扫、10 分钟 30 次限流、严格十进制启动校验、loopback-only XFF 和单文件限制；生产仍应监控容量 |
| API 无服务端认证/BOLA | **高，未处理** | owner ID 由客户端提供，缺少可信身份绑定；应引入服务端会话/签名 token，并对每个 session/task/media 做授权校验 |
| 历史密码/账号字段 | **高，待迁移确认** | 登录路由已删除，新安装不再生成旧字段；兼容读取仍保留旧 JSON 的未知字段。因数据为 opaque 且未读取，需由受权迁移脚本先备份、哈希/清除后验证 |
| JSON 同步持久化 | **中，未处理** | `readFileSync/writeFileSync` 在数据增大和并发时阻塞事件循环；应迁移到 SQLite/PostgreSQL 或串行异步写队列 |
| AI 任务进程内状态与并发 | **中，未处理** | 活跃任务使用进程内 `Map`，缺少跨进程队列、全局并发/配额和持久任务租约；应引入队列、TTL 清理和限流 |
| 上游明文 HTTP 默认值 | **高，未处理** | legacy/Grok 图片默认 URL 仍含 HTTP；生产必须显式配置 HTTPS，后续删除不安全默认值 |
| 上游可用性/超时 | 部分处理 | 通用 HTTP 客户端已有超时/重试，视频有轮询超时；仍需 provider 级熔断、并发限制、指标和告警 |
| 真实凭据曾在聊天暴露 | **紧急，外部动作** | 部署前立即轮换服务器凭据与仓库令牌；本文档不复述其值 |

## 10. 验证结果

本地最终验证基线：

- Vitest：**33 个测试文件，272/272 通过**。
- ESLint：通过。
- TypeScript + Vite + `scripts/verify-build-output.js`：通过。
- 构建中不存在 `dist/audios`、`dist/uploads` 或 `dist/videos`，public 安全资产复制测试通过。
- UTF-8/mojibake/replacement/private-use 扫描：通过。

静态服务隔离烟测、gzip/cache 响应头和最终移动端浏览器验收由主任务在文档完成后汇总；此处不虚构结果。没有执行阿里云部署或线上 API 验证。

## 11. 建议顺序

1. 立即轮换已暴露凭据，并在隔离环境完成生产 `.env` HTTPS 配置。
2. 增加服务端身份认证与 session/task/media 授权，优先关闭 BOLA 风险。
3. 对旧数据做受控备份和账号/密码字段迁移；不要直接人工编辑生产 JSON。
4. 将 JSON 持久化和内存任务迁移到数据库/队列，加入并发、TTL、配额、指标和告警。
5. 在兼容测试保护下继续拆分 `aiProviders.js`、`aiRoutes.js` 与语音 hook。
6. 按根 README 的 allowlist 流程部署，再验证健康、静态缓存、gzip、媒体 404 和移动端交互。

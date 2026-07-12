# 项目结构速查

当前主项目是纯 AI 助手，只保留 AI 对话、会话、图片、视频、语音、文件和 Markdown 展示。完整统计、性能与风险见 [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md)。

## 核心目录

```text
.
├─ src/
│  ├─ main.tsx                         # React 入口
│  ├─ App.tsx                          # owner、会话协调、侧栏与 AiChat 懒加载
│  ├─ App.test.tsx
│  ├─ components/
│  │  ├─ AiChat/
│  │  │  ├─ AiChat.tsx                 # AI 对话页面编排
│  │  │  ├─ AiChatHeader.tsx            # 无头像紧凑标题，两侧控制区对称居中
│  │  │  ├─ AiChatHeader.test.tsx
│  │  │  ├─ AiChatComposer.tsx
│  │  │  ├─ AiChatComposerAttachments.tsx
│  │  │  ├─ AiChatOverlays.tsx
│  │  │  ├─ useAiChatActions.ts        # 创建/取消 AI 任务
│  │  │  ├─ useAiChatSync.ts           # 任务轮询与会话同步
│  │  │  ├─ AudioMessage.tsx
│  │  │  ├─ videoGeneration.ts
│  │  │  ├─ AiChatComposerAttachments.test.tsx
│  │  │  ├─ useAiChatActions.test.ts
│  │  │  ├─ useAiChatSync.test.ts
│  │  │  └─ videoGeneration.test.ts
│  │  ├─ Chat/
│  │  │  ├─ MessageList.tsx
│  │  │  ├─ MessageBubble.tsx           # 流式纯文本边界与 Markdown 懒加载
│  │  │  ├─ MarkdownContent.tsx         # 安全 HTML、KaTeX、Mermaid
│  │  │  ├─ ImageMessage.tsx
│  │  │  ├─ VideoMessage.tsx
│  │  │  ├─ ImageMessage.test.tsx
│  │  │  ├─ MarkdownContent.test.tsx
│  │  │  ├─ MessageBubble.test.tsx
│  │  │  ├─ MessageBubbleLazyError.test.tsx
│  │  │  └─ VideoMessage.test.tsx
│  │  └─ Shared/
│  │     ├─ ContentErrorBoundary.tsx
│  │     └─ FileAttachmentCard.tsx
│  ├─ services/
│  │  ├─ api.ts                         # 兼容 barrel
│  │  ├─ aiTasksApi.ts                  # AI 会话、任务、转写 HTTP 合约
│  │  ├─ http.ts                        # fetch、超时/重试、JSON 读取
│  │  └─ apiModules.test.ts
│  ├─ store/
│  │  ├─ chatStore.ts
│  │  ├─ chatPersistence.ts
│  │  ├─ settingsStore.ts
│  │  ├─ index.ts
│  │  └─ chatPersistence.test.ts
│  ├─ utils/
│  │  ├─ aiOwner.ts                     # user/guest owner XOR 校验
│  │  ├─ aiOwner.test.ts
│  │  ├─ guestAi.ts
│  │  ├─ audioCapture.ts
│  │  ├─ markdown.ts
│  │  ├─ mermaidLoader.ts
│  │  └─ mermaidLoader.test.ts
│  ├─ styles/globals.css
│  ├─ types/{index.ts,chat.ts}
│  └─ vite-env.d.ts
├─ server.js                             # Express 装配与启动入口
├─ fileAttachmentTools.js                # 文档附件解析与上下文构造
├─ server/
│  ├─ aiRoutes.js                        # /api/ai-* 与兼容聊天路由
│  ├─ aiTasks.js                         # AI 任务执行与状态
│  ├─ aiProviders.js                     # 聊天、语音、图片 provider 编排
│  ├─ aiSessions.js                      # owner 范围内的会话/消息
│  ├─ config.js                          # 环境变量、默认值与严格十进制上传配置校验
│  ├─ env.js
│  ├─ httpClient.js
│  ├─ storage.js                         # JSON 持久化
│  ├─ staticDelivery.js                  # 静态缓存、媒体路由、保留合法 %25 的 SPA fallback
│  ├─ uploadFiles.js                     # 上传配额/限流、60 秒 usage 缓存与错误分层
│  ├─ audioFiles.js
│  ├─ mediaPayload.js
│  ├─ imageAssets.js
│  ├─ imageProvider.js
│  ├─ imageSize.js
│  ├─ videoFiles.js
│  ├─ videoJobs.js
│  ├─ videoProvider.js
│  └─ upstreamErrors.js
├─ tests/
│  ├─ build/
│  │  ├─ publicAssets.test.js
│  │  └─ verifyBuildOutput.test.js
│  ├─ server/
│  │  ├─ aiOnlySurface.test.js
│  │  ├─ aiSessions.test.js
│  │  ├─ audioFiles.test.js
│  │  ├─ staticDelivery.test.js
│  │  ├─ imageAssets.test.js
│  │  ├─ imageProvider.test.js
│  │  ├─ imageSize.test.js
│  │  ├─ mediaConfig.test.js
│  │  ├─ uploadFiles.test.js
│  │  ├─ videoConfig.test.js
│  │  ├─ videoFiles.test.js
│  │  ├─ videoJobs.test.js
│  │  └─ videoProvider.test.js
│  ├─ smoke.test.js
│  ├─ sourceReachability.test.js
│  └─ sourceTextQuality.test.js
├─ scripts/
│  ├─ verify-build-output.js
│  ├─ browser-smoke.mjs
│  ├─ image-smoke.mjs
│  └─ video-smoke.mjs
├─ deploy/server/                        # systemd、Nginx、部署文档指针
├─ public/                               # 仅构建白名单静态资产；历史媒体不发布
├─ dist/                                 # Vite 生成物，可重建
├─ storage/                              # 运行时数据，不进入发布包
└─ docs/PROJECT_AUDIT.md
```

## 请求链路

```text
App owner/session coordinator
  -> AiChat / useAiChatActions
  -> POST /api/ai-task/*
  -> aiRoutes -> aiTasks -> aiProviders
  -> 上游模型 API
  -> GET /api/ai-task/:taskId 轮询
  -> useAiChatSync -> chatStore
  -> MessageList / MessageBubble
  -> 按需 Markdown / KaTeX / Mermaid
```

## 已移出主项目

- `Social/`、`socialStore`、`realtime`、好友/私聊/贴纸/好友视频通话、登录路由和 Socket.IO 已从主运行树删除。
- AI 通话入口、面板与音频通话控制 hook 已删除；语音消息/录音能力继续保留。
- Hhstu/智慧黄科桥接与 `dydownload` 不再属于主项目依赖或发布内容。
- 智慧黄科独立副本位于 `C:\Users\kaikai\Desktop\Project\智慧黄科模块`；本审计不展开或读取其内容。
- 旧 APK 打包材料位于 `C:\Users\kaikai\Desktop\Project\聊天ai旧APK材料`，不属于主项目构建或发布输入。

## 边界规则

- 一方代码：根配置、`src/`、`server/`、`tests/`、`scripts/`、`deploy/`、`docs/`。
- 第三方：`node_modules/`；不做逐文件审查。
- 生成物：`dist/`；只从安全白名单复制 `public/` 资产。
- 运行时：`storage/`、根遗留 `data.json`、历史生成媒体；不随代码发布覆盖。新安装的空数据只初始化 `aiSessions` 与 `videoJobs`；读取旧数据时保留未知字段，避免未经迁移就破坏历史数据。
- 敏感/归档：真实 `.env*`、证书、`workspace-artifacts/`；不读取内容、不进入发布包。

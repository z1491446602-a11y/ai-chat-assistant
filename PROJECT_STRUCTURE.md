# 项目结构速查

当前主项目是纯 AI 助手。好友聊天、好友通话、AI 通话、“智慧黄科”和旧 APK 材料均不属于主运行树。

## 核心目录

```text
.
├─ src/                                  # React 前端
│  ├─ main.tsx                           # 浏览器入口
│  ├─ App.tsx                            # 认证、owner、会话、侧栏协调
│  ├─ components/
│  │  ├─ Auth/
│  │  │  ├─ AccountDialog.tsx            # 登录/注册/媒体授权/管理员工具
│  │  │  └─ AccountDialog.test.tsx
│  │  ├─ AiChat/
│  │  │  ├─ AiChat.tsx                   # AI 聊天页面编排
│  │  │  ├─ AiChatHeader.tsx             # 紧凑标题与账号入口
│  │  │  ├─ AiChatComposer.tsx           # 文本、附件与媒体输入
│  │  │  ├─ AiChatComposerAttachments.tsx
│  │  │  ├─ useAiChatActions.ts          # 提交/取消 AI 任务
│  │  │  ├─ useAiChatSync.ts             # 任务轮询与终态同步
│  │  │  ├─ imageGenerationIntent.ts     # 上一张图片跟随/扩图意图
│  │  │  ├─ videoGeneration.ts
│  │  │  └─ AudioMessage.tsx
│  │  ├─ Chat/                           # 消息列表与内容渲染
│  │  └─ Shared/                         # 错误边界、附件卡片
│  ├─ services/
│  │  ├─ http.ts                         # fetch、超时与安全重试边界
│  │  ├─ aiTasksApi.ts                   # AI 会话/任务 API
│  │  ├─ authApi.ts                      # 认证、媒体授权 API 与 401 通知
│  │  ├─ aiUploadsApi.ts                 # 单次提交的聊天附件上传 API
│  │  └─ api.ts                          # 兼容导出入口
│  ├─ store/
│  │  ├─ chatStore.ts                    # 当前聊天状态
│  │  ├─ chatPersistence.ts              # 有界本地缓存
│  │  └─ settingsStore.ts
│  ├─ utils/                             # owner、访客、音频、Markdown
│  ├─ styles/globals.css
│  └─ types/
├─ server.js                             # Express 装配与启动入口
├─ server/
│  ├─ authService.js                     # scrypt 账号和 HttpOnly 会话
│  ├─ authRoutes.js                      # 认证与管理员授权接口
│  ├─ mediaRequestService.js             # 媒体请求持久幂等与恢复
│  ├─ publicAiErrors.js                  # 上游错误中文公开映射
│  ├─ aiRoutes.js                        # AI HTTP 路由与所有权校验
│  ├─ aiTasks.js                         # 任务执行、取消和恢复
│  ├─ aiSessions.js                      # owner 范围内的会话历史
│  ├─ aiProviders.js                     # 聊天/语音/图片 provider 编排
│  ├─ mediaTaskScheduler.js              # 图片/视频并发与有界队列
│  ├─ imageFollowUp.js                   # 上一张图片引用选择
│  ├─ imageReferences.js                 # 图片引用规范化
│  ├─ imageAssets.js
│  ├─ imageProvider.js
│  ├─ imageSize.js
│  ├─ videoJobs.js
│  ├─ videoProvider.js
│  ├─ videoFiles.js
│  ├─ audioFiles.js
│  ├─ uploadFiles.js
│  ├─ storage.js                         # 原子 JSON、迁移和权限
│  ├─ config.js                          # 环境变量与严格校验
│  ├─ corsPolicy.js                      # 同源 CORS 与开发来源白名单
│  ├─ httpErrors.js                      # 统一终端错误和公开响应
│  ├─ staticDelivery.js                  # 静态缓存、媒体和 SPA fallback
│  └─ 其他小型 HTTP/媒体辅助模块
├─ tests/                                # 服务端、构建、文本质量测试
├─ scripts/
│  ├─ browser-smoke.mjs                  # 多视口浏览器冒烟检查
│  ├─ verify-build-output.js             # 构建产物安全检查
│  ├─ image-smoke.mjs
│  └─ video-smoke.mjs
├─ deploy/server/                        # Nginx、systemd 模板与部署指针
├─ docs/
│  ├─ PROJECT_AUDIT.md
│  └─ superpowers/                       # 已执行的设计/实施计划
├─ public/                               # 构建白名单静态资源
├─ dist/                                 # Vite 构建产物，可重建
└─ storage/                              # 运行时数据，禁止发布覆盖
```

测试文件通常与实现同目录或位于 `tests/server/`，名称与被测模块对应。

## 请求链路

```text
页面启动
  -> GET /api/auth/me
  -> loading | authenticated | guest | error
  -> 选择账号 owner 或本机 guest owner

普通聊天
  -> POST /api/ai-task/chat
  -> aiRoutes -> aiTasks -> aiProviders -> 上游模型
  -> aiSessions 持久化
  -> GET /api/ai-task/:taskId
  -> useAiChatSync -> chatStore -> 消息渲染

图片/视频
  -> Cookie 身份校验（游客返回 401）
  -> userId + mediaType + requestId 原子 claim / replay / 409 conflict
  -> 服务端校验图片/视频授权
  -> mediaTaskScheduler 排队/并发控制
  -> provider 生成并持久化结果
  -> mediaRequestService 持久化终态并保留至少 24 小时
```

任何请求体中的 `userId` 都不能覆盖服务端 Cookie 身份。普通游客聊天保留原行为；图片和视频必须登录。

## 持久化数据

活动数据位于 `storage/data.json`，主要命名空间如下：

```text
authUsers             # 账号、密码哈希、角色和媒体权限
authSessions          # 哈希后的登录 token；每账号最多 10 个
aiSessions            # 账号或访客的会话/消息
videoJobs             # 可恢复的视频任务证据
mediaRequests         # 图片/视频 requestId、payload 指纹、任务链接与终态
```

旧 `users`、`accounts`、`friendChats`、`announcement`、`videoCalls`、`redeemCodes`、`pointReservations` 和 `pointTransactions` 会在受控迁移中删除。生产升级必须先备份数据，迁移后确认主文件、备份和遗留根数据均不再包含这些键。

浏览器缓存最多保存 20 个会话、每个会话 50 条稳定消息；当前会话优先保留。服务器每个 owner 最多 100 个会话、每会话 200 条消息，单条内容最多 100,000 个 UTF-16 code units。流式中间态和 `data:` Base64 媒体不会进入 localStorage 或服务端历史，账号历史仍以服务器为权威来源。

媒体幂等键由登录账号、`image|video` 类型和 `requestId` 组成。相同键与相同 payload 跨并发请求、响应丢失及进程重启都返回同一任务；不同 payload 返回 409。旧调用省略标识时会生成一次兼容 ID，显式 ID 仍是跨请求重放的可靠方式。未接受 claim 的租约为 2 分钟，终态记录保留 24 小时，注册表上限 2,000 条且损坏数据会 fail-closed。普通聊天默认并发 8、队列 32、同 owner 并发 1；访客 AI 操作默认每 IP 每分钟 20 次，访客 owner 桶上限 500。

升级前专用 `ai-owner-v1` 中的旧 `{userId}` 会在浏览器侧降级为 guest 身份，服务端仅在该 ID 不属于 `authUsers` 时把旧 raw 历史桶原子迁移到 `guest:` 命名空间。已删除的社交 store 不参与迁移，避免重新信任旧账号状态。

## 已移出主项目

- 好友、私聊、贴纸、好友视频通话、Socket.IO 社交链路。
- AI 通话入口、面板与通话控制 hook；语音消息仍保留。
- Hhstu/“智慧黄科”桥接和 Python 入口。
- `dydownload` 与旧 APK 打包材料。

独立归档位置：

- `C:\Users\kaikai\Desktop\Project\智慧黄科模块`
- `C:\Users\kaikai\Desktop\Project\聊天ai旧APK材料`

## 边界规则

- `.env`、证书、生产数据、生成媒体和 `node_modules/` 不进入 Git 或发布包。
- `dist/` 只能由当前源码构建；`public/` 只复制安全白名单资产。
- API 路径兼容优先，拆分模块时不修改现有对外路由。
- 当前生产以时间戳 release + 原子软链接发布；共享 `.env` 和 `storage/` 不随代码切换。
- 服务器还有其他程序，部署只操作聊天应用目录和 `hello-kitty-chat.service`。

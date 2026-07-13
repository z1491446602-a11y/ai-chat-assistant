# 项目审计报告

审计日期：2026-07-13。主工作区：`C:\Users\kaikai\Desktop\Project\聊天ai备份`。

本报告只记录源码、构建产物元数据、测试结果和生产运行元数据。生产 `.env`、用户消息、手机号、姓名、密码、API Key、仓库令牌和媒体内容均不写入报告。

## 1. 结论与改造选择

本轮继续采用有边界的渐进式重构，而不是重写整个应用。原因是现有 React/Vite + Express 单进程骨架、AI provider 和线上 Nginx/systemd 链路仍可用，直接重写会扩大 API 路径、历史数据和流式交互的回归面。改造集中在已经阻碍安全性和维护性的边界：可信身份、积分事务、媒体幂等、任务调度、持久化恢复、错误公开策略和前端账户状态。

主项目现在是纯 AI 助手，只保留普通聊天、AI 会话历史、图片生成、视频生成、语音消息、文件附件和 Markdown 展示。好友聊天、私聊、贴纸、好友/AI 通话、Socket.IO、智慧黄科/Hhstu 和旧 APK 材料不再属于运行树或发布包。智慧黄科与旧 APK 材料分别保存在主项目外的独立归档目录。

新账户系统没有改变游客普通聊天入口。图片和视频必须登录；成功任务按 GPT 图片 0.2、Grok 图片 0.1、视频 1.5 积分计费，失败、取消、排队拒绝和不可恢复任务释放预留。

## 2. 当前职责边界

完整核心树见 [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md)。关键模块如下：

| 模块 | 职责 |
| --- | --- |
| `src/App.tsx` | 认证状态、账户代次、owner 切换、云端历史和侧栏协调 |
| `src/components/Auth/` | 登录、注册、余额、兑换码和管理员辅助重置 |
| `src/components/AiChat/` | 普通聊天、媒体任务、附件、轮询、取消和余额校准 |
| `src/services/` | 同源 HTTP 合约、稳定 requestId、中文网络错误和安全重试 |
| `src/store/chatPersistence.ts` | 有界浏览器缓存，不保存流式中间态或内嵌 Base64 媒体 |
| `server/authService.js` | scrypt 密码、哈希会话、管理员引导和密码重置 |
| `server/authRoutes.js` | HttpOnly Cookie、认证、积分和管理员 API |
| `server/pointsService.js` | 整数积分、预留、结算、兑换码和审计流水 |
| `server/mediaRequestService.js` | 付费媒体 requestId 的持久 claim、重放、租约和恢复 |
| `server/aiRoutes.js` | HTTP 路由、可信 owner、准入、限流和兼容入口 |
| `server/aiTasks.js` | 聊天/媒体调度、执行、取消、恢复和终态清理 |
| `server/aiSessions.js` | owner 范围内的有界会话和消息持久化 |
| `server/storage.js` | 原子 JSON、备份恢复、受控迁移和私有文件权限 |
| `server/corsPolicy.js` / `server/httpErrors.js` | 同源 CORS、开发白名单和统一终端错误 |

仍然较长的 `server/aiProviders.js`、`server/aiRoutes.js` 和 `server/aiTasks.js` 是下一轮可拆分对象。本轮没有为了行数指标强拆 provider/路由，因为认证、计费和恢复正在跨这些路径收口；在行为测试稳定后再按 chat/image/video 子域拆分更安全。

## 3. 请求与数据地图

```text
页面启动
  -> GET /api/auth/me
  -> authenticated | guest | error
  -> 选择 account owner 或本地 guest owner

普通聊天
  -> POST /api/ai-task/chat
  -> Cookie 身份或 guestId -> 访客限流 -> chat scheduler
  -> provider 流式响应 -> aiSessions
  -> GET /api/ai-task/:taskId
  -> useAiChatSync -> Zustand -> 消息渲染

图片 / 视频
  -> Cookie 身份校验，游客返回 401
  -> userId + mediaType + requestId 持久 claim
  -> 相同 payload 重放；不同 payload 返回 409
  -> pointsService 预留整数积分
  -> media scheduler 排队并调用 provider
  -> 结果和终态持久化
  -> 成功扣费；失败/取消/拒绝释放
  -> 前端立即及延迟刷新余额

账户与积分
  -> /api/auth/register|login|logout|me
  -> /api/points/redeem
  -> /api/admin/redeem-codes
  -> /api/admin/users/reset-password
```

请求体中的 `userId` 不能覆盖 Cookie 身份。未登录请求没有账号 owner 权限；其他账号查询任务返回 404，避免泄露对象是否存在。

## 4. 认证、积分与幂等

- 注册要求 11 位手机号、8 至 72 个字符的密码和合法真实姓名。
- 密码使用随机盐 `scrypt`；进程级最多并行 4 次 scrypt，未知手机号也执行 dummy scrypt，降低账号枚举时序差异。
- 登录 token 只在 Cookie 中公开，服务器只存 SHA-256 哈希；Cookie 为 HttpOnly、SameSite=Lax，生产使用 Secure。
- 每个账号最多保留 10 个有效登录会话。
- 管理员可生成强制含大写、小写和数字的 8 位兑换码；磁盘只保存 HMAC，不保存明文码。
- 积分使用整数单位，`1 unit = 0.1 积分`。预留和结算均为幂等事务并保留有界审计记录。
- 管理员辅助重置会核对手机号和真实姓名，更新密码并撤销该账号全部会话。没有短信验证前不提供公开自助找回。
- 付费媒体幂等键为“账号 + image/video + requestId”。未接受 claim 使用 2 分钟租约，终态至少保留 24 小时，注册表损坏会拒绝启动而不是静默清空。
- 旧调用省略 requestId 时生成一次兼容 ID；显式复用 ID 才提供跨独立请求的可靠重放。claimed 崩溃恢复会清理对应 pending、释放积分并中止 claim。
- 主数据和备份在 `saveData` 成功返回时保存同一安全状态，避免损坏恢复复活已注销会话或旧密码；财务容器字段异常会拒绝启动。

## 5. 历史、缓存与容量

浏览器最多保存 20 个会话、每会话 50 条稳定消息；服务器每个 owner 最多 100 个会话、每会话 200 条消息。两端都移除流式中间态和 `data:` Base64 媒体，因此用户不需要把“频繁清缓存”作为正常操作。账号历史以服务器为权威来源，登录同一账号可跨设备查看。

升级前专用 `ai-owner-v1` 的旧 `{userId}` 会降级为 guest 身份；服务端只在 ID 不属于真实 `authUsers` 时原子迁移旧 raw 历史桶。旧社交 store 不作为身份来源。

生产升级前的主数据约 16.7 MB，其中约 16.4 MB 是 225 个 AI owner 的历史；旧好友、公告和旧账号键合计约 156 KB。部署会先做独立备份，再由受控迁移删除旧键并保留 AI 历史。数据文件、备份和目录权限分别收紧为 0600、0600 和 0700。

默认调度边界：

| 工作类型 | 全局并发 | 全局队列 | owner 边界 |
| --- | ---: | ---: | --- |
| 普通聊天及兼容文本/语音入口 | 8 | 32 | 同 owner 并发 1、排队 4 |
| 图片/视频合计 | 4 | 24 | 每 owner 排队 2 |
| 图片 | 3 | 共享 | 受总媒体上限约束 |
| 视频 | 1 | 共享 | 受总媒体上限约束 |

访客 AI 操作默认每 IP 每 60 秒最多 20 次，限流键上限 10,000；访客 owner 桶上限 500。

## 6. 加载与运行性能

已经完成的主要优化包括：

- 删除社交、通话、Hhstu 和旧 APK 运行依赖。
- Markdown、KaTeX 和 Mermaid 按需加载；流式期间只渲染纯文本。
- 账户弹窗懒加载，主页面不提前加载管理员表单。
- 静态资源分层缓存、Express gzip、SSE/媒体压缩过滤和 Nginx 代理优化。
- public 白名单构建，历史音频、上传和视频不会进入 `dist`。
- 上传目录总量、文件数、请求频率和单文件大小均有限制。
- 聊天和媒体使用有界并发/队列，避免多用户直接压满上游与本机资源。

最初 AI 路由关键资源约为 2.36 MB raw / 678 KB gzip。最终构建资源和相对降幅在本轮全量构建后记录到第 10 节。

## 7. 编码与冗余清理

- `.editorconfig` 固定 UTF-8/LF；自动测试拒绝 mojibake、replacement/private-use 字符回流。
- `src/services/api.ts` 已从巨石实现收缩为兼容导出入口，HTTP、认证、任务和上传分别由小模块负责。
- 删除不可达社交、Socket.IO、Hhstu、AI 通话和下载子项目代码。
- 运行时媒体移入 `storage/`；构建和发布包明确排除用户数据、密钥、证书、媒体和 `node_modules/`。
- 公共 AI 错误按 allowlist 映射为中文，原始上游错误只进入服务器日志。
- 所有公网上游 URL 必须使用 HTTPS；HTTP 只允许规范 loopback/私网地址，带 URL 凭据或非规范 IP 的配置会拒绝启动。

## 8. 生产结构与部署边界

生产采用时间戳 release 与原子软链接：

```text
/www/wwwroot/chat-app -> /www/wwwroot/chat-app-releases/<release-id>
/www/wwwroot/chat-app-shared/.env
/www/wwwroot/chat-app-shared/storage/
hello-kitty-chat.service -> Node 3000
Nginx -> HTTPS -> 127.0.0.1:3000
```

服务器同时运行其他程序。本轮只允许操作上述聊天应用路径和 `hello-kitty-chat.service`，不修改其他服务、端口或站点。部署前必须备份当前 release 指针、共享 `.env`、主数据、备份数据和遗留根数据；新 release 安装完成、依赖和静态产物检查通过后才切换软链接。

部署前检查发现旧图片/Grok 上游仍使用公网 HTTP。已验证同一服务存在可用 HTTPS 端点和所需模型；上线时只替换 URL，不更换模型或密钥，也不调用付费生成做冒烟。

## 9. 剩余风险

| 风险 | 当前处理 |
| --- | --- |
| JSON 同步写入随历史增长阻塞事件循环 | 当前仍为单进程原子 JSON；生产数据约 16.7 MB。下一阶段优先迁移 SQLite/PostgreSQL 或异步串行写队列 |
| 多 Node 实例会突破内存锁和 JSON 原子假设 | 当前 systemd 只运行一个 Node 进程；禁止 PM2 cluster/多副本，迁移数据库和外部队列后再横向扩容 |
| 无短信验证的密码找回 | 只允许管理员人工核验后重置；后续接入短信 OTP 再开放自助流程 |
| provider 熔断和指标不足 | 已有超时、重试、并发和队列；后续增加成功率、延迟、队列深度和余额异常告警 |
| systemd 当前以 root 运行 | 本轮不在功能发布中同时迁移权限；后续单独验证共享目录属主后切到最小权限用户 |
| 曾在聊天中暴露过运维凭据 | 不进入源码、文档或发布包；所有者仍需在部署后轮换服务器密码和仓库令牌 |

## 10. 最终验证与部署结果

发布前本地证据（2026-07-13）：

- `npm test`：54 个测试文件，804/804 通过；`npm run lint` 和 `npm run build` 退出 0。
- `git diff --check` 无 whitespace 错误；UTF-8/逆向 mojibake、冲突标记和生产 secret 格式扫描无命中。
- HTML 初始引用合计 243,710 bytes raw / 72,601 bytes gzip；加载 AI 页面 chunk 后合计 299,309 bytes raw / 90,387 bytes gzip。相对最初约 2.36 MB raw / 678 KB gzip，分别下降约 87.3% 和 86.7%。
- 隔离数据与临时管理员下，320x568、375x812、1280x900 三种视口无横向溢出；附件菜单为不透明白底、z-index 40，打开侧栏后菜单收起；登录拦截和管理员账户控件通过。
- 构建产物校验确认 `dist/` 不包含 `.env`、运行时数据、上传、音频或视频目录。

生产 release、线上 API 冒烟、systemd/Nginx 日志、RSS、权限和迁移结果在实际部署后追加；本节不预先把计划值写成成功结果。

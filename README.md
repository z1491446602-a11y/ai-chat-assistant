# 聊天 AI

这是一个 React/Vite + Node.js/Express 的纯 AI 助手。主项目只保留普通聊天、会话历史、图片生成、视频生成、语音消息、文件附件和 Markdown 展示，不再包含好友聊天、AI 通话或“智慧黄科”。

## 功能与权限

| 功能 | 游客 | 登录用户 | 管理员 |
| --- | --- | --- | --- |
| 普通 AI 聊天与会话 | 可用 | 可用，历史记录跨设备同步 | 可用 |
| 图片生成 | 需登录 | 需管理员单独授权 | 可用 |
| 视频生成 | 需登录 | 需管理员单独授权 | 可用 |

普通账号注册后默认只可使用聊天。管理员可在账户面板内按账号分别启用图片生成和视频生成；授权状态由服务端强制校验，不能通过浏览器绕过。

图片和视频提交还会携带浏览器生成的稳定 `requestId`。服务端以“登录账号 + 媒体类型 + requestId”持久化幂等记录：相同内容的网络重试返回原任务，不会重复生成、重复写消息；同一标识用于不同内容会返回 409。已接受及终态记录可跨进程重启恢复，终态至少保留 24 小时；未接受的短暂 claim 使用 2 分钟租约自动回收。为兼容旧调用方，省略 `requestId` 时客户端或服务端会生成一次安全标识；需要跨独立请求重放时仍应由调用方显式复用同一标识。

用户使用 11 位手机号、密码和真实姓名注册。密码使用 `scrypt` 哈希，登录状态使用哈希后的 HttpOnly Cookie 会话。忘记密码时，用户需要联系管理员，由管理员人工核对手机号和真实姓名后通过受保护接口辅助设置新密码；重置成功会让该账号在所有设备退出登录。在没有短信验证服务前，项目不提供仅凭“手机号 + 姓名”的公开自助找回入口。

> 所有曾在聊天记录中出现过的服务器密码、API Key 和仓库令牌都应立即轮换。真实凭据只能保存在未跟踪的 `.env` 或安全凭据管理器中，不得写入源码、文档、命令历史或发布包。

## 运行要求

- Node.js 20.20+ 或 22 LTS 与 npm。
- 可选：FFmpeg/`ffprobe`，用于视频与部分音频处理。
- 生产环境：Debian/Ubuntu、Nginx、systemd。

## 本地运行

```powershell
npm ci
Copy-Item .env.example .env
```

编辑本地 `.env`，至少配置正在使用的聊天/图片/视频上游。用于本地 HTTP 开发时将 `NODE_ENV=development`、`AUTH_COOKIE_SECURE=false`；生产 HTTPS 必须使用 `NODE_ENV=production`、`AUTH_COOKIE_SECURE=true`。

分别启动后端与前端：

```powershell
npm run server
```

```powershell
npm run dev
```

- 开发页面：`http://localhost:3001`
- 后端：`http://127.0.0.1:3000`
- 健康检查：`http://127.0.0.1:3000/api/health`

生产方式本地预览：

```powershell
npm run build
npm run server
```

## 环境变量

完整示例见 [`.env.example`](.env.example)。重要变量如下：

| 变量 | 说明 |
| --- | --- |
| `ADMIN_PHONE` | 管理员手机号，只写在生产 `.env` |
| `ADMIN_BOOTSTRAP_PASSWORD` | 管理员引导密码；已有同手机号账号时必须验证通过才允许提升 |
| `ADMIN_REAL_NAME` | 管理员姓名 |
| `AUTH_COOKIE_SECURE` | HTTPS 生产环境必须为 `true` |
| `AUTH_SESSION_TTL_MS` | 登录会话有效期 |
| `AUTH_RATE_LIMIT_*` | 登录/注册接口的 IP 限流 |
| `STORAGE_DIR`、`DATA_FILE` | 持久化目录和 JSON 数据文件 |
| `CHAT_API_*` | 普通聊天上游 |
| `IMAGE_GPT_*`、`IMAGE_GROK_*` | 图片生成上游 |
| `VIDEO_API_*` | 视频生成上游 |
| `MEDIA_TASK_*` | 图片/视频并发、队列和每用户排队限制 |
| `UPLOAD_*` | 上传总量、文件数和请求频率限制 |

所有非空上游 URL 都在启动阶段校验。公网地址必须使用 HTTPS；HTTP 只允许规范写法的 loopback、RFC1918 私网、IPv6 ULA 或 localhost，带 URL 用户名/密码以及非规范 IP 写法会被拒绝。即使 API Key 只在请求时由浏览器传入，也不会绕过这项检查。

生产 `.env` 权限必须为 `0600`，数据目录为 `0700`，数据文件为 `0600`。禁止提交 `.env`；`.gitignore` 已明确排除它。

## 架构

```text
浏览器
  -> /api/auth/me 解析登录状态
  -> App / AiChat
  -> POST /api/ai-task/*
  -> auth middleware 绑定 Cookie 身份
  -> mediaRequestService claim/replay（图片和视频）
  -> 媒体权限校验（普通聊天跳过）
  -> aiRoutes -> aiTasks -> provider -> 上游模型 API
  -> aiSessions / videoJobs 持久化结果
  -> GET /api/ai-task/:taskId 轮询
  -> Zustand 更新页面，账号历史以服务器为准
```

关键模块：

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx` | 认证状态、账号切换、会话与侧栏协调 |
| `src/components/Auth/` | 登录、注册、媒体授权和管理员入口 |
| `src/components/AiChat/` | 聊天、附件与媒体任务交互 |
| `src/store/chatPersistence.ts` | 有界本地缓存，不保存 Base64 媒体 |
| `server/authService.js` | 注册、密码哈希、会话与管理员引导 |
| `server/authRoutes.js` | 认证与管理员授权 HTTP API |
| `server/mediaRequestService.js` | 图片/视频请求的持久幂等、租约、重放和重启恢复 |
| `server/aiRoutes.js` | AI 接口、所有权校验与媒体准入 |
| `server/aiTasks.js` | 任务运行、取消和恢复 |
| `server/storage.js` | 原子 JSON 持久化、旧数据清理与权限保护 |
| `server/publicAiErrors.js` | 将可公开的上游错误映射为中文 |

账号历史以服务器为权威来源。浏览器只保存最多 20 个会话、每个会话最多 50 条稳定消息；服务器每个 owner 最多保留 100 个会话、每个会话 200 条消息，并将访客 owner 桶限制在 500 个。两端都不会持久化内嵌 Base64 媒体，因此无需依赖用户频繁清缓存。每个账号最多保留 10 个有效登录会话，超过时淘汰最旧会话。

普通聊天默认全局同时执行 8 个任务、最多排队 32 个，同一 owner 同时执行 1 个；访客 AI 操作默认每 IP 每 60 秒最多 20 次。图片/视频并发由 `MEDIA_TASK_*` 控制，示例配置针对 2 核 2 GiB 服务器设置为总并发 5、图片 5、视频 1、总队列 24、每 owner 最多排队 2 个。一个五张图片任务会占用五个图片槽位，避免绕过并发限制。

更完整的文件树见 [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)。

## 验证命令

```powershell
npm test
npm run lint
npm run build
git diff --check
```

发布前四项必须全部成功。构建产物在 `dist/`，生产运行只需安装服务端依赖：

```bash
npm ci --omit=dev
```

## 阿里云轻量服务器部署

当前生产采用不可变 release 目录，不能把文件直接覆盖到正在运行的目录：

```text
/www/wwwroot/chat-app -> /www/wwwroot/chat-app-releases/<release-id>
/www/wwwroot/chat-app-shared/.env
/www/wwwroot/chat-app-shared/storage/
/www/wwwroot/chat-app-shared/data.json
hello-kitty-chat.service -> Node 3000
Nginx -> HTTPS 反向代理
```

服务器上还有其他程序。部署时只允许修改上述聊天应用路径，并且只重启 `hello-kitty-chat.service`；不要改动其他 systemd 服务、端口或 Nginx 站点。

### 1. 构建发布包

先执行完整验证。发布包只允许包含源码、锁文件、文档和 `dist/`，不得包含 `.env`、`storage/`、根 `data.json`、证书、`node_modules/` 或生成媒体。

```powershell
$items = @(
  '.editorconfig', '.env.example', '.gitignore', 'README.md',
  'PROJECT_STRUCTURE.md', 'package.json', 'package-lock.json',
  'index.html', 'server.js', 'fileAttachmentTools.js',
  'eslint.config.js', 'postcss.config.js', 'tailwind.config.js',
  'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts',
  'vitest.config.ts', 'src', 'server', 'tests', 'scripts',
  'deploy', 'docs', 'public', 'dist'
)

Remove-Item .\chat-app-release.tgz -Force -ErrorAction SilentlyContinue
tar -czf .\chat-app-release.tgz `
  --exclude='public/audios' `
  --exclude='public/uploads' `
  --exclude='dist/audios' `
  --exclude='dist/uploads' `
  --exclude='dist/videos' `
  $items
tar -tzf .\chat-app-release.tgz
scp .\chat-app-release.tgz '<ssh-user>@<server-ip>:/tmp/chat-app-release.tgz'
```

上传前应检查归档清单，确认没有真实环境文件或运行时数据。

### 2. 备份并创建 release

以下命令在服务器执行，所有 `<...>` 都必须替换为本次实际值。先安装依赖和检查新目录，再切换软链接，避免长时间停机。

```bash
set -euo pipefail

RELEASE_ID='<release-id>'
RELEASE_ROOT='/www/wwwroot/chat-app-releases'
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
SHARED='/www/wwwroot/chat-app-shared'
BACKUP_ROOT='/www/wwwroot/chat-app-data-backups'
BACKUP_DIR="$BACKUP_ROOT/pre-$RELEASE_ID"
ARCHIVE='/tmp/chat-app-release.tgz'

test -s "$ARCHIVE"
test ! -e "$RELEASE_DIR"
install -d -m 700 "$BACKUP_DIR"

readlink -f /www/wwwroot/chat-app > "$BACKUP_DIR/previous-release.txt"
cp -a "$SHARED/.env" "$BACKUP_DIR/env.backup"
test ! -f "$SHARED/data.json" || cp -a "$SHARED/data.json" "$BACKUP_DIR/data-root.json"
test ! -f "$SHARED/storage/data.json" || cp -a "$SHARED/storage/data.json" "$BACKUP_DIR/data-storage.json"

install -d "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
ln -s "$SHARED/.env" "$RELEASE_DIR/.env"
ln -s "$SHARED/storage" "$RELEASE_DIR/storage"
ln -s "$SHARED/data.json" "$RELEASE_DIR/data.json"

id chatapp >/dev/null 2>&1 || useradd --system --home-dir "$SHARED" --shell /usr/sbin/nologin chatapp
chown root:chatapp "$SHARED"
chmod 750 "$SHARED"
chown chatapp:chatapp "$SHARED/.env"
chmod 600 "$SHARED/.env"
chown -R chatapp:chatapp "$SHARED/storage"
find "$SHARED/storage" -type d -exec chmod 750 {} +
find "$SHARED/storage" -type f -exec chmod 640 {} +
test ! -f "$SHARED/data.json" || chown chatapp:chatapp "$SHARED/data.json"
test ! -f "$SHARED/data.json" || chmod 640 "$SHARED/data.json"

cd "$RELEASE_DIR"
npm ci --omit=dev
test -s dist/index.html
node --check server.js

chown -R root:chatapp "$RELEASE_DIR"
find "$RELEASE_DIR" -type d -exec chmod 750 {} +
find "$RELEASE_DIR" -type f -exec chmod 640 {} +
install -o root -g root -m 644 deploy/server/hello-kitty-chat.service /etc/systemd/system/hello-kitty-chat.service
systemctl daemon-reload
runuser -u chatapp -- test -r "$SHARED/.env"
runuser -u chatapp -- test -w "$SHARED/storage"
```

真实管理员配置只编辑共享 `.env`。不要在终端输出文件内容：

```bash
editor /www/wwwroot/chat-app-shared/.env
chmod 600 /www/wwwroot/chat-app-shared/.env
```

至少确认已配置 `NODE_ENV=production`、`ADMIN_PHONE`、`ADMIN_BOOTSTRAP_PASSWORD`、`ADMIN_REAL_NAME`、`AUTH_COOKIE_SECURE=true`，以及实际启用的上游 Key。所有公网 `*_URL` 必须是可验证的 HTTPS 地址，否则新版本会在监听端口前拒绝启动。

### 3. 原子切换与守护进程

服务必须使用仓库内的 systemd 模板，以普通 `chatapp` 用户运行并只监听回环地址。完成上一步的权限、unit 安装和读取/写入检查后，再切换应用软链接并只重启唯一目标服务：

```bash
set -euo pipefail
RELEASE_DIR='/www/wwwroot/chat-app-releases/<release-id>'

ln -sfn "$RELEASE_DIR" /www/wwwroot/chat-app.next
mv -Tf /www/wwwroot/chat-app.next /www/wwwroot/chat-app
systemctl restart hello-kitty-chat.service
systemctl is-active --quiet hello-kitty-chat.service
curl --fail --silent http://127.0.0.1:3000/api/health
systemctl status hello-kitty-chat.service --no-pager
journalctl -u hello-kitty-chat.service -n 100 --no-pager
```

Nginx 已代理 `/api`、`/uploads`、`/videos` 和前端页面，正常发布不修改其配置。

### 4. 无付费冒烟检查

上线后至少验证：

- `/api/health` 返回 200。
- 游客 `/api/auth/me` 正常返回未登录状态。
- 游客普通聊天入口仍可用。
- 游客提交图片/视频任务返回 401，且没有调用上游。
- 管理员可以登录、查看普通账号，并分别开启和关闭图片、视频生成权限。
- 管理员可以按手机号和真实姓名辅助重置受控测试账号密码；重置后旧会话全部失效。
- 页面在 320×568、375×812 和桌面宽度下无横向滚动或遮挡。
- 日志无未处理 Promise rejection、持续 5xx 或启动迁移错误。

不要用真实付费生图或视频作为发布冒烟测试。

### 5. 回滚

代码回滚只需把软链接原子切回 `previous-release.txt` 记录的目录，并重启同一个服务：

```bash
set -euo pipefail
PREVIOUS_RELEASE="$(cat /www/wwwroot/chat-app-data-backups/pre-<release-id>/previous-release.txt)"
test -d "$PREVIOUS_RELEASE"
ln -sfn "$PREVIOUS_RELEASE" /www/wwwroot/chat-app.next
mv -Tf /www/wwwroot/chat-app.next /www/wwwroot/chat-app
systemctl restart hello-kitty-chat.service
curl --fail --silent http://127.0.0.1:3000/api/health
```

只有确认新版本的数据迁移本身有问题时，才在停止服务后恢复备份的数据文件；普通代码回滚不应覆盖用户在发布后新产生的聊天记录或媒体。

## 远端同步

远端仓库地址由 Git 的 `origin` 管理。提交前再次执行验证和密钥扫描，然后使用本机凭据管理器推送：

```powershell
git status --short
git push origin main
```

不要把个人令牌拼进远端 URL，也不要把令牌写入 Git 历史。

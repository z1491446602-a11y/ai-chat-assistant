# 聊天 AI

这是一个由 React/Vite 前端与 Node.js/Express 后端组成的纯 AI 助手。面向用户的功能只包括 AI 对话、会话管理、图片、视频、语音、文件以及 Markdown 内容展示；运行时数据保存在 `storage/`。

> 部署前必须轮换所有曾在聊天记录中暴露过的服务器凭据和仓库令牌。本文档只使用占位符，不记录、打印或传递真实凭据。

> Windows 上请从规范路径 `C:\Users\kaikai\Desktop\Project\聊天ai备份` 运行工具。`C:\Users\凯\Desktop\聊天ai备份` 不是本项目的实际路径，可能导致“目录名称无效”。

## 环境要求

- Node.js 22 LTS 与 npm。
- 可选：FFmpeg/`ffprobe`，用于视频与部分音频处理。
- 生产服务器：Debian/Ubuntu、Nginx、systemd、`rsync`，建议使用阿里云轻量应用服务器。

## 本地配置与运行

安装依赖并创建本地环境文件。示例文件只有占位值，真实密钥只写入本机 `.env`：

```powershell
Set-Location 'C:\Users\kaikai\Desktop\Project\聊天ai备份'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
Copy-Item .env.example .env
```

上传保护可通过 `.env` 调整：`UPLOAD_MAX_TOTAL_BYTES` 默认 `1073741824`（1 GiB 总空间），`UPLOAD_MAX_FILE_COUNT` 默认 `5000`，`UPLOAD_RATE_LIMIT_WINDOW_MS` 默认 `600000`（10 分钟窗口），`UPLOAD_RATE_LIMIT_MAX` 默认 `30`（每客户端每窗口最多 30 次）。四项配置都必须是无符号、无小数/指数写法的正十进制安全整数，无效配置会让服务启动失败；单文件大小仍由服务端 `MAX_UPLOAD_SIZE` 配置约束。

上传目录用量默认缓存 60 秒，成功写入后增量更新字节数和文件数；接近或超过任一配额时强制重扫后再决定，避免每次请求遍历目录，也限制小文件/inode 耗尽。参数/格式校验失败返回 400，聚合配额超限返回 413，非预期文件系统错误返回不暴露内部路径的通用 500。限流默认使用直连客户端地址，只有直连对端是 loopback 代理时才接受 `X-Forwarded-For` 覆盖，不能对公网直连请求无条件信任 XFF。

Linux/macOS：

```bash
cd /path/to/chat-app
npm ci
cp .env.example .env
```

开发时使用两个终端：

```bash
npm run server
```

```bash
npm run dev
```

浏览器访问 `http://localhost:3001`。常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run server` | 启动 Express 后端 |
| `npm run build` | TypeScript 检查并构建 `dist/` |
| `npm test -- --run` | 运行完整 Vitest 测试 |
| `npm run lint` | 运行 ESLint |

本地模拟生产运行：

```bash
npm ci
npm run build
npm run server
```

默认地址为 `http://127.0.0.1:3000`，健康检查为 `http://127.0.0.1:3000/api/health`。

### 依赖边界

本地测试、lint 和构建必须使用完整 `npm ci`。React、Zustand、Markdown/KaTeX/Mermaid、DOMPurify、图标与样式辅助库只在 Vite 构建时使用，归入 `devDependencies`；生产服务器运行预构建的 `dist/`，只通过 `npm ci --omit=dev` 安装 Express、中间件、HTTP 客户端和服务端文件解析依赖。未引用的 `pptxgenjs` 已移除，测试直接使用的 `@testing-library/dom` 已显式列为开发依赖。此次分类不改变直接或间接运行版本，也不改变对外行为。

## 架构摘要

- `src/`：AI 助手 UI、会话状态、API 客户端与按需加载的 Markdown/Mermaid 渲染器。
- `server.js`：Express 服务装配入口。
- `server/`：AI 路由、任务、供应商、存储、上传、媒体和静态交付策略。
- `storage/`：AI 会话及上传/生成文件等运行时数据，不属于发布包。
- `dist/`：Vite 生产构建，由后端提供静态访问。

主 AI 路径为 `POST /api/ai-task/chat` 提交任务、`GET /api/ai-task/:id` 轮询、Zustand 更新页面；旧的 `POST /api/chat` SSE 兼容接口仍保留。

## 阿里云轻量服务器部署

以下示例只使用 `<server-ip>`、`<domain>`、`<ssh-user>`、`<release-id>` 等占位符，不包含任何账号、密码或令牌。发布采用“本地构建、全新暂存验证、完整代码快照、受控停服、`rsync --delete`、启动验证”的顺序。

### 1. 本地构建与 allowlist 打包

在规范 Windows 路径构建。打包只接受明确列出的根文件/目录；除 `.env.example` 外，不使用任何 `.env*` glob，也不会包含当前输出的 `chat-app-release.tgz`。运行时媒体目录在打包前和归档创建后都会检查，禁止进入代码发布包。

```powershell
Set-Location 'C:\Users\kaikai\Desktop\Project\聊天ai备份'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
npm test -- --run
if ($LASTEXITCODE -ne 0) { throw '测试失败' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint 失败' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

$ReleaseAllowlist = @(
  '.editorconfig',
  '.env.example',
  '.gitignore',
  'README.md',
  'PROJECT_STRUCTURE.md',
  'package.json',
  'package-lock.json',
  'index.html',
  'server.js',
  'fileAttachmentTools.js',
  'start.bat',
  'eslint.config.js',
  'postcss.config.js',
  'tailwind.config.js',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vitest.config.ts',
  'src',
  'server',
  'tests',
  'scripts',
  'deploy',
  'docs',
  'public',
  'dist'
)
$RequiredReleaseItems = @(
  '.env.example', 'package.json', 'package-lock.json', 'index.html',
  'server.js', 'src', 'server', 'public', 'dist'
)
$MissingRequired = @($RequiredReleaseItems | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($MissingRequired.Count -gt 0) {
  throw "发布输入缺失: $($MissingRequired -join ', ')"
}
$ReleaseItems = @($ReleaseAllowlist | Where-Object { Test-Path -LiteralPath $_ })

function Assert-SafeReleasePaths([string[]] $Paths, [string] $Source) {
  foreach ($Path in $Paths) {
    $Normalized = (($Path -replace '\\', '/') -replace '^(\./)+', '')
    if ($Normalized -match '(^|/)\.env($|\.)' -and $Normalized -notmatch '(^|/)\.env\.example$') {
      throw "$Source 包含禁止的环境文件: $Normalized"
    }
    if ($Normalized -match '(^|/)(storage|\.deploy-certs|workspace-artifacts|artifacts|node_modules)(/|$)' -or
        $Normalized -match '(^|/)data\.json$' -or
        $Normalized -match '(^|/)(public/(audios|uploads)|dist/(audios|uploads|videos))(/|$)' -or
        $Normalized -match '\.(pem|key|crt|cer|pfx|p12)$') {
      throw "$Source 包含运行时数据、证书、依赖、产物或生成媒体: $Normalized"
    }
  }
}

$ProjectRoot = (Get-Location).Path
$ProjectRootPrefix = $ProjectRoot.TrimEnd('\') + '\'
$InputEntries = foreach ($ReleaseItem in $ReleaseItems) {
  $Item = Get-Item -LiteralPath $ReleaseItem
  if (-not $Item.FullName.StartsWith($ProjectRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "发布输入越出项目根目录: $($Item.FullName)"
  }
  $Item.FullName.Substring($ProjectRootPrefix.Length)
  if ($Item.PSIsContainer) {
    Get-ChildItem -LiteralPath $Item.FullName -Force -Recurse | ForEach-Object {
      $_.FullName.Substring($ProjectRootPrefix.Length)
    }
  }
}
Assert-SafeReleasePaths $InputEntries '发布输入'

Remove-Item -LiteralPath '.\chat-app-release.tgz' -Force -ErrorAction SilentlyContinue
tar -czf '.\chat-app-release.tgz' `
  --exclude='public/audios' `
  --exclude='public/uploads' `
  --exclude='dist/audios' `
  --exclude='dist/uploads' `
  --exclude='dist/videos' `
  $ReleaseItems
if ($LASTEXITCODE -ne 0) { throw '发布包创建失败' }
$ArchiveEntries = @(tar -tzf '.\chat-app-release.tgz')
if ($LASTEXITCODE -ne 0) { throw '发布包条目读取失败' }
Assert-SafeReleasePaths $ArchiveEntries '发布包'
scp '.\chat-app-release.tgz' '<ssh-user>@<server-ip>:/tmp/chat-app-release.tgz'
if ($LASTEXITCODE -ne 0) { throw '发布包上传失败' }
```

显式 allowlist 不含 `.env`、`.env.local`、`.env.*.local`、其他根环境文件、证书、`node_modules/`、`storage/`、根 `data.json`、`.deploy-certs/`、`workspace-artifacts/` 或其他 `artifacts/`。不要改回从 `.` 全量打包再补排除项。

### 2. 准备 Debian/Ubuntu 服务器与非 root 用户

```bash
sudo apt update
sudo apt install -y nginx ffmpeg rsync curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
id -u chatapp >/dev/null 2>&1 || sudo useradd --system --home-dir /www/wwwroot/chat-app --shell /usr/sbin/nologin chatapp
sudo install -d -o chatapp -g chatapp /www/wwwroot/chat-app
sudo install -d -o chatapp -g chatapp /www/wwwroot/chat-app/storage/uploads
sudo install -d -o chatapp -g chatapp /www/wwwroot/chat-app/storage/videos
sudo install -d -o chatapp -g chatapp /www/wwwroot/chat-app-releases
sudo install -d -m 700 -o chatapp -g chatapp /www/wwwroot/chat-app-data-backups
```

必须先创建 `chatapp` 并完成授权，再安装 systemd service。生产上游 URL 必须为 HTTPS，或指向已验证的本机/内网 TLS 终止代理。

### 3. 全新暂存、快照与受控停服部署

每次部署都清空并重建固定暂存目录。先在暂存目录安装锁文件确定的生产依赖；该步骤失败时线上服务尚未停止。将 `<deploy-id>` 替换为只含字母、数字和内部连字符的新版本标识（不能包含 `.`、`..`、斜杠，不能以连字符开头或结尾）；部署前线上状态保存为 `pre-<deploy-id>`。

依赖边界调整后的远端实测：release 总占用约从 350 MB 降至 152 MB，其中 `node_modules` 约从 343 MB 降至 145 MB。该数字会随 npm 平台包和文件系统计量方式略有变化，应以每次暂存安装后的实际值为准。

```bash
set -euo pipefail

APP='/www/wwwroot/chat-app'
STAGE='/tmp/chat-app-release'
UPLOAD_ARCHIVE='/tmp/chat-app-release.tgz'
ARCHIVE="$STAGE/chat-app-release.tgz"
RELEASE_ROOT='/www/wwwroot/chat-app-releases'
DEPLOY_ID='<deploy-id>'
PREVIOUS_SNAPSHOT_ID="pre-$DEPLOY_ID"
PREVIOUS_SNAPSHOT_DIR="$RELEASE_ROOT/$PREVIOUS_SNAPSHOT_ID"

if ! printf '%s\n' "$DEPLOY_ID" | grep -Eq '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'; then
  echo 'DEPLOY_ID 只能包含字母、数字和内部连字符' >&2
  exit 1
fi

sudo rm -rf "$STAGE"
sudo install -d -o chatapp -g chatapp "$STAGE"
sudo install -o chatapp -g chatapp -m 600 "$UPLOAD_ARCHIVE" "$ARCHIVE"

ARCHIVE_LIST="$(sudo -u chatapp tar -tzf "$ARCHIVE")"
ARCHIVE_LIST_NORMALIZED="$(printf '%s\n' "$ARCHIVE_LIST" | tr '\\' '/' | sed -E 's#^\./+##')"
if printf '%s\n' "$ARCHIVE_LIST_NORMALIZED" | grep -Ei '(^|/)\.env($|\.)' | grep -Eiv '(^|/)\.env\.example$'; then
  echo '发布包包含禁止的环境文件' >&2
  exit 1
fi
if printf '%s\n' "$ARCHIVE_LIST_NORMALIZED" | grep -Eqi '(^|/)(storage|\.deploy-certs|workspace-artifacts|artifacts|node_modules)(/|$)|(^|/)data\.json$|(^|/)(public/(audios|uploads)|dist/(audios|uploads|videos))(/|$)|\.(pem|key|crt|cer|pfx|p12)$'; then
  echo '发布包包含运行时、证书、依赖或生成媒体' >&2
  exit 1
fi

sudo -u chatapp tar -xzf "$ARCHIVE" -C "$STAGE"
sudo -u chatapp rm -f "$ARCHIVE"
sudo -u chatapp test -s "$STAGE/package-lock.json"
cd "$STAGE"
sudo -u chatapp -H npm ci --omit=dev
sudo -u chatapp test -d "$STAGE/node_modules"

if [ ! -e "$APP/.env" ]; then
  sudo install -o chatapp -g chatapp -m 600 "$STAGE/.env.example" "$APP/.env"
  echo "已创建 $APP/.env；先编辑真实配置，再重新执行本节" >&2
  exit 1
fi
sudo chown chatapp:chatapp "$APP/.env"
sudo chmod 600 "$APP/.env"
sudo test -s "$APP/.env"

if sudo grep -Eq '=replace-with-|^[A-Z0-9_]+_URL=https://[^[:space:]]*\.example\.com|^[A-Z0-9_]+_URL=http://' "$APP/.env"; then
  echo '必须替换所有 replace-with-*、*.example.com 和明文公网 HTTP 上游 URL' >&2
  exit 1
fi

if [ -f "$APP/package-lock.json" ]; then
  if [ -e "$PREVIOUS_SNAPSHOT_DIR" ]; then
    echo "部署前代码快照已存在: $PREVIOUS_SNAPSHOT_DIR" >&2
    exit 1
  fi
  sudo install -d -o chatapp -g chatapp "$PREVIOUS_SNAPSHOT_DIR"
  sudo -u chatapp rsync -a --delete \
    --include='/.env.example' \
    --exclude='/.env*' \
    --exclude='/storage/' \
    --exclude='/data.json' \
    --exclude='/public/audios/' \
    --exclude='/public/uploads/' \
    --exclude='/dist/audios/' \
    --exclude='/dist/uploads/' \
    --exclude='/dist/videos/' \
    --exclude='/.deploy-certs/' \
    --exclude='/workspace-artifacts/' \
    --exclude='/node_modules/' \
    "$APP/" "$PREVIOUS_SNAPSHOT_DIR/"
  sudo -u chatapp test -s "$PREVIOUS_SNAPSHOT_DIR/package-lock.json"
fi

if sudo systemctl is-active --quiet hello-kitty-chat; then
  sudo systemctl stop hello-kitty-chat
fi

sudo -u chatapp rsync -a --delete \
  --include='/.env.example' \
  --exclude='/.env*' \
  --exclude='/storage/' \
  --exclude='/data.json' \
  --exclude='/public/audios/' \
  --exclude='/public/uploads/' \
  --exclude='/.deploy-certs/' \
  --exclude='/workspace-artifacts/' \
  "$STAGE/" "$APP/"

sudo install -m 644 "$APP/deploy/server/hello-kitty-chat.service" /etc/systemd/system/hello-kitty-chat.service
sudo systemctl daemon-reload
sudo systemctl enable hello-kitty-chat
sudo systemctl start hello-kitty-chat
sudo systemctl status hello-kitty-chat --no-pager
curl --fail --show-error --silent http://127.0.0.1:3000/api/health
```

这不是零停机发布：服务只在暂存依赖安装、环境检查和部署前代码快照成功后停止。`pre-<deploy-id>` 目录保存的是此次部署前正在运行的状态，不是新版本内容；首次部署没有旧代码，因此没有 pre 快照。快照不含 `node_modules/`，回滚时按锁文件重装。首次运行因创建模板 `.env` 退出后，执行 `sudo editor /www/wwwroot/chat-app/.env`，完成配置再重跑本节。

### 4. systemd 守护与日志

systemd 是唯一的 Node 守护方式；不要同时使用 PM2 或后台 `nohup`。

```bash
sudo systemctl daemon-reload
sudo systemctl enable hello-kitty-chat
sudo systemctl start hello-kitty-chat
sudo systemctl restart hello-kitty-chat
sudo systemctl status hello-kitty-chat --no-pager
sudo journalctl -u hello-kitty-chat -n 200 --no-pager
sudo journalctl -u hello-kitty-chat -f
```

service 保留 `EnvironmentFile=-/www/wwwroot/chat-app/.env`，紧随其后的 `ExecStartPre=/usr/bin/test -s /www/wwwroot/chat-app/.env` 会让缺失或空 `.env` 启动失败。它以 `chatapp:chatapp` 运行；启动失败时检查 `.env` 内容/权限、目录所有权和 Node 路径。

### 5. 配置 Nginx

```bash
sudo cp /www/wwwroot/chat-app/deploy/server/nginx.conf /etc/nginx/sites-available/hello-kitty-chat.conf
sudo ln -sfn /etc/nginx/sites-available/hello-kitty-chat.conf /etc/nginx/sites-enabled/hello-kitty-chat.conf
sudo editor /etc/nginx/sites-available/hello-kitty-chat.conf
sudo nginx -t
sudo systemctl reload nginx
```

将 `server_name _;` 改为 `server_name <domain>;`；尚无域名时可临时使用 `<server-ip>`。安全组只开放实际需要的 80、443 与 SSH 端口，不直接暴露 3000。

### 6. 验证健康、缓存与 gzip

```bash
curl -i http://127.0.0.1:3000/api/health
curl -I http://<domain>/
find /www/wwwroot/chat-app/dist/assets -maxdepth 1 -type f -name 'index-*.js' -print
curl -sS -D - -o /dev/null -H 'Accept-Encoding: gzip' http://<domain>/assets/<hashed-index-file>.js
```

预期：健康接口返回 200；HTML 为 `no-store`；带哈希的 `/assets/*` 返回一年 `immutable`；可压缩文本响应包含 `Content-Encoding: gzip` 和 `Vary: Accept-Encoding`。非哈希资源不得使用 immutable。

### 7. HTTPS 与上游 TLS

使用标准证书工具，不要把私钥放入源码或发布包：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <domain>
sudo certbot renew --dry-run
curl -I https://<domain>/
```

部署前必须替换 `.env` 中所有 `replace-with-*` 和 `*.example.com`。未启用 provider 的 key/app id/secret 保持空值是合法状态，但对应功能不可用；至少为实际启用的聊天、图像、语音或视频 provider 配置 key，健康接口成功不代表这些上游功能可用。所有公网模型/图片/搜索上游必须使用 HTTPS；仅当 `http://127.0.0.1` 或受控内网地址前有经过验证的 TLS 终止代理时才允许例外。不要依赖 `server/config.js` 中为兼容保留的 HTTP 默认值，也不要静态强制唯一的 `CHAT_API_KEY`。

### 8. 从服务器代码快照回滚

将 `<snapshot-id>` 替换为严格格式的部署前快照名 `pre-<deploy-id>`，不要填写目标新版本 ID。`deploy-id` 只能包含字母、数字和内部连字符。回滚前先停止服务，把当前 `storage/` 和存在时的根 `data.json` 复制到权限受限、独立于代码快照的数据备份目录。代码恢复使用 `--delete`，但仍保护真实环境、运行数据、历史生成媒体和证书目录。

```bash
set -euo pipefail

APP='/www/wwwroot/chat-app'
RELEASE_ROOT='/www/wwwroot/chat-app-releases'
DATA_BACKUP_ROOT='/www/wwwroot/chat-app-data-backups'
ROLLBACK_SNAPSHOT_ID='<snapshot-id>'
ROLLBACK_SOURCE="$RELEASE_ROOT/$ROLLBACK_SNAPSHOT_ID"
DATA_BACKUP="$DATA_BACKUP_ROOT/pre-rollback-$ROLLBACK_SNAPSHOT_ID"

if ! printf '%s\n' "$ROLLBACK_SNAPSHOT_ID" | grep -Eq '^pre-[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'; then
  echo 'ROLLBACK_SNAPSHOT_ID 必须是 pre-<deploy-id>，且 deploy-id 只能包含字母、数字和内部连字符' >&2
  exit 1
fi
if [ -L "$RELEASE_ROOT" ] || [ -L "$ROLLBACK_SOURCE" ]; then
  echo '拒绝使用符号链接作为发布根或回滚源' >&2
  exit 1
fi
RELEASE_ROOT_REAL="$(realpath -e -- "$RELEASE_ROOT")"
ROLLBACK_SOURCE_REAL="$(realpath -e -- "$ROLLBACK_SOURCE")"
ROLLBACK_PARENT_REAL="$(dirname -- "$ROLLBACK_SOURCE_REAL")"
if [ "$ROLLBACK_PARENT_REAL" != "$RELEASE_ROOT_REAL" ]; then
  echo '回滚源不是 RELEASE_ROOT 的直接子目录' >&2
  exit 1
fi
case "$ROLLBACK_SOURCE_REAL" in
  "$RELEASE_ROOT_REAL"/*) ;;
  *) echo '回滚源解析后越出 RELEASE_ROOT' >&2; exit 1 ;;
esac
if find "$ROLLBACK_SOURCE_REAL" -type l -print -quit | grep -q .; then
  echo '回滚源目录树包含符号链接' >&2
  exit 1
fi
sudo test -s "$ROLLBACK_SOURCE_REAL/package-lock.json"
if [ -e "$DATA_BACKUP" ]; then
  echo "数据备份目录已存在: $DATA_BACKUP" >&2
  exit 1
fi

sudo systemctl stop hello-kitty-chat
sudo install -d -m 700 -o chatapp -g chatapp "$DATA_BACKUP"
if [ -d "$APP/storage" ]; then
  sudo -u chatapp mkdir -p "$DATA_BACKUP/storage"
  sudo -u chatapp rsync -a "$APP/storage/" "$DATA_BACKUP/storage/"
fi
if [ -f "$APP/data.json" ]; then
  sudo -u chatapp cp -a "$APP/data.json" "$DATA_BACKUP/data.json"
fi
sudo chmod -R go-rwx "$DATA_BACKUP"

sudo -u chatapp rsync -a --delete \
  --include='/.env.example' \
  --exclude='/.env*' \
  --exclude='/storage/' \
  --exclude='/data.json' \
  --exclude='/public/audios/' \
  --exclude='/public/uploads/' \
  --exclude='/.deploy-certs/' \
  --exclude='/workspace-artifacts/' \
  "$ROLLBACK_SOURCE_REAL/" "$APP/"

cd "$APP"
sudo -u chatapp -H npm ci --omit=dev
sudo install -m 644 "$APP/deploy/server/hello-kitty-chat.service" /etc/systemd/system/hello-kitty-chat.service
sudo systemctl daemon-reload
sudo systemctl start hello-kitty-chat
sudo systemctl status hello-kitty-chat --no-pager
curl --fail --show-error --silent http://127.0.0.1:3000/api/health
```

如果依赖安装或启动失败，保持服务停止，检查 `journalctl`，不要用数据备份覆盖仍可用的数据。数据备份仅用于独立恢复调查。

### 9. 从本地预优化快照重建回滚包

本地快照路径为 `workspace-artifacts/backups/pre-optimization-source-20260712-151051.zip`。本轮没有读取其内容，也没有 Git 历史可证明它不含秘密；不得直接上传 zip 或宣称快照已检查无密钥。先解压到当前工作区之外的独立目录，定位源码根，验证并按第 1 节同一 allowlist 重建发布包：

```powershell
$Snapshot = 'C:\Users\kaikai\Desktop\Project\聊天ai备份\workspace-artifacts\backups\pre-optimization-source-20260712-151051.zip'
$ExtractRoot = 'C:\Users\kaikai\Desktop\Project\chat-app-rollback-source-20260712-151051'
if (Test-Path -LiteralPath $ExtractRoot) { throw "独立解压目录已存在: $ExtractRoot" }
Expand-Archive -LiteralPath $Snapshot -DestinationPath $ExtractRoot
$CandidateRoots = @($ExtractRoot) + @(Get-ChildItem -LiteralPath $ExtractRoot -Directory | ForEach-Object FullName)
$SourceRoots = @($CandidateRoots | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'package.json') })
if ($SourceRoots.Count -ne 1) { throw '无法唯一定位快照源码根目录' }
Set-Location -LiteralPath $SourceRoots[0]

npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
npm test -- --run
if ($LASTEXITCODE -ne 0) { throw '测试失败' }
npm run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint 失败' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

$ReleaseAllowlist = @(
  '.editorconfig', '.env.example', '.gitignore', 'README.md', 'PROJECT_STRUCTURE.md',
  'package.json', 'package-lock.json', 'index.html', 'server.js',
  'fileAttachmentTools.js', 'start.bat', 'eslint.config.js',
  'postcss.config.js', 'tailwind.config.js', 'tsconfig.json', 'tsconfig.node.json',
  'vite.config.ts', 'vitest.config.ts', 'src', 'server', 'tests', 'scripts',
  'deploy', 'docs', 'public', 'dist'
)
$RequiredReleaseItems = @(
  '.env.example', 'package.json', 'package-lock.json', 'index.html',
  'server.js', 'src', 'server', 'public', 'dist'
)
$MissingRequired = @($RequiredReleaseItems | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($MissingRequired.Count -gt 0) { throw "回滚发布输入缺失: $($MissingRequired -join ', ')" }
$ReleaseItems = @($ReleaseAllowlist | Where-Object { Test-Path -LiteralPath $_ })

function Assert-SafeReleasePaths([string[]] $Paths, [string] $Source) {
  foreach ($Path in $Paths) {
    $Normalized = (($Path -replace '\\', '/') -replace '^(\./)+', '')
    if ($Normalized -match '(^|/)\.env($|\.)' -and $Normalized -notmatch '(^|/)\.env\.example$') {
      throw "$Source 包含禁止的环境文件: $Normalized"
    }
    if ($Normalized -match '(^|/)(storage|\.deploy-certs|workspace-artifacts|artifacts|node_modules)(/|$)' -or
        $Normalized -match '(^|/)data\.json$' -or
        $Normalized -match '(^|/)(public/(audios|uploads)|dist/(audios|uploads|videos))(/|$)' -or
        $Normalized -match '\.(pem|key|crt|cer|pfx|p12)$') {
      throw "$Source 包含运行时数据、证书、依赖、产物或生成媒体: $Normalized"
    }
  }
}

$ProjectRoot = (Get-Location).Path
$ProjectRootPrefix = $ProjectRoot.TrimEnd('\') + '\'
$InputEntries = foreach ($ReleaseItem in $ReleaseItems) {
  $Item = Get-Item -LiteralPath $ReleaseItem
  if (-not $Item.FullName.StartsWith($ProjectRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "回滚发布输入越出项目根目录: $($Item.FullName)"
  }
  $Item.FullName.Substring($ProjectRootPrefix.Length)
  if ($Item.PSIsContainer) {
    Get-ChildItem -LiteralPath $Item.FullName -Force -Recurse | ForEach-Object {
      $_.FullName.Substring($ProjectRootPrefix.Length)
    }
  }
}
Assert-SafeReleasePaths $InputEntries '回滚发布输入'

Remove-Item -LiteralPath '.\chat-app-release.tgz' -Force -ErrorAction SilentlyContinue
tar -czf '.\chat-app-release.tgz' `
  --exclude='public/audios' `
  --exclude='public/uploads' `
  --exclude='dist/audios' `
  --exclude='dist/uploads' `
  --exclude='dist/videos' `
  $ReleaseItems
if ($LASTEXITCODE -ne 0) { throw '回滚发布包创建失败' }
$ArchiveEntries = @(tar -tzf '.\chat-app-release.tgz')
if ($LASTEXITCODE -ne 0) { throw '回滚发布包条目读取失败' }
Assert-SafeReleasePaths $ArchiveEntries '回滚发布包'
```

人工检查 allowlist 中的一方文本和 `.env.example` 后，才上传新包，并完整执行第 3 节受控部署流程。allowlist 能阻止快照中的任意根 `.env*` 被打包，但不能证明其他被允许文件从未包含秘密。

无论发布还是回滚，都不得覆盖、删除、打包或打印服务器真实 `.env`、`storage/`、根 `data.json`、`public/audios/`、`public/uploads/` 与 `.deploy-certs/`。`dist/audios/`、`dist/uploads/`、`dist/videos/` 是禁止发布的陈旧副本，不作为运行数据保护，也不得进入发布包或代码快照。

## 审计与结构

完整现状、性能数据、风险与后续任务见 [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md)。核心目录速查见 [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md)。

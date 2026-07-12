# AI 聊天视频生成设计

## 1. 目标

在现有 AI 聊天中增加视频生成能力，支持：

- 文生视频。
- 使用一张或两张参考图进行图生视频。
- 后端异步提交、轮询、下载和验证视频。
- 生成过程中刷新浏览器仍可恢复状态。
- 服务器重启后可恢复已经取得上游任务 ID 的任务。
- 生成完成后把 MP4 永久保存到本机服务器。
- 在 AI 聊天消息内在线播放并下载视频。

该功能只出现在 AI 聊天中。普通好友聊天不显示入口，也不改动其数据和交互。

## 2. 非目标

- 不新增独立视频创作页面。
- 不向浏览器暴露视频服务 API Key。
- 不承诺两张参考图分别作为严格首帧和尾帧。
- 不伪造上游没有提供的百分比进度。
- 不提供上游不支持的真实取消功能。
- 首版不自动清理已生成视频；孤立文件清理可作为后续维护功能。
- 首版不引入 Redis、BullMQ 或独立任务进程。

## 3. 已验证的上游契约

服务地址：

    https://api.chancexj.com/v1/videos

鉴权：

    x-api-key: <VIDEO_API_KEY>

模型：

    veo_3_1_fast

验证结果：

- Authorization Bearer 不被视频路由识别，必须使用 x-api-key。
- veo-3.1 和 veo-3.1-fast 返回上游 502。
- veo_3_1_fast 能成功创建任务并返回 video.generation。
- 文生视频仅需 model + prompt。
- 单图请求使用 image.image_url。
- 双图请求使用 images[].image_url。
- 双图测试中两张参考图的视觉特征都进入了视频，但顺序和构图没有被严格保留。
- 任务通过 GET /v1/videos/{taskId} 查询。
- 完成响应包含 video_url。
- 已验证成品为有效 MP4；一次文生视频结果为 8 秒、1280x720、24 fps。

文生请求：

    {
      "model": "veo_3_1_fast",
      "prompt": "..."
    }

单图请求：

    {
      "model": "veo_3_1_fast",
      "prompt": "...",
      "image": {
        "image_url": "data:image/jpeg;base64,..."
      }
    }

双图请求：

    {
      "model": "veo_3_1_fast",
      "prompt": "...",
      "images": [
        { "image_url": "data:image/jpeg;base64,..." },
        { "image_url": "data:image/jpeg;base64,..." }
      ]
    }

## 4. 用户交互

### 4.1 入口

在现有 AI 聊天输入区的“更多”菜单中增加“生成视频”命令。入口使用现有 Lucide 图标体系中的视频图标。

普通好友聊天的“更多”菜单保持不变。

### 4.2 视频模式

进入视频模式后：

- 输入区上方显示“视频生成”模式标签。
- 没有参考图时显示“文生视频”。
- 有参考图时显示“图生视频 · 1 张参考图”或“图生视频 · 2 张参考图”。
- 支持关闭视频模式并回到普通 AI 聊天。
- 提示词始终必填。
- 可上传 PNG、JPEG 或 WebP。
- 上传前限制原始文件不超过 10 MB。
- 沿用现有图片压缩逻辑：最长边 1600px，JPEG 质量 0.82。
- 最多保留两张参考图；达到上限后禁用继续添加。
- 文案明确说明图片是视觉参考，不保证首尾帧顺序。

### 4.3 生成状态

消息显示真实阶段，而不是模拟百分比：

1. 正在提交。
2. 已排队。
3. 上游处理中。
4. 正在下载。
5. 正在验证并保存。
6. 已完成或失败。

处理中显示已等待时间，并提示用户可以离开页面。上游提交后不显示“取消”按钮，因为服务没有已验证的取消接口。

### 4.4 完成状态

完成消息包含：

- HTML5 视频播放器。
- 视频时长、分辨率和文件大小。
- 下载按钮。
- 服务器本地 URL，而不是上游临时 URL。

## 5. 前端设计

### 5.1 状态

在 FriendChat 的 AI 模式中增加：

- isVideoGenerationMode
- 最多两张 pendingAiVideoImages
- 视频任务阶段和等待时间展示

普通图片生成状态保持不变，视频模式与图片模式互斥。

### 5.2 API 客户端

新增：

    createServerAiVideoTask(owner, sessionId, prompt, images)

扩展 ServerAiTask：

    type: 'chat' | 'image' | 'video'
    videoStage?: 'submitting' | 'queued' | 'processing' | 'downloading' | 'validating'
    videoUrl?: string
    videoFileSize?: number
    videoDuration?: number
    videoWidth?: number
    videoHeight?: number

扩展聊天 Message：

    videoUrl?: string
    videoMimeType?: string
    videoFileName?: string
    videoFileSize?: number
    videoDuration?: number
    videoWidth?: number
    videoHeight?: number
    videoGenerationStage?: string

现有 AI 任务轮询继续复用 GET /api/ai-task/:taskId，但客户端必须同时传递当前 owner。后端比较任务的 ownerType 和 ownerId，所有者不匹配时返回 404，避免泄露任务是否存在。

## 6. 后端 API

新增：

    POST /api/ai-task/video

请求：

    {
      "userId": "...",
      "guestId": "...",
      "sessionId": "...",
      "prompt": "...",
      "images": ["data:image/jpeg;base64,..."]
    }

校验：

- 必须能解析到已知用户或访客所有者。
- prompt 去除空白后不能为空。
- images 必须是数组。
- 最多两张图片。
- 只接受有效的图片 data URL。
- 只接受 PNG、JPEG 和 WebP。

创建用户消息和助手占位消息，然后注册 type 为 video 的 AI 任务。

## 7. 上游适配器

新增独立模块负责：

- 根据 0、1、2 张图片构造不同请求体。
- 使用 x-api-key 提交任务。
- 验证创建响应包含任务 ID。
- 安全轮询状态。
- 返回完成后的上游视频 URL。

配置：

    VIDEO_API_URL=https://api.chancexj.com/v1/videos
    VIDEO_API_KEY=
    VIDEO_API_MODEL=veo_3_1_fast
    VIDEO_POLL_INTERVAL_MS=10000
    VIDEO_TIMEOUT_MS=600000
    VIDEO_MAX_BYTES=209715200
    VIDEO_DOWNLOAD_HOSTS=opcbucket.oss-cn-beijing.aliyuncs.com

真实密钥只写服务器 .env，不写入仓库、systemd 文件、聊天数据或浏览器响应。

## 8. 持久化任务

现有 aiTasks 仅存内存，不能满足服务器重启恢复。新增 videoJobs 到 storage/data.json：

    interface VideoJob {
      id: string
      ownerId: string
      ownerType: 'user' | 'guest'
      sessionId: string
      messageId: string
      userMessageId: string
      prompt: string
      upstreamTaskId?: string
      status: 'pending' | 'running' | 'completed' | 'failed'
      stage: 'submitting' | 'queued' | 'processing' | 'downloading' | 'validating'
      error?: string
      createdAt: number
      updatedAt: number
    }

规则：

- API Key 不持久化。
- 参考图只保留在已有用户消息中。任务通过 userMessageId 在恢复时重新读取，不在 videoJobs 中重复保存 Base64。
- 启动时若旧数据没有 videoJobs，自动初始化为空对象，不影响现有数据。
- 每次取得上游任务 ID、状态变化和下载阶段都立即保存。
- 完成后保留精简后的任务记录用于诊断。
- 服务器启动时扫描未完成任务。
- 已有 upstreamTaskId 的任务恢复轮询。
- 停留在 submitting 且没有上游 ID 的任务标记为“提交结果未知”，不自动重新提交，避免重复扣费。
- 恢复逻辑在开始接受 HTTP 请求前把未完成作业重新注册到内存任务表，保证旧 taskId 仍可查询。

## 9. 视频下载与存储

目录：

    storage/videos/

路由：

    GET /videos/:fileName

下载流程：

1. 只接受 HTTPS URL。
2. 主机必须在 VIDEO_DOWNLOAD_HOSTS 白名单。
3. 下载到随机文件名的 .part 临时文件。
4. 响应或累计字节超过 200 MB 时中止。
5. 验证文件至少包含有效 MP4 ftyp 签名。
6. 使用 ffprobe 读取时长、宽度、高度和帧率；读取失败时任务失败，不发布元数据不明的文件。
7. 原子重命名为 .mp4。
8. 更新聊天消息。

/videos 使用可流式读取的静态文件响应，保留 Range 请求能力，默认内联播放；下载按钮使用浏览器下载属性。

## 10. 错误处理与重试

### 10.1 创建任务

创建视频的 POST 不自动重试。网络断开时无法确定上游是否已创建任务，自动重试可能产生重复任务和重复费用。

### 10.2 状态轮询

- 网络错误、429 和临时 5xx 可以重试。
- 重试间隔逐步增加，最大 30 秒。
- 总等待上限 10 分钟。
- 达到上限后保留上游任务 ID，并把任务标记为超时，便于人工继续查询。

### 10.3 视频下载

- 下载最多重试三次。
- 下载失败不重新生成视频。
- 校验失败删除 .part 文件，不暴露损坏文件。

### 10.4 用户错误

错误消息应区分：

- 输入无效。
- 视频服务配置错误。
- 上游提交失败。
- 上游生成失败。
- 状态查询超时。
- 视频下载或校验失败。

错误消息不得包含 API Key 或完整上游响应中的敏感字段。

## 11. 测试设计

### 11.1 单元测试

- 0 张图构造文生视频请求。
- 1 张图构造 image.image_url。
- 2 张图构造 images[]。
- 3 张图被拒绝。
- 无提示词被拒绝。
- 错误模型名不会被使用。
- 状态映射覆盖 queued、processing、completed 和 failed。
- MP4 签名校验。
- ffprobe 元数据解析。
- 下载主机白名单。
- 200 MB 大小限制。

### 11.2 集成测试

使用本地模拟上游验证：

- 创建任务、轮询完成、下载、保存并更新消息。
- 轮询暂时失败后恢复。
- 下载失败只重试下载。
- 服务器重启后恢复已有上游任务 ID 的作业。
- 没有上游任务 ID 的提交中作业不会自动重复提交。
- 不同用户不能读取彼此的任务。

### 11.3 前端测试

- “生成视频”只出现在 AI 聊天的“更多”菜单。
- 视频模式和图片模式互斥。
- 最多两张参考图。
- 正确显示阶段、等待时间、错误状态和完成状态。
- 完成消息包含播放器和下载按钮。
- 移动端和桌面端不溢出。

### 11.4 真实验证

上线前：

- 文生视频一次。
- 双图视频一次。
- 验证下载文件的 MP4 签名、时长、分辨率和播放。

上线后：

- /api/health。
- AI 聊天入口可见。
- 创建一次实际视频任务。
- 刷新页面后任务状态可恢复。
- 完成视频能播放和下载。
- 服务器文件存在于 storage/videos。

## 12. 部署与回滚

服务器目录：

    /www/wwwroot/chat-app

部署步骤：

1. 备份当前应用文件、.env 和 storage/data.json。
2. 上传代码，不覆盖服务器 storage。
3. 在服务器 .env 增加视频配置。
4. 安装 ffmpeg，并确认 ffprobe 可执行。
5. 创建 storage/videos 并确认进程可写。
6. 安装依赖并执行构建、lint 和测试。
7. 重启 hello-kitty-chat.service。
8. 检查 systemd 日志和健康接口。
9. 执行生产冒烟测试。

回滚：

- 恢复上一版应用代码和前端构建。
- 保留新生成的视频与聊天数据。
- 重启服务并重新检查健康接口。

## 13. 验收标准

- 视频入口只存在于 AI 聊天。
- 文生视频成功。
- 单图视频成功。
- 双图视频成功。
- 第三张参考图不能添加。
- API Key 不出现在前端包、网络响应或持久化数据中。
- 任务刷新后可继续显示。
- 服务重启后可恢复已有上游任务 ID 的任务。
- 成品保存到本机服务器，并可在线播放和下载。
- 上游临时链接失效后，本地视频仍可访问。
- 旧聊天、图片生成、语音和普通好友聊天无回归。

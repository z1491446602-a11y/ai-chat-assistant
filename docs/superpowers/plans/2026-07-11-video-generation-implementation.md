# AI Chat Video Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 AI 聊天中增加可靠的文生视频和最多两张参考图的图生视频能力，并在本地真实验证后部署到生产服务器。

**Architecture:** 继续复用现有 `aiTasks` 异步任务和 `pendingTaskId` 轮询入口，同时增加只保存视频作业控制信息的 `videoJobs` 持久层。视频上游适配、文件下载校验、作业持久化分别放入独立模块；浏览器只调用本站 API，API Key 永远不进入前端、聊天数据或日志。

**Tech Stack:** Node.js 20、Express 4、React 18、TypeScript、Vite、Vitest、Testing Library、Undici、ffprobe、systemd、Nginx。

---

## 已确认约束

- 上游创建接口为 `POST https://api.chancexj.com/v1/videos`，查询接口为 `GET /v1/videos/{taskId}`。
- 鉴权只使用 `x-api-key`，模型只使用 `veo_3_1_fast`。
- 0 张图发送 `model + prompt`；1 张图发送 `image.image_url`；2 张图发送 `images[].image_url`。
- 视频入口只出现在 AI 聊天“更多”菜单；普通好友聊天不变。
- 提示词必填，参考图最多两张，单张原文件最大 10 MB，支持 PNG/JPEG/WebP。
- 两张图只是视觉参考，不承诺首尾帧和顺序。
- 只显示真实阶段和等待时间，不显示模拟百分比，不提供虚假取消按钮。
- 成品保存到 `storage/videos`，消息只引用本站 `/videos/<file>.mp4`。
- 已取得上游任务 ID 的作业可在服务重启后恢复；没有上游 ID 的 `submitting` 作业不得自动重提，避免重复扣费。
- 当前目录没有 `.git`，所以计划中的每个阶段以测试和备份检查点替代 Git 提交；上线前必须生成独立备份包。

## 文件结构

**新增后端文件**

- `server/videoProvider.js`：请求体构造、`x-api-key` 提交、状态解析、带退避的轮询。
- `server/videoFiles.js`：下载白名单、大小限制、MP4 签名、ffprobe、原子落盘。
- `server/videoJobs.js`：`data.videoJobs` 的创建、更新、精简和恢复列表。
- `tests/server/videoProvider.test.js`：上游契约单元测试。
- `tests/server/videoFiles.test.js`：下载与媒体校验单元测试。
- `tests/server/videoJobs.test.js`：持久化和恢复规则单元测试。
- `tests/server/videoRoutes.test.js`：输入校验、所有者隔离和任务创建集成测试。
- `scripts/video-smoke.mjs`：通过本站 API 执行文生视频/双图视频真实冒烟测试，不读取或输出 API Key。

**新增前端文件**

- `src/components/Social/videoGeneration.ts`：参考图限制、文件校验、阶段文案和时间格式化。
- `src/components/Social/videoGeneration.test.ts`：纯函数测试。
- `src/components/Chat/VideoMessage.tsx`：生成中状态和完成后的播放器/元数据/下载。
- `src/components/Chat/VideoMessage.test.tsx`：播放器与阶段 UI 测试。

**修改文件**

- `package.json`、`package-lock.json`、`vitest.config.ts`、`tsconfig.node.json`：测试运行器。
- `server/config.js`、`server/storage.js`、`server.js`：视频配置、目录、数据迁移、模块装配、恢复和静态路由。
- `server/aiSessions.js`、`server/aiTasks.js`、`server/aiRoutes.js`：视频消息字段、视频任务分支、创建路由、所有者校验。
- `src/types/chat.ts`、`src/services/api.ts`：视频字段、创建 API、带 owner 的任务查询。
- `src/components/Social/FriendChat.tsx`、`FriendChatComposer.tsx`、`FriendChatComposerAttachments.tsx`、`useFriendChatAiActions.ts`、`useFriendChatAiSync.ts`：视频模式、双图上传、提交和恢复轮询。
- `src/components/Chat/MessageBubble.tsx`：接入 `VideoMessage`。
- `.env.example`、`deploy/server/hello-kitty-chat.service`、`deploy/server/nginx.conf`、`deploy/server/DEPLOY_ALIYUN.md`：配置和部署。

### Task 1: 建立可重复测试基线

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Modify: `tsconfig.node.json`
- Modify: `eslint.config.js`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: 记录当前无测试脚本的失败基线**

Run: `npm test -- --run`

Expected: FAIL，输出 `Missing script: "test"`。

- [ ] **Step 2: 安装测试依赖**

Run:

```powershell
npm install --save-dev vitest jsdom @testing-library/react @testing-library/user-event
```

Expected: `package.json` 和 `package-lock.json` 更新，安装命令退出码为 0。

- [ ] **Step 3: 增加测试脚本和配置**

在 `package.json` 的 `scripts` 中加入：

```json
"test": "vitest run",
"test:watch": "vitest"
```

创建 `vitest.config.ts`：

```ts
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'src/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
  },
});
```

把 `tsconfig.node.json` 的 include 改为：

```json
"include": ["vite.config.ts", "vitest.config.ts"]
```

在 `eslint.config.js` 的 `nodeGlobals` 中加入：

```js
fetch: 'readonly',
queueMicrotask: 'readonly',
Response: 'readonly',
```

把 Node 文件 glob 改为：

```js
files: ['*.js', '*.mjs', 'server.js', 'fileAttachmentTools.js', 'server/**/*.js', 'tests/**/*.js', 'scripts/**/*.mjs'],
```

创建 `tests/smoke.test.js`：

```js
import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('runs under Node 20', () => {
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 4: 验证测试、构建和 lint 基线**

Run:

```powershell
npm test
npm run build
npm run lint
```

Expected: 三条命令均退出码 0；测试报告 `1 passed`。

### Task 2: 增加视频配置和兼容旧数据的 schema

**Files:**
- Create: `tests/server/videoConfig.test.js`
- Modify: `server/config.js`
- Modify: `server/storage.js`
- Modify: `server.js`
- Modify: `.env.example`

- [ ] **Step 1: 写配置和空数据的失败测试**

创建 `tests/server/videoConfig.test.js`：

```js
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerConfig } from '../../server/config.js';
import { createEmptyData } from '../../server/storage.js';

describe('video configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the verified video defaults', () => {
    const config = createServerConfig('C:/chat-app');
    expect(config.VIDEO_API_URL).toBe('https://api.chancexj.com/v1/videos');
    expect(config.VIDEO_API_MODEL).toBe('veo_3_1_fast');
    expect(config.VIDEO_DIR).toBe(path.join('C:/chat-app', 'storage', 'videos'));
    expect(config.VIDEO_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(config.VIDEO_DOWNLOAD_HOSTS).toEqual(new Set(['opcbucket.oss-cn-beijing.aliyuncs.com']));
  });

  it('starts old-compatible storage with an empty videoJobs object', () => {
    expect(createEmptyData().videoJobs).toEqual({});
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/server/videoConfig.test.js`

Expected: FAIL，缺少 `VIDEO_API_URL` 或 `videoJobs`。

- [ ] **Step 3: 增加配置值**

在 `createServerConfig` 中定义：

```js
const videoDownloadHosts = new Set(
  String(process.env.VIDEO_DOWNLOAD_HOSTS || 'opcbucket.oss-cn-beijing.aliyuncs.com')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean),
);
```

在返回对象中加入：

```js
VIDEO_DIR: process.env.VIDEO_DIR || path.join(storageDir, 'videos'),
VIDEO_API_URL: process.env.VIDEO_API_URL || 'https://api.chancexj.com/v1/videos',
VIDEO_API_KEY: process.env.VIDEO_API_KEY || '',
VIDEO_API_MODEL: process.env.VIDEO_API_MODEL || 'veo_3_1_fast',
VIDEO_POLL_INTERVAL_MS: Number(process.env.VIDEO_POLL_INTERVAL_MS || 10_000),
VIDEO_TIMEOUT_MS: Number(process.env.VIDEO_TIMEOUT_MS || 600_000),
VIDEO_MAX_BYTES: Number(process.env.VIDEO_MAX_BYTES || 200 * 1024 * 1024),
VIDEO_DOWNLOAD_HOSTS: videoDownloadHosts,
FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe',
```

在 `createEmptyData()` 中加入 `videoJobs: {}`。在 `migrateData()` 中加入：

```js
if (!data.videoJobs || typeof data.videoJobs !== 'object' || Array.isArray(data.videoJobs)) {
  data.videoJobs = {};
}
```

在 `.env.example` 增加：

```dotenv
# Upstream video generation; keep VIDEO_API_KEY on the server only
VIDEO_API_URL=https://api.chancexj.com/v1/videos
VIDEO_API_KEY=replace-with-your-video-api-key
VIDEO_API_MODEL=veo_3_1_fast
VIDEO_POLL_INTERVAL_MS=10000
VIDEO_TIMEOUT_MS=600000
VIDEO_MAX_BYTES=209715200
VIDEO_DOWNLOAD_HOSTS=opcbucket.oss-cn-beijing.aliyuncs.com
FFPROBE_PATH=ffprobe
```

- [ ] **Step 4: 运行测试**

Run: `npm test -- tests/server/videoConfig.test.js`

Expected: PASS，2 tests passed。

### Task 3: 实现经过契约测试的视频上游适配器

**Files:**
- Create: `server/videoProvider.js`
- Create: `tests/server/videoProvider.test.js`

- [ ] **Step 1: 写 0/1/2/3 图请求体和状态映射测试**

创建测试，固定验证以下断言：

```js
import { describe, expect, it, vi } from 'vitest';
import {
  buildVideoRequestBody,
  createVideoProvider,
  parseVideoStatus,
} from '../../server/videoProvider.js';

const imageA = 'data:image/jpeg;base64,YQ==';
const imageB = 'data:image/png;base64,Yg==';

describe('buildVideoRequestBody', () => {
  it('builds text-to-video payload', () => {
    expect(buildVideoRequestBody({ model: 'veo_3_1_fast', prompt: '海边日落', images: [] }))
      .toEqual({ model: 'veo_3_1_fast', prompt: '海边日落' });
  });

  it('builds the verified one-image payload', () => {
    expect(buildVideoRequestBody({ model: 'veo_3_1_fast', prompt: '镜头前推', images: [imageA] }))
      .toEqual({ model: 'veo_3_1_fast', prompt: '镜头前推', image: { image_url: imageA } });
  });

  it('builds the verified two-image payload', () => {
    expect(buildVideoRequestBody({ model: 'veo_3_1_fast', prompt: '融合场景', images: [imageA, imageB] }))
      .toEqual({
        model: 'veo_3_1_fast',
        prompt: '融合场景',
        images: [{ image_url: imageA }, { image_url: imageB }],
      });
  });

  it('rejects missing prompts and a third image', () => {
    expect(() => buildVideoRequestBody({ model: 'veo_3_1_fast', prompt: ' ', images: [] })).toThrow('提示词不能为空');
    expect(() => buildVideoRequestBody({ model: 'veo_3_1_fast', prompt: 'test', images: [imageA, imageB, imageA] })).toThrow('最多上传 2 张参考图');
  });
});

describe('parseVideoStatus', () => {
  it.each([
    [{ status: 'queued' }, 'queued'],
    [{ status: 'processing' }, 'processing'],
    [{ status: 'completed', video_url: 'https://example.test/video.mp4' }, 'completed'],
    [{ status: 'failed', error: { message: 'failed' } }, 'failed'],
  ])('maps $status', (payload, expected) => {
    expect(parseVideoStatus({ id: 'video_1', object: 'video.generation', ...payload }).status).toBe(expected);
  });
});

describe('createVideoProvider', () => {
  it('uses x-api-key and never Bearer auth', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'video_1', object: 'video.generation', status: 'queued',
    }), { status: 200 }));
    const provider = createVideoProvider({
      fetchImpl,
      apiUrl: 'https://api.chancexj.com/v1/videos',
      apiKey: 'server-secret',
      model: 'veo_3_1_fast',
      pollIntervalMs: 1,
      timeoutMs: 100,
      sleep: vi.fn(),
    });

    await provider.submit({ prompt: 'test', images: [] });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'server-secret',
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/server/videoProvider.test.js`

Expected: FAIL，`server/videoProvider.js` 不存在。

- [ ] **Step 3: 实现适配器公开接口**

`server/videoProvider.js` 必须导出并实现以下稳定接口：

```js
import { getResponseErrorMessage } from './upstreamErrors.js';

const COMPLETED_STATUSES = new Set(['completed']);
const FAILED_STATUSES = new Set(['failed']);
const QUEUED_STATUSES = new Set(['queued']);
const PROCESSING_STATUSES = new Set(['processing']);

export function buildVideoRequestBody({ model, prompt, images = [] }) {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) throw new Error('提示词不能为空');
  if (!Array.isArray(images)) throw new Error('参考图格式不正确');
  if (images.length > 2) throw new Error('最多上传 2 张参考图');

  const body = { model: String(model || '').trim(), prompt: normalizedPrompt };
  if (images.length === 1) body.image = { image_url: images[0] };
  if (images.length === 2) body.images = images.map(imageUrl => ({ image_url: imageUrl }));
  return body;
}

export function parseVideoStatus(payload) {
  const id = String(payload?.id || '').trim();
  const status = String(payload?.status || '').trim().toLowerCase();
  const videoUrl = String(payload?.video_url || '').trim();
  const error = String(payload?.error?.message || payload?.error || payload?.message || '').trim();

  if (!id) throw new Error('视频服务未返回任务 ID');
  if (COMPLETED_STATUSES.has(status)) {
    if (!videoUrl) throw new Error('视频任务已完成但未返回下载地址');
    return { id, status: 'completed', videoUrl, error: '' };
  }
  if (FAILED_STATUSES.has(status)) return { id, status: 'failed', videoUrl: '', error: error || '上游视频生成失败' };
  if (QUEUED_STATUSES.has(status)) return { id, status: 'queued', videoUrl: '', error: '' };
  if (PROCESSING_STATUSES.has(status)) return { id, status: 'processing', videoUrl: '', error: '' };
  throw new Error(`视频服务返回未知状态: ${status || 'empty'}`);
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createVideoProvider({
  fetchImpl,
  apiUrl,
  apiKey,
  model,
  pollIntervalMs,
  timeoutMs,
  sleep = defaultSleep,
}) {
  const baseUrl = String(apiUrl || '').replace(/\/+$/, '');
  const headers = () => ({ 'Content-Type': 'application/json', 'x-api-key': apiKey });

  function assertConfigured() {
    if (!baseUrl || !apiKey || model !== 'veo_3_1_fast') {
      throw new Error('视频服务配置不正确');
    }
  }

  async function submit({ prompt, images }) {
    assertConfigured();
    const response = await fetchImpl(baseUrl, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildVideoRequestBody({ model, prompt, images })),
    });
    if (!response.ok) throw new Error(await getResponseErrorMessage(response, '视频任务提交失败'));
    return parseVideoStatus(await response.json());
  }

  async function poll(taskId, onStatus) {
    assertConfigured();
    const startedAt = Date.now();
    let retryCount = 0;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await fetchImpl(`${baseUrl}/${encodeURIComponent(taskId)}`, {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });
        if (response.status === 429 || response.status >= 500) throw new Error(`retryable:${response.status}`);
        if (!response.ok) throw new Error(await getResponseErrorMessage(response, '视频状态查询失败'));
        const result = parseVideoStatus(await response.json());
        retryCount = 0;
        if (result.status === 'completed') return result.videoUrl;
        if (result.status === 'failed') throw new Error(result.error);
        onStatus?.(result.status);
        await sleep(pollIntervalMs);
      } catch (error) {
        const errorMessage = String(error?.message || '');
        const retryable = errorMessage.startsWith('retryable:')
          || /fetch failed|networkerror|econnreset|etimedout|socket/i.test(errorMessage);
        if (!retryable) throw error;
        retryCount += 1;
        await sleep(Math.min(30_000, pollIntervalMs * (2 ** retryCount)));
      }
    }
    throw new Error('视频状态查询超时');
  }

  return { submit, poll };
}
```

在同一测试文件补充：

```js
it('does not retry an ambiguous create failure', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
  const provider = createVideoProvider({
    fetchImpl,
    apiUrl: 'https://api.chancexj.com/v1/videos',
    apiKey: 'server-secret',
    model: 'veo_3_1_fast',
    pollIntervalMs: 1,
    timeoutMs: 100,
    sleep: vi.fn(),
  });
  await expect(provider.submit({ prompt: 'test', images: [] })).rejects.toThrow('fetch failed');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each([429, 502])('retries polling after HTTP %s', async (statusCode) => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: statusCode }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'video_1',
      object: 'video.generation',
      status: 'completed',
      video_url: 'https://example.test/video.mp4',
    }), { status: 200 }));
  const sleep = vi.fn();
  const provider = createVideoProvider({
    fetchImpl,
    apiUrl: 'https://api.chancexj.com/v1/videos',
    apiKey: 'server-secret',
    model: 'veo_3_1_fast',
    pollIntervalMs: 1,
    timeoutMs: 100,
    sleep,
  });
  await expect(provider.poll('video_1')).resolves.toBe('https://example.test/video.mp4');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
});

it('retries a polling network failure but not a create failure', async () => {
  const fetchImpl = vi.fn()
    .mockRejectedValueOnce(new Error('fetch failed'))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'video_1',
      object: 'video.generation',
      status: 'completed',
      video_url: 'https://example.test/video.mp4',
    }), { status: 200 }));
  const provider = createVideoProvider({
    fetchImpl,
    apiUrl: 'https://api.chancexj.com/v1/videos',
    apiKey: 'server-secret',
    model: 'veo_3_1_fast',
    pollIntervalMs: 1,
    timeoutMs: 100,
    sleep: vi.fn(),
  });
  await expect(provider.poll('video_1')).resolves.toBe('https://example.test/video.mp4');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('fails polling at the configured timeout', async () => {
  const provider = createVideoProvider({
    fetchImpl: vi.fn(),
    apiUrl: 'https://api.chancexj.com/v1/videos',
    apiKey: 'server-secret',
    model: 'veo_3_1_fast',
    pollIntervalMs: 1,
    timeoutMs: 0,
    sleep: vi.fn(),
  });
  await expect(provider.poll('video_1')).rejects.toThrow('视频状态查询超时');
});
```

- [ ] **Step 4: 运行适配器测试**

Run: `npm test -- tests/server/videoProvider.test.js`

Expected: PASS，所有 payload、鉴权、状态和退避测试通过。

### Task 4: 安全下载、验证并保存 MP4

**Files:**
- Create: `server/videoFiles.js`
- Create: `tests/server/videoFiles.test.js`

- [ ] **Step 1: 写安全边界失败测试**

测试必须覆盖：

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertAllowedVideoUrl,
  createVideoFileStore,
  hasMp4FtypSignature,
  parseFfprobeMetadata,
} from '../../server/videoFiles.js';

describe('video file safety', () => {
  const hosts = new Set(['opcbucket.oss-cn-beijing.aliyuncs.com']);

  it('allows only HTTPS and an exact configured host', () => {
    expect(assertAllowedVideoUrl('https://opcbucket.oss-cn-beijing.aliyuncs.com/a.mp4', hosts).hostname)
      .toBe('opcbucket.oss-cn-beijing.aliyuncs.com');
    expect(() => assertAllowedVideoUrl('http://opcbucket.oss-cn-beijing.aliyuncs.com/a.mp4', hosts)).toThrow('HTTPS');
    expect(() => assertAllowedVideoUrl('https://evil.example/a.mp4', hosts)).toThrow('白名单');
  });

  it('requires an MP4 ftyp box', () => {
    expect(hasMp4FtypSignature(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]))).toBe(true);
    expect(hasMp4FtypSignature(Buffer.from('not-an-mp4'))).toBe(false);
  });

  it('parses duration and dimensions from ffprobe JSON', () => {
    expect(parseFfprobeMetadata(JSON.stringify({
      streams: [{ width: 1280, height: 720, r_frame_rate: '24/1' }],
      format: { duration: '8.000000' },
    }))).toEqual({ duration: 8, width: 1280, height: 720, fps: 24 });
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/server/videoFiles.test.js`

Expected: FAIL，`server/videoFiles.js` 不存在。

- [ ] **Step 3: 实现文件存储接口**

创建 `server/videoFiles.js`，完整实现如下：

```js
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ensureDir } from './storage.js';

export function assertAllowedVideoUrl(videoUrl, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(String(videoUrl || ''));
  } catch {
    throw new Error('视频下载地址无效');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('视频下载地址必须使用 HTTPS');
  }
  if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('视频下载主机不在白名单');
  }
  return parsed;
}

export function hasMp4FtypSignature(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 8
    && buffer.toString('ascii', 4, 8) === 'ftyp';
}

function parseFrameRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

export function parseFfprobeMetadata(stdout) {
  const payload = JSON.parse(String(stdout || '{}'));
  const stream = Array.isArray(payload.streams) ? payload.streams[0] : null;
  const duration = Number(payload?.format?.duration);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const fps = parseFrameRate(stream?.r_frame_rate);
  if (!(duration > 0) || !(width > 0) || !(height > 0)) {
    throw new Error('ffprobe 未返回有效视频元数据');
  }
  return {
    duration: Number(duration.toFixed(2)),
    width,
    height,
    fps: Number(fps.toFixed(3)),
  };
}

function isRetryableDownloadError(error) {
  return Boolean(error?.retryable)
    || /fetch failed|networkerror|econnreset|etimedout|socket/i.test(String(error?.message || ''));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createVideoFileStore({
  fetchImpl,
  videoDir,
  maxBytes,
  allowedHosts,
  ffprobePath,
  spawnImpl = spawn,
  sleep = wait,
}) {
  function ensureVideoDir() {
    ensureDir(videoDir);
  }

  function getPaths(jobId) {
    const safeJobId = String(jobId || '').replace(/[^\w-]/g, '_');
    if (!safeJobId) throw new Error('视频任务 ID 无效');
    const finalFileName = safeJobId + '.mp4';
    return {
      finalFileName,
      finalPath: path.join(videoDir, finalFileName),
      partPath: path.join(
        videoDir,
        finalFileName + '.' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + '.part',
      ),
    };
  }

  async function runFfprobe(filePath) {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'format=duration:stream=width,height,r_frame_rate',
      '-of', 'json',
      filePath,
    ];
    const child = spawnImpl(ffprobePath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    const [exitCode] = await once(child, 'close');
    if (exitCode !== 0) {
      throw new Error('ffprobe 校验失败' + (stderr.trim() ? ': ' + stderr.trim().slice(0, 200) : ''));
    }
    return parseFfprobeMetadata(stdout);
  }

  async function inspectFile(filePath, finalFileName) {
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const header = Buffer.alloc(8);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead < 8 || !hasMp4FtypSignature(header)) {
        throw new Error('下载结果不是有效 MP4');
      }
    } finally {
      await handle.close();
    }
    const metadata = await runFfprobe(filePath);
    const stat = await fs.promises.stat(filePath);
    return {
      videoUrl: '/videos/' + finalFileName,
      videoMimeType: 'video/mp4',
      videoFileName: finalFileName,
      videoFileSize: stat.size,
      videoDuration: metadata.duration,
      videoWidth: metadata.width,
      videoHeight: metadata.height,
    };
  }

  async function inspectExistingVideo(jobId) {
    ensureVideoDir();
    const { finalFileName, finalPath } = getPaths(jobId);
    if (!fs.existsSync(finalPath)) return null;
    try {
      return await inspectFile(finalPath, finalFileName);
    } catch {
      await fs.promises.rm(finalPath, { force: true });
      return null;
    }
  }

  async function writeResponseBody(response, partPath) {
    const declaredBytes = Number(response.headers.get('content-length') || 0);
    if (declaredBytes > maxBytes) throw new Error('视频文件超过大小限制');
    if (!response.body) throw new Error('视频下载响应为空');

    const output = fs.createWriteStream(partPath, { flags: 'wx' });
    let totalBytes = 0;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) {
          await response.body.cancel?.();
          throw new Error('视频文件超过大小限制');
        }
        if (!output.write(buffer)) await once(output, 'drain');
      }
      output.end();
      await once(output, 'finish');
    } catch (error) {
      output.destroy();
      throw error;
    }
  }

  async function downloadOnce(parsedUrl, partPath) {
    const response = await fetchImpl(parsedUrl, { method: 'GET', redirect: 'error' });
    if (response.status === 429 || response.status >= 500) {
      const error = new Error('视频下载暂时失败');
      error.retryable = true;
      throw error;
    }
    if (!response.ok) throw new Error('视频下载失败: HTTP ' + response.status);
    await writeResponseBody(response, partPath);
  }

  async function downloadValidateAndSave({ jobId, videoUrl, onStage }) {
    ensureVideoDir();
    const existing = await inspectExistingVideo(jobId);
    if (existing) return existing;
    const parsedUrl = assertAllowedVideoUrl(videoUrl, allowedHosts);
    const { finalFileName, finalPath, partPath } = getPaths(jobId);
    onStage?.('downloading');

    try {
      let completed = false;
      for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
        try {
          await downloadOnce(parsedUrl, partPath);
          completed = true;
        } catch (error) {
          await fs.promises.rm(partPath, { force: true });
          if (attempt === 3 || !isRetryableDownloadError(error)) throw error;
          await sleep(attempt * 1_000);
        }
      }

      onStage?.('validating');
      const result = await inspectFile(partPath, finalFileName);
      await fs.promises.rename(partPath, finalPath);
      return result;
    } catch (error) {
      await fs.promises.rm(partPath, { force: true });
      throw error;
    }
  }

  return { ensureVideoDir, inspectExistingVideo, downloadValidateAndSave };
}
```

这段实现先验证 HTTPS 和精确主机白名单，流式限制字节数，仅重试下载，并在 ffprobe 通过后原子发布确定性文件名。

- [ ] **Step 4: 增加下载集成测试并运行**

在同一测试文件加入：

```js
const tempDirs = [];
const validMp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
const metadataJson = JSON.stringify({
  streams: [{ width: 1280, height: 720, r_frame_rate: '24/1' }],
  format: { duration: '8' },
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function createSpawnImpl({ stdout = metadataJson, stderr = '', exitCode = 0 } = {}) {
  return vi.fn(() => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.emit('close', exitCode);
    });
    return child;
  });
}

async function createStore({
  fetchImpl,
  maxBytes = 200 * 1024 * 1024,
  spawnImpl = createSpawnImpl(),
  sleep = vi.fn(),
}) {
  const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-files-'));
  tempDirs.push(videoDir);
  return {
    videoDir,
    store: createVideoFileStore({
      fetchImpl,
      videoDir,
      maxBytes,
      allowedHosts: new Set(['opcbucket.oss-cn-beijing.aliyuncs.com']),
      ffprobePath: 'ffprobe',
      spawnImpl,
      sleep,
    }),
  };
}

it('publishes a validated MP4 atomically', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(validMp4, { status: 200 }));
  const { store, videoDir } = await createStore({ fetchImpl });
  const stages = [];
  const result = await store.downloadValidateAndSave({
    jobId: 'ai_task_1',
    videoUrl: 'https://opcbucket.oss-cn-beijing.aliyuncs.com/a.mp4',
    onStage: stage => stages.push(stage),
  });
  expect(result).toMatchObject({
    videoUrl: '/videos/ai_task_1.mp4',
    videoFileSize: validMp4.length,
    videoDuration: 8,
    videoWidth: 1280,
    videoHeight: 720,
  });
  expect(stages).toEqual(['downloading', 'validating']);
  expect(await fs.readdir(videoDir)).toEqual(['ai_task_1.mp4']);
});

it('deletes the part file when bytes exceed the configured limit', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(validMp4, { status: 200 }));
  const { store, videoDir } = await createStore({ fetchImpl, maxBytes: 7 });
  await expect(store.downloadValidateAndSave({
    jobId: 'too_large',
    videoUrl: 'https://opcbucket.oss-cn-beijing.aliyuncs.com/a.mp4',
  })).rejects.toThrow('大小限制');
  expect(await fs.readdir(videoDir)).toEqual([]);
});

it('does not publish a bad signature or failed ffprobe result', async () => {
  const badFetch = vi.fn().mockResolvedValue(new Response(Buffer.from('not-an-mp4'), { status: 200 }));
  const first = await createStore({ fetchImpl: badFetch });
  await expect(first.store.downloadValidateAndSave({
    jobId: 'bad_signature',
    videoUrl: 'https://opcbucket.oss-cn-beijing.aliyuncs.com/a.mp4',
  })).rejects.toThrow('有效 MP4');
  expect(await fs.readdir(first.videoDir)).toEqual([]);

  const failedProbe = createSpawnImpl({ stderr: 'invalid data', exitCode: 1 });
  const second = await createStore({
    fetchImpl: vi.fn().mockResolvedValue(new Response(validMp4, { status: 200 })),
    spawnImpl: failedProbe,
  });
  await expect(second.store.downloadValidateAndSave({
    jobId: 'bad_probe',
    videoUrl: 'https://opcbucket.oss-cn-beijing.aliyuncs.com/a.mp4',
  })).rejects.toThrow('ffprobe 校验失败');
  expect(await fs.readdir(second.videoDir)).toEqual([]);
});

it('retries only the download after a temporary 5xx', async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 502 }))
    .mockResolvedValueOnce(new Response(validMp4, { status: 200 }));
  const sleep = vi.fn();
  const { store } = await createStore({ fetchImpl, sleep });
  await expect(store.downloadValidateAndSave({
    jobId: 'retry_download',
    videoUrl: 'https://opcbucket.oss-cn-beijing.aliyuncs.com/a.mp4',
  })).resolves.toMatchObject({ videoFileName: 'retry_download.mp4' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
});
```

Run: `npm test -- tests/server/videoFiles.test.js`

Expected: PASS，且测试临时目录中没有残留 `.part`。

### Task 5: 持久化 videoJobs 并实现重启恢复规则

**Files:**
- Create: `server/videoJobs.js`
- Create: `tests/server/videoJobs.test.js`

- [ ] **Step 1: 写持久化和恢复失败测试**

创建 `tests/server/videoJobs.test.js`：

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoJobStore } from '../../server/videoJobs.js';

const baseJob = {
  id: 'ai_task_1',
  ownerId: 'user_1',
  ownerType: 'user',
  sessionId: 'session_1',
  messageId: 'assistant_1',
  userMessageId: 'user_message_1',
  prompt: '海边慢镜头',
  status: 'pending',
  stage: 'submitting',
  createdAt: 100,
  updatedAt: 100,
};

let data;
let saveData;
let store;

beforeEach(() => {
  data = { videoJobs: {} };
  saveData = vi.fn();
  store = createVideoJobStore({ data, saveData });
});

describe('video job persistence', () => {
  it('persists each change without keys or duplicated Base64 images', () => {
    store.createVideoJob({
      ...baseJob,
      apiKey: 'must-not-persist',
      images: ['data:image/jpeg;base64,YQ=='],
    });
    store.patchVideoJob(baseJob.id, {
      upstreamTaskId: 'video_1',
      status: 'running',
      stage: 'queued',
    });
    expect(saveData).toHaveBeenCalledTimes(2);
    expect(store.getVideoJob(baseJob.id)).toMatchObject({
      upstreamTaskId: 'video_1',
      status: 'running',
      stage: 'queued',
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('must-not-persist');
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('images');
  });

  it('separates recoverable, unknown, and terminal jobs', () => {
    store.createVideoJob({ ...baseJob, id: 'with_upstream', upstreamTaskId: 'video_1', status: 'running' });
    store.createVideoJob({ ...baseJob, id: 'without_upstream', status: 'pending' });
    store.createVideoJob({ ...baseJob, id: 'completed', upstreamTaskId: 'video_2', status: 'completed' });
    const plan = store.getRecoveryPlan();
    expect(plan.recoverable.map(job => job.id)).toEqual(['with_upstream']);
    expect(plan.unknownSubmission.map(job => job.id)).toEqual(['without_upstream']);
    expect(data.videoJobs.completed.status).toBe('completed');
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/server/videoJobs.test.js`

Expected: FAIL，`server/videoJobs.js` 不存在。

- [ ] **Step 3: 实现持久作业存储**

创建 `server/videoJobs.js`：

```js
const VIDEO_JOB_FIELDS = new Set([
  'id', 'ownerId', 'ownerType', 'sessionId', 'messageId', 'userMessageId',
  'prompt', 'upstreamTaskId', 'status', 'stage', 'error', 'createdAt', 'updatedAt',
]);
const VIDEO_JOB_STATUSES = new Set(['pending', 'running', 'completed', 'failed']);
const VIDEO_JOB_STAGES = new Set(['submitting', 'queued', 'processing', 'downloading', 'validating']);

function sanitizeVideoJob(input) {
  const picked = {};
  for (const field of VIDEO_JOB_FIELDS) {
    if (input[field] !== undefined) picked[field] = input[field];
  }

  const now = Date.now();
  const job = {
    id: String(picked.id || '').trim(),
    ownerId: String(picked.ownerId || '').trim(),
    ownerType: picked.ownerType === 'guest' ? 'guest' : 'user',
    sessionId: String(picked.sessionId || '').trim(),
    messageId: String(picked.messageId || '').trim(),
    userMessageId: String(picked.userMessageId || '').trim(),
    prompt: String(picked.prompt || '').trim(),
    status: VIDEO_JOB_STATUSES.has(picked.status) ? picked.status : 'pending',
    stage: VIDEO_JOB_STAGES.has(picked.stage) ? picked.stage : 'submitting',
    createdAt: Number(picked.createdAt) || now,
    updatedAt: Number(picked.updatedAt) || now,
  };
  const upstreamTaskId = String(picked.upstreamTaskId || '').trim();
  const error = String(picked.error || '').trim();
  if (upstreamTaskId) job.upstreamTaskId = upstreamTaskId;
  if (error) job.error = error;

  if (!job.id || !job.ownerId || !job.sessionId || !job.messageId || !job.userMessageId || !job.prompt) {
    throw new Error('视频作业字段不完整');
  }
  return job;
}

export function createVideoJobStore({ data, saveData }) {
  function ensureBucket() {
    if (!data.videoJobs || typeof data.videoJobs !== 'object' || Array.isArray(data.videoJobs)) {
      data.videoJobs = {};
    }
    return data.videoJobs;
  }

  function createVideoJob(input) {
    const bucket = ensureBucket();
    const job = sanitizeVideoJob(input);
    if (bucket[job.id]) throw new Error('视频作业已存在');
    bucket[job.id] = job;
    saveData(data);
    return job;
  }

  function getVideoJob(jobId) {
    const job = ensureBucket()[String(jobId || '').trim()];
    return job ? sanitizeVideoJob(job) : null;
  }

  function patchVideoJob(jobId, patch) {
    const bucket = ensureBucket();
    const id = String(jobId || '').trim();
    if (!bucket[id]) throw new Error('视频作业不存在');
    const job = sanitizeVideoJob({
      ...bucket[id],
      ...patch,
      id,
      updatedAt: Number(patch.updatedAt) || Date.now(),
    });
    bucket[id] = job;
    saveData(data);
    return job;
  }

  function getRecoveryPlan() {
    const jobs = Object.values(ensureBucket()).map(sanitizeVideoJob);
    const incomplete = jobs.filter(job => !['completed', 'failed'].includes(job.status));
    return {
      recoverable: incomplete.filter(job => Boolean(job.upstreamTaskId)),
      unknownSubmission: incomplete.filter(job => !job.upstreamTaskId),
    };
  }

  return { createVideoJob, getVideoJob, patchVideoJob, getRecoveryPlan };
}
```

白名单字段使 `apiKey` 和 `images` 即使误传入也不会落盘；所有写操作同步调用现有原子 `saveData(data)`。

- [ ] **Step 4: 运行持久化测试**

Run: `npm test -- tests/server/videoJobs.test.js`

Expected: PASS，并确认序列化对象中搜索不到 `data:image`、`apiKey` 或密钥值。

### Task 6: 接入 AI 任务流、路由和所有者隔离

**Files:**
- Modify: `server/aiSessions.js`
- Modify: `server/aiTasks.js`
- Modify: `server/aiRoutes.js`
- Modify: `server.js`
- Create: `tests/server/videoRoutes.test.js`

- [ ] **Step 1: 写路由输入和权限失败测试**

测试通过临时 Express server 调用 `registerAiRoutes`，覆盖：

- 空 prompt 返回 400。
- `images` 不是数组返回 400。
- 第三张图返回 400。
- 非 `data:image/png|jpeg|webp;base64,` 返回 400。
- 路由不读取客户端 `apiKey`。
- 成功时依次创建用户消息、助手占位消息、持久 job、内存 task。
- `GET /api/ai-task/:taskId?userId=user_1` 只允许匹配 owner；其他用户和错误 guest 均返回相同 404。
- `POST /api/ai-task/:taskId/cancel` 对 video task 不执行 abort，返回 409 `视频任务提交后不能取消`。

创建 `tests/server/videoRoutes.test.js`：

```js
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAiRoutes } from '../../server/aiRoutes.js';

const runningServers = [];
const image = 'data:image/jpeg;base64,YQ==';

function ownerKey(ownerRef) {
  return ownerRef.userId || 'guest:' + ownerRef.guestId;
}

async function createHarness() {
  const tasks = new Map();
  const sessions = new Map();
  const persistedJobs = [];
  let id = 0;
  const generateEntityId = prefix => prefix + '_' + (++id);

  function resolveAiOwnerFromInput(input) {
    const userId = String(input?.userId || '').trim();
    if (userId) {
      return { ownerRef: { userId }, ownerId: userId, ownerType: 'user', user: { id: userId } };
    }
    const guestId = String(input?.guestId || '').trim();
    if (guestId) {
      return { ownerRef: { guestId }, ownerId: guestId, ownerType: 'guest', user: null };
    }
    return { error: '缺少用户或访客标识' };
  }

  function findAiSession(ownerRef, sessionId) {
    return sessions.get(ownerKey(ownerRef) + ':' + String(sessionId || '')) || null;
  }

  function upsertAiSession(ownerRef, session) {
    sessions.set(ownerKey(ownerRef) + ':' + session.id, session);
    return session;
  }

  function createAiSession(ownerRef, overrides = {}) {
    const session = {
      id: generateEntityId('session'),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
    return upsertAiSession(ownerRef, session);
  }

  function appendAiMessage(ownerRef, sessionId, patch) {
    const session = findAiSession(ownerRef, sessionId);
    const message = { id: generateEntityId('message'), timestamp: Date.now(), ...patch };
    session.messages.push(message);
    upsertAiSession(ownerRef, session);
    return message;
  }

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  const runAiTask = vi.fn();
  registerAiRoutes(app, {
    resolveAiOwnerFromInput,
    getAiSessions: () => [],
    createAiSession,
    findAiSession,
    upsertAiSession,
    appendAiMessage,
    getAiTask: taskId => tasks.get(taskId) || null,
    registerAiTask: task => {
      tasks.set(task.id, task);
      return task;
    },
    serializeAiTask: task => ({ ...task, images: undefined }),
    runAiTask,
    removeAiSession: vi.fn(),
    removeAllAiSessions: vi.fn(),
    generateEntityId,
    normalizeChatModel: value => value,
    isKittyVoiceModel: () => false,
    DEFAULT_CHAT_MODEL: 'deepseek-v4',
    DEFAULT_CHAT_API_KEY: '',
    DEFAULT_ENABLE_WEB_SEARCH: false,
    VOICE_STREAMING_TEXT: '正在说话中...',
    DEFAULT_IMAGE_MODEL: 'gpt-image-2',
    VIDEO_API_MODEL: 'veo_3_1_fast',
    videoJobStore: {
      createVideoJob: task => {
        persistedJobs.push({ ...task });
        return task;
      },
    },
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  runningServers.push(server);
  const address = server.address();
  return {
    baseUrl: 'http://127.0.0.1:' + address.port,
    tasks,
    sessions,
    persistedJobs,
    runAiTask,
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

describe('POST /api/ai-task/video', () => {
  it.each([
    [{ userId: 'user_1', prompt: '', images: [] }, '视频提示词不能为空'],
    [{ userId: 'user_1', prompt: 'test', images: null }, '参考图必须是数组'],
    [{ userId: 'user_1', prompt: 'test', images: [image, image, image] }, '最多上传 2 张参考图'],
    [{ userId: 'user_1', prompt: 'test', images: ['data:image/gif;base64,YQ=='] }, 'PNG、JPEG 或 WebP'],
  ])('rejects invalid input', async (body, expectedError) => {
    const { baseUrl } = await createHarness();
    const { response, payload } = await postJson(baseUrl + '/api/ai-task/video', body);
    expect(response.status).toBe(400);
    expect(payload.error).toContain(expectedError);
  });

  it('creates messages, a durable job, and an in-memory task without the client key', async () => {
    const harness = await createHarness();
    const { response, payload } = await postJson(harness.baseUrl + '/api/ai-task/video', {
      userId: 'user_1',
      prompt: '镜头缓慢向前',
      images: [image],
      apiKey: 'must-not-be-used',
    });
    expect(response.status).toBe(200);
    expect(payload.task.type).toBe('video');
    expect(payload.task.apiKey).toBeUndefined();
    expect(harness.persistedJobs).toHaveLength(1);
    expect(harness.persistedJobs[0].apiKey).toBeUndefined();
    expect([...harness.sessions.values()][0].messages).toHaveLength(2);
    expect(harness.tasks.get(payload.task.id).ownerId).toBe('user_1');
  });
});

describe('AI task ownership', () => {
  it('returns the same 404 for another user or guest and refuses video cancellation', async () => {
    const harness = await createHarness();
    const created = await postJson(harness.baseUrl + '/api/ai-task/video', {
      userId: 'user_1',
      prompt: 'test',
      images: [],
    });
    const taskId = created.payload.task.id;

    const own = await fetch(harness.baseUrl + '/api/ai-task/' + taskId + '?userId=user_1');
    const other = await fetch(harness.baseUrl + '/api/ai-task/' + taskId + '?userId=user_2');
    const guest = await fetch(harness.baseUrl + '/api/ai-task/' + taskId + '?guestId=guest_1');
    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
    expect(guest.status).toBe(404);
    expect(await other.json()).toEqual({ error: '任务不存在' });
    expect(await guest.json()).toEqual({ error: '任务不存在' });

    const cancel = await fetch(harness.baseUrl + '/api/ai-task/' + taskId + '/cancel?userId=user_1', {
      method: 'POST',
    });
    expect(cancel.status).toBe(409);
    expect((await cancel.json()).error).toBe('视频任务提交后不能取消');
  });
});
```

- [ ] **Step 2: 扩展消息清洗字段**

在 `sanitizeAiMessage()` 中加入：

```js
videoUrl: typeof message.videoUrl === 'string' && message.videoUrl.trim() ? message.videoUrl.trim() : undefined,
videoMimeType: typeof message.videoMimeType === 'string' && message.videoMimeType.trim() ? message.videoMimeType.trim() : undefined,
videoFileName: typeof message.videoFileName === 'string' && message.videoFileName.trim() ? message.videoFileName.trim() : undefined,
videoFileSize: Number(message.videoFileSize) > 0 ? Number(message.videoFileSize) : undefined,
videoDuration: Number(message.videoDuration) > 0 ? Number(message.videoDuration) : undefined,
videoWidth: Number(message.videoWidth) > 0 ? Number(message.videoWidth) : undefined,
videoHeight: Number(message.videoHeight) > 0 ? Number(message.videoHeight) : undefined,
videoGenerationStage: ['submitting', 'queued', 'processing', 'downloading', 'validating'].includes(message.videoGenerationStage)
  ? message.videoGenerationStage
  : undefined,
```

修改 `markInterruptedStreamingMessages`：恢复流程会在 HTTP 监听前先注册有效视频任务；如果此处仍遇到带 `videoGenerationStage` 且没有内存任务的消息，说明持久作业缺失或损坏，应清除阶段并写成 `视频任务状态丢失，请联系管理员核查。`，不能长期保留为 streaming。

- [ ] **Step 3: 扩展 AI task 序列化和 video 分支**

`serializeAiTask()` 增加：

```js
videoStage: task.videoStage,
videoUrl: task.videoUrl,
videoMimeType: task.videoMimeType,
videoFileName: task.videoFileName,
videoFileSize: task.videoFileSize,
videoDuration: task.videoDuration,
videoWidth: task.videoWidth,
videoHeight: task.videoHeight,
```

在 `createAiTaskStore` 内加入两个完整 helper：

```js
const VIDEO_STAGE_CONTENT = {
  submitting: '正在提交视频任务...',
  queued: '视频任务已排队...',
  processing: '视频正在生成中...',
  downloading: '正在下载视频...',
  validating: '正在验证并保存视频...',
};

function updateVideoStage(task, stage) {
  if (!VIDEO_STAGE_CONTENT[stage]) throw new Error('视频任务阶段无效');
  task.videoStage = stage;
  task.partialContent = VIDEO_STAGE_CONTENT[stage];
  task.updatedAt = Date.now();
  videoJobStore.patchVideoJob(task.id, {
    stage,
    status: 'running',
    upstreamTaskId: task.upstreamTaskId,
  });
  patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
    content: task.partialContent,
    videoGenerationStage: stage,
    status: 'streaming',
  });
}

function completeVideoTask(task, video) {
  Object.assign(task, video);
  task.partialContent = '视频生成完成';
  task.videoStage = undefined;
  task.updatedAt = Date.now();
  patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
    content: '视频生成完成',
    ...video,
    videoGenerationStage: undefined,
    status: 'sent',
  });
  videoJobStore.patchVideoJob(task.id, {
    status: 'completed',
    stage: 'validating',
    error: '',
  });
}

function getVideoFailureText(task, error) {
  if (String(error?.message || '') === '视频状态查询超时') return '视频状态查询超时，请联系管理员继续核查。';
  if (task.videoStage === 'submitting') return '视频任务提交失败，请稍后重试。';
  if (task.videoStage === 'queued' || task.videoStage === 'processing') return '上游视频生成失败，请稍后重试。';
  if (task.videoStage === 'downloading') return '视频下载失败，请稍后重试。';
  if (task.videoStage === 'validating') return '视频校验或保存失败，请稍后重试。';
  return '视频生成失败，请稍后重试。';
}
```

`runAiTask()` 的 video 分支按以下顺序执行：

```js
videoJobStore.patchVideoJob(task.id, {
  status: 'running',
  stage: task.videoStage || 'submitting',
  upstreamTaskId: task.upstreamTaskId,
});
const existingVideo = await videoFileStore.inspectExistingVideo(task.id);
if (existingVideo) {
  completeVideoTask(task, existingVideo);
} else {
  let upstreamTaskId = task.upstreamTaskId;
  if (!upstreamTaskId) {
    const submitted = await videoProvider.submit({ prompt: task.prompt, images: task.images });
    upstreamTaskId = submitted.id;
    task.upstreamTaskId = upstreamTaskId;
    updateVideoStage(task, submitted.status === 'processing' ? 'processing' : 'queued');
  }
  const upstreamVideoUrl = await videoProvider.poll(upstreamTaskId, stage => updateVideoStage(task, stage));
  const video = await videoFileStore.downloadValidateAndSave({
    jobId: task.id,
    videoUrl: upstreamVideoUrl,
    onStage: stage => updateVideoStage(task, stage),
  });
  completeVideoTask(task, video);
}
```

在现有 catch 的最前面处理 video，避免把原始上游响应写给用户：

```js
if (task.type === 'video') {
  const failedStage = task.videoStage || 'submitting';
  const publicError = getVideoFailureText(task, error);
  task.status = 'failed';
  task.error = publicError;
  task.videoStage = undefined;
  task.updatedAt = Date.now();
  videoJobStore.patchVideoJob(task.id, {
    status: 'failed',
    stage: failedStage,
    error: publicError,
    upstreamTaskId: task.upstreamTaskId,
  });
  patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
    content: publicError,
    videoGenerationStage: undefined,
    status: 'error',
  });
} else {
  const isAbort = error instanceof Error && error.name === 'AbortError';
  task.status = isAbort ? 'cancelled' : 'failed';
  task.error = error instanceof Error ? error.message : '任务失败';
  task.updatedAt = Date.now();
  patchAiMessage(getTaskOwnerRef(task), task.sessionId, task.messageId, {
    content: isAbort
      ? (task.type === 'image' ? '已停止生成。' : '已停止回答。')
      : `错误: ${task.error}`,
    status: isAbort ? 'sent' : 'error',
  });
}
```

- [ ] **Step 4: 新增视频创建路由**

先在 `registerAiRoutes` 闭包内加入完整校验和会话 helper：

```js
const VIDEO_IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
const VIDEO_REFERENCE_MAX_BYTES = 10 * 1024 * 1024;

function validateVideoReferenceImages(input) {
  if (!Array.isArray(input)) throw new Error('参考图必须是数组');
  if (input.length > 2) throw new Error('最多上传 2 张参考图');
  return input.map((item) => {
    const source = String(item || '').trim();
    const match = source.match(VIDEO_IMAGE_DATA_URL);
    if (!match) throw new Error('参考图只支持 PNG、JPEG 或 WebP data URL');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) throw new Error('参考图内容为空');
    if (buffer.length > VIDEO_REFERENCE_MAX_BYTES) throw new Error('单张参考图不能超过 10 MB');
    return source;
  });
}

function resolveOrCreateVideoSession(ownerLookup, requestedSessionId) {
  let session = findAiSession(ownerLookup.ownerRef, requestedSessionId);
  if (!session) {
    session = createAiSession(ownerLookup.ownerRef, {
      model: VIDEO_API_MODEL,
      ownerId: ownerLookup.ownerId,
      ownerType: ownerLookup.ownerType,
    });
  } else if (session.model !== VIDEO_API_MODEL) {
    session.model = VIDEO_API_MODEL;
    upsertAiSession(ownerLookup.ownerRef, session);
  }
  return session;
}

function setSessionPendingTask(ownerRef, sessionId, taskId) {
  const session = findAiSession(ownerRef, sessionId);
  if (!session) throw new Error('AI 会话不存在');
  session.pendingTaskId = taskId;
  upsertAiSession(ownerRef, session);
}

function getOwnedTask(req) {
  const ownerLookup = resolveAiOwnerFromInput(req.query, { requireKnownUser: true });
  if (ownerLookup.error) return null;
  const task = getAiTask(req.params.taskId);
  if (!task || task.ownerId !== ownerLookup.ownerId || task.ownerType !== ownerLookup.ownerType) return null;
  return task;
}
```

路由成功创建的 task/job 使用同一个 `id`：

```js
app.post('/api/ai-task/video', (req, res) => {
  const ownerLookup = resolveAiOwnerFromInput(req.body, { requireKnownUser: true });
  if (ownerLookup.error) return res.status(req.body.guestId ? 400 : 404).json({ error: ownerLookup.error });

  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: '视频提示词不能为空' });
  let images;
  try {
    images = validateVideoReferenceImages(req.body.images);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : '参考图格式不正确' });
  }

  const now = Date.now();
  const taskId = generateEntityId('ai_task');
  const session = resolveOrCreateVideoSession(ownerLookup, req.body.sessionId);
  const userMessage = appendAiMessage(ownerLookup.ownerRef, session.id, {
    role: 'user', content: prompt, images: images.length ? images : undefined, status: 'sent',
  });
  const assistantMessage = appendAiMessage(ownerLookup.ownerRef, session.id, {
    role: 'assistant', content: '正在提交视频任务...', videoGenerationStage: 'submitting', status: 'streaming',
  });
  const task = {
    id: taskId,
    userId: ownerLookup.ownerType === 'user' ? ownerLookup.ownerId : '',
    ownerId: ownerLookup.ownerId,
    ownerType: ownerLookup.ownerType,
    sessionId: session.id,
    messageId: assistantMessage.id,
    userMessageId: userMessage.id,
    type: 'video',
    status: 'pending',
    error: '',
    prompt,
    images,
    videoStage: 'submitting',
    createdAt: now,
    updatedAt: now,
  };
  videoJobStore.createVideoJob(task);
  registerAiTask(task);
  setSessionPendingTask(ownerLookup.ownerRef, session.id, task.id);
  setTimeout(() => void runAiTask(task.id), 0);
  return res.json({ task: serializeAiTask(task), sessionId: session.id, messageId: assistantMessage.id });
});
```

把通用查询和取消路由改为 owner 隔离：

```js
app.get('/api/ai-task/:taskId', (req, res) => {
  const task = getOwnedTask(req);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  return res.json({ task: serializeAiTask(task) });
});

app.post('/api/ai-task/:taskId/cancel', (req, res) => {
  const task = getOwnedTask(req);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (task.type === 'video') return res.status(409).json({ error: '视频任务提交后不能取消' });
  if (['completed', 'failed', 'cancelled'].includes(task.status)) {
    return res.json({ task: serializeAiTask(task) });
  }
  task.status = 'cancelled';
  task.updatedAt = Date.now();
  task.abortController?.abort();
  return res.json({ task: serializeAiTask(task) });
});
```

- [ ] **Step 5: 装配模块并在监听前恢复**

`server.js` 中按顺序：

1. 从 config 解构视频配置。
2. 创建 `videoProvider`、`videoFileStore`、`videoJobStore`。
3. 把它们注入 `createAiTaskStore` 和 `registerAiRoutes`。
4. `migrateData(); saveData(data);` 后调用 `resumeVideoJobs()`。
5. 最后才执行 `server.listen()`。

`createAiTaskStore` 返回的 `resumeVideoJobs` 完整逻辑：

```js
function resumeVideoJobs() {
  const { recoverable, unknownSubmission } = videoJobStore.getRecoveryPlan();
  const failRecovery = (job, content) => {
    const ownerRef = job.ownerType === 'guest' ? { guestId: job.ownerId } : { userId: job.ownerId };
    videoJobStore.patchVideoJob(job.id, { status: 'failed', error: content });
    patchAiMessage(ownerRef, job.sessionId, job.messageId, {
      content,
      videoGenerationStage: undefined,
      status: 'error',
    });
    clearAiSessionTask(ownerRef, job.sessionId);
  };

  for (const job of unknownSubmission) {
    failRecovery(job, '提交结果未知，为避免重复扣费未自动重试。');
  }

  for (const job of recoverable) {
    const ownerRef = job.ownerType === 'guest' ? { guestId: job.ownerId } : { userId: job.ownerId };
    const session = findAiSession(ownerRef, job.sessionId);
    const userMessage = session?.messages?.find(message => String(message.id) === job.userMessageId);
    if (!session || !userMessage) {
      failRecovery(job, '视频任务恢复失败：原始消息不存在。');
      continue;
    }
    const task = {
      ...job,
      userId: job.ownerType === 'user' ? job.ownerId : '',
      type: 'video',
      status: 'pending',
      error: '',
      images: Array.isArray(userMessage.images) ? userMessage.images : [],
      videoStage: job.stage,
      createdAt: job.createdAt,
      updatedAt: Date.now(),
    };
    registerAiTask(task);
    session.pendingTaskId = task.id;
    upsertAiSession(ownerRef, session);
    setTimeout(() => void runAiTask(task.id), 0);
  }
}
```

`runAiTask` 首先调用 `inspectExistingVideo(job.id)`，因此确定性最终 MP4 存在时会本地复检并直接完成，不再依赖可能已过期的上游 URL。

增加静态视频路由：

```js
app.use('/videos', express.static(VIDEO_DIR, {
  setHeaders: (res) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));
```

- [ ] **Step 6: 运行后端测试**

Run:

```powershell
npm test -- tests/server
npm run lint
```

Expected: PASS；跨用户读取返回 404；重启恢复测试证明带 ID 作业只发 GET，不发第二次 POST。

### Task 7: 扩展前端类型、API 和 owner 安全查询

**Files:**
- Modify: `src/types/chat.ts`
- Modify: `src/services/api.ts`
- Modify: `src/components/Social/useFriendChatAiSync.ts`

- [ ] **Step 1: 扩展共享类型**

在 `Message` 中加入：

```ts
videoUrl?: string;
videoMimeType?: string;
videoFileName?: string;
videoFileSize?: number;
videoDuration?: number;
videoWidth?: number;
videoHeight?: number;
videoGenerationStage?: VideoGenerationStage;
```

新增：

```ts
export type VideoGenerationStage = 'submitting' | 'queued' | 'processing' | 'downloading' | 'validating';
```

把 `ServerAiTask.type` 改为 `'chat' | 'image' | 'video'`，并加入相同 `video*` 字段。

- [ ] **Step 2: 新增创建 API，任务查询必须带 owner**

加入：

```ts
export async function createServerAiVideoTask(
  owner: string | AiTaskOwner,
  sessionId: string | null | undefined,
  prompt: string,
  images: string[],
): Promise<{ task: ServerAiTask; sessionId: string; messageId: string }> {
  const response = await fetch('/api/ai-task/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...normalizeAiTaskOwner(owner), sessionId, prompt, images }),
  });
  const result = await response.json();
  if (!response.ok || !result?.task) throw new Error(result.error || '提交视频生成任务失败');
  return result;
}
```

创建 owner query：

```ts
function getAiTaskOwnerQuery(owner: AiTaskOwner): string {
  const params = new URLSearchParams();
  if (owner.userId) params.set('userId', owner.userId);
  if (owner.guestId) params.set('guestId', owner.guestId);
  return params.toString();
}
```

签名改为：

```ts
fetchServerAiTask(taskId: string, owner: AiTaskOwner): Promise<ServerAiTask>
cancelServerAiTask(taskId: string, owner: AiTaskOwner): Promise<ServerAiTask>
```

`useFriendChatAiSync` 的 poll/cancel 都传闭包中的 `aiOwner`。收到视频字段时一次性 patch 消息；视频任务不调用 cancel API。

- [ ] **Step 3: TypeScript 验证**

Run: `npm run build`

Expected: PASS；所有旧调用点都已传 owner，没有隐式 `any` 或漏字段。

### Task 8: 实现 AI 聊天中的视频模式和最多两张参考图

**Files:**
- Create: `src/components/Social/videoGeneration.ts`
- Create: `src/components/Social/videoGeneration.test.ts`
- Modify: `src/components/Social/FriendChat.tsx`
- Modify: `src/components/Social/FriendChatComposer.tsx`
- Modify: `src/components/Social/FriendChatComposerAttachments.tsx`
- Modify: `src/components/Social/useFriendChatAiActions.ts`

- [ ] **Step 1: 写参考图和阶段文案失败测试**

```ts
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  VIDEO_MAX_REFERENCE_IMAGES,
  getVideoStageLabel,
  validateVideoReferenceFiles,
} from './videoGeneration';

describe('video generation helpers', () => {
  it('accepts at most two supported images under 10 MB', () => {
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.webp', { type: 'image/webp' }),
    ];
    expect(VIDEO_MAX_REFERENCE_IMAGES).toBe(2);
    expect(validateVideoReferenceFiles(files, 0)).toEqual(files);
    expect(() => validateVideoReferenceFiles([...files, files[0]], 0)).toThrow('最多上传 2 张参考图');
  });

  it('rejects GIF and files over 10 MB', () => {
    expect(() => validateVideoReferenceFiles([new File(['x'], 'x.gif', { type: 'image/gif' })], 0)).toThrow('PNG、JPEG 或 WebP');
    const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' });
    expect(() => validateVideoReferenceFiles([large], 0)).toThrow('10 MB');
  });

  it('maps only real stages', () => {
    expect(getVideoStageLabel('submitting')).toBe('正在提交');
    expect(getVideoStageLabel('queued')).toBe('已排队');
    expect(getVideoStageLabel('processing')).toBe('上游处理中');
    expect(getVideoStageLabel('downloading')).toBe('正在下载');
    expect(getVideoStageLabel('validating')).toBe('正在验证并保存');
  });
});
```

- [ ] **Step 2: 实现 helper 并运行测试**

`videoGeneration.ts` 完整实现：

```ts
import type { VideoGenerationStage } from '@/types';

export const VIDEO_MAX_REFERENCE_IMAGES = 2;
export const VIDEO_MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
const VIDEO_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function validateVideoReferenceFiles(files: File[], existingCount: number): File[] {
  if (existingCount + files.length > VIDEO_MAX_REFERENCE_IMAGES) {
    throw new Error('最多上传 2 张参考图');
  }
  for (const file of files) {
    if (!VIDEO_IMAGE_TYPES.has(file.type.toLowerCase())) {
      throw new Error('参考图只支持 PNG、JPEG 或 WebP');
    }
    if (file.size > VIDEO_MAX_SOURCE_IMAGE_BYTES) {
      throw new Error('单张参考图不能超过 10 MB');
    }
    if (file.size <= 0) {
      throw new Error('参考图内容为空');
    }
  }
  return files;
}

export function getVideoStageLabel(stage: VideoGenerationStage): string {
  switch (stage) {
    case 'submitting':
      return '正在提交';
    case 'queued':
      return '已排队';
    case 'processing':
      return '上游处理中';
    case 'downloading':
      return '正在下载';
    case 'validating':
      return '正在验证并保存';
  }
}

export function formatVideoElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) return safeSeconds + ' 秒';
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, '0');
  return minutes + ' 分 ' + remainder + ' 秒';
}
```

Run: `npm test -- src/components/Social/videoGeneration.test.ts`

Expected: PASS。

- [ ] **Step 3: 增加独立视频模式状态**

`FriendChat` 新增：

```ts
const [isVideoGenerationMode, setIsVideoGenerationMode] = useState(false);
const [pendingAiVideoImages, setPendingAiVideoImages] = useState<string[]>([]);
const aiVideoImageInputRef = useRef<HTMLInputElement>(null);
```

规则：

- 进入视频模式时 `setIsImageGenerationMode(false)`，清除普通待发送图片/文档，关闭菜单并聚焦输入框。
- 进入图片生成模式时关闭视频模式并清除视频参考图。
- 视频模式的 `canSend` 只看 `input.trim()`，有图无 prompt 仍禁用发送。
- 上传前调用 `validateVideoReferenceFiles`；再复用最长边 1600、JPEG 0.82 的压缩；结果最多保留两张。
- 拖拽在视频模式下只接收参考图；普通 AI 模式和好友聊天行为保持原样。
- `accept="image/png,image/jpeg,image/webp"`，达到两张后禁用增加入口。

把 `canSend` 计算移动到 `currentAiSession` 之后，并加入真实活动任务判断：

```ts
const activeVideoMessage = useMemo(() => (
  [...(currentAiSession?.messages || [])]
    .reverse()
    .find(message => (
      message.role === 'assistant'
      && message.status === 'streaming'
      && Boolean(message.videoGenerationStage)
    )) || null
), [currentAiSession?.messages]);
const isGeneratingVideoTask = Boolean(isAiChat && isStreaming && activeVideoMessage);
const canSend = isVideoGenerationMode
  ? Boolean(input.trim())
  : Boolean(input.trim() || (isAiChat && (pendingAiImages.length > 0 || pendingAiFiles.length > 0)));
const sendButtonDisabled = isGeneratingVideoTask
  || (isAiChat && isStreaming
    ? false
    : (!canSend || loading || isUploadingImages || isUploadingFile));
```

模式切换和上传 handler 使用：

```ts
function handleToggleVideoGenerationMode() {
  if (!isAiChat || isStreaming) return;
  const next = !isVideoGenerationMode;
  setIsVideoGenerationMode(next);
  if (next) {
    setIsImageGenerationMode(false);
    setPendingAiImages([]);
    setPendingAiFiles([]);
  } else {
    setPendingAiVideoImages([]);
  }
  setShowMoreActions(false);
  setShowModelMenu(false);
  window.setTimeout(() => composerRef.current?.focus(), 0);
}

function handleToggleImageGenerationMode() {
  if (!isAiChat || isStreaming) return;
  setIsImageGenerationMode(current => !current);
  setIsVideoGenerationMode(false);
  setPendingAiVideoImages([]);
  setShowMoreActions(false);
  setShowModelMenu(false);
  window.setTimeout(() => composerRef.current?.focus(), 0);
}

async function handleAddAiVideoImages(files: File[]) {
  let accepted;
  try {
    accepted = validateVideoReferenceFiles(
      files,
      pendingAiVideoImages.length,
    );
  } catch (error) {
    alert(error instanceof Error ? error.message : '参考图格式不正确');
    return;
  }
  setIsUploadingImages(true);
  try {
    const compressed = await Promise.all(accepted.map(file => compressImage(file)));
    setPendingAiVideoImages(current => [...current, ...compressed].slice(0, VIDEO_MAX_REFERENCE_IMAGES));
  } finally {
    setIsUploadingImages(false);
    setShowMoreActions(false);
  }
}
```

`handleDropFiles` 在 `isVideoGenerationMode` 为 true 时只调用 `handleAddAiVideoImages(imageFiles)` 并直接 return；其余分支保持现有逻辑。

- [ ] **Step 4: 在 AI “更多”菜单加入视频命令**

`FriendChatComposerAttachments` 从 `lucide-react` 使用 `Video` 图标，且按钮只能位于 `isAiChat` 分支：

```tsx
<button
  type="button"
  onClick={onToggleVideoGenerationMode}
  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-sky-50"
>
  <Video className="h-4 w-4 text-emerald-600" />
  <span>{isVideoGenerationMode ? '退出视频生成' : '生成视频'}</span>
</button>
```

视频模式在输入区上方显示一个非卡片式紧凑工具条：`视频生成`、`文生视频` 或 `图生视频 · N 张参考图`、添加参考图图标按钮、关闭 X；附一行 `参考图用于视觉引导，不保证首尾帧顺序。`。普通好友聊天不渲染这些 props 对应的 UI。

- [ ] **Step 5: 提交 video task**

`useFriendChatAiActions` 新增：

```ts
const submitAiVideoGeneration = async (prompt: string, images: string[]) => {
  const sessionId = await resolveSessionId('veo_3_1_fast');
  setStreaming(true, null);
  const result = await createServerAiVideoTask(aiOwner, sessionId, prompt, images);
  currentAiTaskIdRef.current = result.task.id;
  currentAiSessionIdRef.current = result.sessionId;
  setStreamingMessageId(result.messageId);
  selectSession(result.sessionId);
  startServerTaskPolling(result.task.id, result.sessionId);
  void syncServerAiSessions(result.sessionId);
};
```

给 hook 参数加入 `isVideoGenerationMode`、`pendingAiVideoImages`、`setIsVideoGenerationMode` 和 `setPendingAiVideoImages`。`resetComposerState` 同时执行：

```ts
setIsVideoGenerationMode(false);
setPendingAiVideoImages([]);
```

`handleSendAiMessage` 的分支改为：

```ts
const rawContent = input.trim();
const images = [...pendingAiImages];
const files = [...pendingAiFiles];
const videoImages = [...pendingAiVideoImages];
const shouldGenerateVideo = isVideoGenerationMode;
const shouldGenerateImage = effectiveImageGenerationMode;
if (shouldGenerateVideo && !rawContent) return;
if (!rawContent && images.length === 0 && files.length === 0) return;

resetComposerState();
try {
  if (shouldGenerateVideo) {
    await submitAiVideoGeneration(rawContent, videoImages);
    return;
  }
  if (shouldGenerateImage) {
    await submitAiImageGeneration(rawContent, images);
    return;
  }
  await submitAiMessage(rawContent, images, files);
} catch (error) {
  console.error('Failed to send AI message', error);
  alert(error instanceof Error ? error.message : '发送失败，请稍后重试');
  await resetStreamingState();
}
```

`FriendChat.handleSendMessage` 使用：

```ts
if (isAiChat && isStreaming) {
  if (isGeneratingVideoTask) return;
  handleAbortAiResponse();
  return;
}
```

把 `isGeneratingVideoTask` 传入 composer。发送按钮为视频任务时 `disabled` 且显示旋转 `LoaderCircle`；只有 chat/image 流任务显示 `Square`。页面上不得出现视频取消按钮。

- [ ] **Step 6: 运行前端测试、构建和 lint**

Run:

```powershell
npm test -- src/components/Social/videoGeneration.test.ts
npm run build
npm run lint
```

Expected: PASS；普通好友聊天编译路径没有新增必填交互。

### Task 9: 渲染真实阶段、耗时、播放器和下载

**Files:**
- Create: `src/components/Chat/VideoMessage.tsx`
- Create: `src/components/Chat/VideoMessage.test.tsx`
- Modify: `src/components/Chat/MessageBubble.tsx`

- [ ] **Step 1: 写组件失败测试**

创建 `src/components/Chat/VideoMessage.test.tsx`：

```tsx
// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/types';
import { VideoMessage } from './VideoMessage';

const baseMessage: Message = {
  id: 'message_1',
  role: 'assistant',
  content: '',
  timestamp: Date.now(),
  status: 'streaming',
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VideoMessage', () => {
  it('shows a real stage and elapsed time without percentage or cancel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
    render(
      <VideoMessage
        isStreaming
        message={{
          ...baseMessage,
          timestamp: Date.now() - 12_000,
          videoGenerationStage: 'processing',
        }}
      />,
    );
    expect(screen.getByText('上游处理中')).not.toBeNull();
    expect(screen.getByText('已等待 12 秒')).not.toBeNull();
    expect(screen.getByText('可以离开页面，稍后回来查看')).not.toBeNull();
    expect(document.body.textContent).not.toContain('%');
    expect(document.body.textContent).not.toContain('取消');
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText('已等待 13 秒')).not.toBeNull();
  });

  it('renders the local MP4 player, metadata, and download link', () => {
    const { container } = render(
      <VideoMessage
        isStreaming={false}
        message={{
          ...baseMessage,
          status: 'sent',
          videoUrl: '/videos/ai_task_1.mp4',
          videoMimeType: 'video/mp4',
          videoFileName: 'ai_task_1.mp4',
          videoFileSize: 19 * 1024 * 1024,
          videoDuration: 8,
          videoWidth: 1280,
          videoHeight: 720,
        }}
      />,
    );
    const video = container.querySelector('video');
    expect(video?.controls).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.preload).toBe('metadata');
    expect(screen.getByText('8 秒')).not.toBeNull();
    expect(screen.getByText('1280 × 720')).not.toBeNull();
    expect(screen.getByText('19.0 MB')).not.toBeNull();
    const download = screen.getByRole('link', { name: '下载视频' });
    expect(download.getAttribute('href')).toBe('/videos/ai_task_1.mp4');
    expect(download.getAttribute('download')).toBe('ai_task_1.mp4');
  });
});
```

- [ ] **Step 2: 实现 VideoMessage**

创建 `src/components/Chat/VideoMessage.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { Message } from '@/types';
import { formatVideoElapsed, getVideoStageLabel } from '@/components/Social/videoGeneration';

interface VideoMessageProps {
  message: Message;
  isStreaming: boolean;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  return formatVideoElapsed(Math.round(seconds));
}

export function VideoMessage({ message, isStreaming }: VideoMessageProps) {
  const [now, setNow] = useState(Date.now());
  const stage = message.videoGenerationStage;
  const active = Boolean(isStreaming && stage && !message.videoUrl);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (message.videoUrl) {
    const metadata = [
      formatDuration(message.videoDuration),
      message.videoWidth && message.videoHeight ? message.videoWidth + ' × ' + message.videoHeight : '',
      formatBytes(message.videoFileSize),
    ].filter(Boolean);

    return (
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <video className="aspect-video w-full bg-black object-contain" controls playsInline preload="metadata">
          <source src={message.videoUrl} type={message.videoMimeType || 'video/mp4'} />
        </video>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            {metadata.map(item => <span key={item}>{item}</span>)}
          </div>
          <a
            href={message.videoUrl}
            download={message.videoFileName || 'ai-video.mp4'}
            aria-label="下载视频"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            <Download className="h-4 w-4" />
            <span>下载</span>
          </a>
        </div>
      </div>
    );
  }

  if (stage) {
    const elapsedSeconds = Math.max(0, Math.floor((now - message.timestamp) / 1_000));
    return (
      <div className="max-w-sm rounded-lg border border-sky-100 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-sky-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">{getVideoStageLabel(stage)}</p>
            <p className="mt-1 text-xs text-slate-500">已等待 {formatVideoElapsed(elapsedSeconds)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">可以离开页面，稍后回来查看</p>
      </div>
    );
  }

  return null;
}
```

活动状态只使用阶段、旋转图标和实际等待时间，不使用进度条。

- [ ] **Step 3: 接入 MessageBubble**

在 assistant 分支中优先渲染：

```tsx
{message.videoUrl || message.videoGenerationStage ? (
  <VideoMessage message={message} isStreaming={Boolean(isStreaming)} />
) : null}
```

有视频时不要再把阶段 `content` 渲染成 Markdown 气泡；失败后 `videoGenerationStage` 被后端清除，错误内容仍走现有错误文本气泡。

- [ ] **Step 4: 运行组件测试**

Run:

```powershell
npm test -- src/components/Chat/VideoMessage.test.tsx
npm run build
npm run lint
```

Expected: PASS；测试 DOM 中不存在百分比和取消按钮。

### Task 10: 本地端到端和真实上游验收

**Files:**
- Create: `scripts/video-smoke.mjs`
- Modify: `.env`（本地私密文件，不输出内容）
- Create: `storage/videos/`（运行时目录）

- [ ] **Step 1: 确认本地 ffprobe 前置条件**

Run: `ffprobe -version`

Expected: 当前环境首次执行 FAIL（已确认未安装）。使用 Windows 包管理器安装 FFmpeg 后重新执行，Expected: 输出 ffprobe 版本并退出码 0。若 `winget` 可用：

```powershell
winget install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements
```

重新打开 shell 或把 ffprobe 所在目录写入本地 `.env` 的 `FFPROBE_PATH`。

- [ ] **Step 2: 写不泄密的冒烟脚本**

创建 `scripts/video-smoke.mjs`：

```js
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const result = {
    baseUrl: 'http://127.0.0.1:3000',
    guestId: 'video-smoke-' + Date.now(),
    prompt: '',
    images: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error('参数缺少值: ' + key);
    if (key === '--base-url') result.baseUrl = value.replace(/\/+$/, '');
    else if (key === '--guest-id') result.guestId = value;
    else if (key === '--prompt') result.prompt = value;
    else if (key === '--image') result.images.push(value);
    else throw new Error('未知参数: ' + key);
    index += 1;
  }
  if (!result.prompt.trim()) throw new Error('--prompt 必填');
  if (result.images.length > 2) throw new Error('--image 最多传两次');
  return result;
}

function getImageMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  throw new Error('参考图只支持 PNG、JPEG 或 WebP: ' + filePath);
}

async function toDataUrl(filePath) {
  const absolutePath = path.resolve(filePath);
  const buffer = await fs.readFile(absolutePath);
  if (buffer.length > 10 * 1024 * 1024) throw new Error('参考图超过 10 MB: ' + absolutePath);
  return 'data:' + getImageMimeType(absolutePath) + ';base64,' + buffer.toString('base64');
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('接口返回非 JSON: HTTP ' + response.status);
  }
  if (!response.ok) throw new Error(payload.error || 'HTTP ' + response.status);
  return payload;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const options = parseArgs(process.argv.slice(2));
const images = await Promise.all(options.images.map(toDataUrl));
const sessionResult = await requestJson(options.baseUrl + '/api/ai-sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestId: options.guestId, model: 'veo_3_1_fast' }),
});
const createResult = await requestJson(options.baseUrl + '/api/ai-task/video', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guestId: options.guestId,
    sessionId: sessionResult.session.id,
    prompt: options.prompt,
    images,
  }),
});

const taskId = createResult.task.id;
const startedAt = Date.now();
const timeoutAt = startedAt + 12 * 60 * 1_000;
let lastStage = '';
let completedTask;
console.log('task=' + taskId);

while (Date.now() < timeoutAt) {
  const query = new URLSearchParams({ guestId: options.guestId });
  const result = await requestJson(
    options.baseUrl + '/api/ai-task/' + encodeURIComponent(taskId) + '?' + query.toString(),
  );
  const task = result.task;
  if (task.videoStage && task.videoStage !== lastStage) {
    lastStage = task.videoStage;
    console.log('stage=' + lastStage + ' elapsed=' + Math.round((Date.now() - startedAt) / 1_000) + 's');
  }
  if (task.status === 'failed') throw new Error(task.error || '视频任务失败');
  if (task.status === 'completed') {
    completedTask = task;
    break;
  }
  await sleep(2_500);
}

if (!completedTask) throw new Error('本地冒烟测试等待超时');
if (!completedTask.videoUrl || !completedTask.videoFileSize) throw new Error('完成任务缺少本地视频字段');

const localVideoUrl = new URL(completedTask.videoUrl, options.baseUrl);
const head = await fetch(localVideoUrl, { method: 'HEAD' });
if (!head.ok) throw new Error('本地视频 HEAD 失败: HTTP ' + head.status);
if (!String(head.headers.get('content-type') || '').startsWith('video/mp4')) {
  throw new Error('本地视频 Content-Type 不是 video/mp4');
}
const contentLength = Number(head.headers.get('content-length') || 0);
if (contentLength !== completedTask.videoFileSize) throw new Error('本地视频字节数与任务元数据不一致');

const range = await fetch(localVideoUrl, { headers: { Range: 'bytes=0-1023' } });
if (range.status !== 206) throw new Error('本地视频不支持 Range: HTTP ' + range.status);
if ((await range.arrayBuffer()).byteLength <= 0) throw new Error('Range 响应为空');

console.log(
  'completed duration=' + completedTask.videoDuration
  + ' resolution=' + completedTask.videoWidth + 'x' + completedTask.videoHeight
  + ' bytes=' + completedTask.videoFileSize
  + ' url=' + completedTask.videoUrl,
);
```

脚本不读取、打印或接受 `VIDEO_API_KEY` 参数；密钥只由本地后端从 `.env` 读取。

- [ ] **Step 3: 启动本地后端和前端**

Terminal A: `npm run server`

Terminal B: `npm run dev -- --port 3001`

Expected: 后端 `http://127.0.0.1:3000/api/health` 返回 `status: ok`；前端 `http://127.0.0.1:3001` 可打开。

- [ ] **Step 4: 执行一次文生视频真实测试**

Run:

```powershell
node scripts/video-smoke.mjs --base-url http://127.0.0.1:3000 --guest-id video-smoke-text --prompt "清晨海边，镜头缓慢向前移动，光线自然，画面稳定"
```

Expected: `completed`；本地 `/videos/*.mp4` 可下载；ffprobe 元数据包含正 duration/width/height；`storage/data.json` 中不含 API Key。

- [ ] **Step 5: 执行一次双图视频真实测试**

Run:

```powershell
node scripts/video-smoke.mjs --base-url http://127.0.0.1:3000 --guest-id video-smoke-two-images --prompt "将两张参考图的主要视觉元素自然融合成连续镜头，运动平稳" --image workspace-artifacts/ui-reference/buttons.png --image workspace-artifacts/ui-reference/friends-tab2.png
```

Expected: `completed`；请求只含两张图；本地 MP4 可播放。记录但不承诺参考图顺序。

- [ ] **Step 6: 验证刷新和服务重启恢复**

发起新任务，拿到 `upstreamTaskId` 后停止后端，再重新运行 `npm run server`。Expected: 同一 task ID 继续 GET 轮询，不出现第二次 POST，浏览器刷新后继续显示阶段直至完成。

另构造一个 `submitting` 且无 upstream ID 的测试 job 后重启。Expected: 标记失败并显示“为避免重复扣费未自动重试”。

- [ ] **Step 7: Playwright 桌面和移动端视觉检查**

在 1440x900 和 390x844 截图，检查：AI “更多”菜单视频入口、双图预览、模式工具条、处理中状态、完成播放器；普通好友聊天菜单没有视频入口；无溢出、重叠和被裁切文本。视频元素必须用 `videoWidth/videoHeight > 0` 和截图像素检查确认不是空白区域。

- [ ] **Step 8: 全量回归**

Run:

```powershell
npm test
npm run build
npm run lint
```

Expected: 全部退出码 0；聊天、图片生成、语音、好友聊天的手工冒烟均通过。

### Task 11: 生产备份、部署、冒烟和回滚

**Files:**
- Modify: `deploy/server/hello-kitty-chat.service`
- Modify: `deploy/server/nginx.conf`
- Modify: `deploy/server/DEPLOY_ALIYUN.md`
- Production: `/www/wwwroot/chat-app/.env`
- Production: `/www/wwwroot/chat-app/storage/videos/`

- [ ] **Step 1: 清除部署模板中的明文密钥**

`deploy/server/hello-kitty-chat.service` 不得包含任何 `*_API_KEY=<real key>`。保留：

```ini
EnvironmentFile=-/www/wwwroot/chat-app/.env
```

把现有图片密钥和新视频密钥都放入生产 `.env`，并轮换已经进入部署模板历史副本的旧图片密钥。运行：

```powershell
Select-String -Path deploy/server/hello-kitty-chat.service -Pattern 'sk-[A-Za-z0-9]+'
```

Expected: 无输出。

- [ ] **Step 2: 增加 Nginx 视频代理**

在 `/api/` 之前加入：

```nginx
location /videos/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
  proxy_read_timeout 600s;
}
```

- [ ] **Step 3: 在生产机创建时间戳备份**

在服务器执行：

```bash
set -euo pipefail
cd /www/wwwroot
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p /www/backups/chat-app-$stamp
tar -czf /www/backups/chat-app-$stamp/code.tgz --exclude='chat-app/node_modules' --exclude='chat-app/storage' chat-app
cp -a /www/wwwroot/chat-app/.env /www/backups/chat-app-$stamp/.env
cp -a /www/wwwroot/chat-app/storage/data.json /www/backups/chat-app-$stamp/data.json
printf '%s\n' "$stamp" > /www/backups/chat-app-last-video-deploy
```

Expected: 三个备份文件存在且非空。

- [ ] **Step 4: 上传代码但绝不覆盖 storage 和 .env**

部署包排除 `.env`、`storage`、`node_modules`、本地测试产物。解包到临时目录后用 `rsync`：

```bash
rsync -a --delete --exclude='.env' --exclude='storage/' --exclude='node_modules/' release/ /www/wwwroot/chat-app/
```

Expected: `/www/wwwroot/chat-app/storage/data.json` 校验和与上传前一致。

- [ ] **Step 5: 安装运行依赖并配置私密环境**

```bash
apt-get update
apt-get install -y ffmpeg
ffprobe -version | head -n 1
mkdir -p /www/wwwroot/chat-app/storage/videos
chmod 755 /www/wwwroot/chat-app/storage/videos
```

在生产 `.env` 增加 Task 2 的 VIDEO 配置及真实 `VIDEO_API_KEY`，文件权限设为：

```bash
chmod 600 /www/wwwroot/chat-app/.env
```

- [ ] **Step 6: 在重启前运行生产构建检查**

```bash
cd /www/wwwroot/chat-app
npm ci
npm test
npm run build
npm run lint
```

Expected: 全部退出码 0。任一失败立即停止，不重启线上服务。

- [ ] **Step 7: 更新服务并重启**

```bash
cp /www/wwwroot/chat-app/deploy/server/hello-kitty-chat.service /etc/systemd/system/hello-kitty-chat.service
cp /www/wwwroot/chat-app/deploy/server/nginx.conf /etc/nginx/sites-available/hello-kitty-chat.conf
systemctl daemon-reload
nginx -t
systemctl restart hello-kitty-chat.service
systemctl reload nginx
systemctl --no-pager --full status hello-kitty-chat.service
journalctl -u hello-kitty-chat.service -n 100 --no-pager
```

Expected: service `active (running)`，Nginx 配置通过，日志无密钥和启动异常。

- [ ] **Step 8: 生产冒烟**

依次验证：

```bash
curl -fsS https://www.koyue.top/api/health
curl -fsSI https://www.koyue.top/
```

然后只执行一次实际视频任务，验证：入口只在 AI 聊天；刷新可恢复；完成后播放器和下载正常；Range 请求返回 206；服务器文件存在于 `storage/videos`；`storage/data.json` 和前端构建产物均搜索不到 API Key。

- [ ] **Step 9: 回滚演练**

若健康检查、任务创建或播放失败：

```bash
set -euo pipefail
stamp=$(cat /www/backups/chat-app-last-video-deploy)
systemctl stop hello-kitty-chat.service
find /www/wwwroot/chat-app -mindepth 1 -maxdepth 1 ! -name storage ! -name .env -exec rm -rf -- {} +
tar -xzf /www/backups/chat-app-$stamp/code.tgz -C /www/wwwroot
cp -a /www/backups/chat-app-$stamp/.env /www/wwwroot/chat-app/.env
systemctl start hello-kitty-chat.service
curl -fsS http://127.0.0.1:3000/api/health
```

回滚保留新生成的 `storage/videos` 和聊天数据，不删除用户成品。

## 最终验收清单

- [ ] 文生视频、单图视频、双图视频均成功；第三张图无法加入。
- [ ] API Key 只存在于服务器 `.env`，不在源码、systemd 模板、浏览器、日志和 JSON 数据中。
- [ ] 任务查询和取消接口验证 owner，不同用户统一返回 404。
- [ ] 视频只显示真实阶段和等待时间，不显示百分比或取消按钮。
- [ ] 刷新页面继续显示任务；服务重启后恢复已有 upstream ID 的作业。
- [ ] 无 upstream ID 的未知提交不会自动重复创建。
- [ ] MP4 通过 ftyp 和 ffprobe，永久保存在 `storage/videos`，支持播放、Range 和下载。
- [ ] 普通好友聊天没有视频入口，原有聊天、图片、语音和文件功能无回归。
- [ ] `npm test`、`npm run build`、`npm run lint`、本地真实测试和生产冒烟全部通过。

# Veo 3.1 Input Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让视频生成明确区分首帧、尾帧和最多三张角色参考图，按 Veo 3.1 Fast 契约提交，并减少长耗时任务被本站过早判定失败的问题。

**Architecture:** 浏览器使用结构化 `VideoGenerationInputs` 保存 `image`、`lastFrame` 和 `referenceImages`，本站 API 对三类图片分别校验后再交给 provider。Provider 只负责构造 chancexj 兼容请求体和轮询；旧客户端的 `images` 在路由边界转换，单图兼容为首帧，多图兼容为角色参考图。

**Tech Stack:** React 18、TypeScript、Express、Vitest、Tailwind CSS、systemd/Nginx

---

### Task 1: Lock the provider contract with tests

**Files:**
- Modify: `tests/server/videoProvider.test.js`
- Modify: `server/videoProvider.js`

- [ ] **Step 1: Write failing payload tests**

覆盖文生视频、单首帧、首尾帧、1-3 张 `referenceImages`、首帧和参考图组合，并断言尾帧不能脱离首帧、参考图不能超过 3 张。目标请求体形状：

```js
{
  model: 'veo_3_1_fast',
  prompt: '角色转身',
  durationSeconds: 8,
  image: { image_url: 'data:image/jpeg;base64,...' },
  lastFrame: { image_url: 'data:image/jpeg;base64,...' },
  referenceImages: [
    { image_url: 'data:image/jpeg;base64,...' },
  ],
}
```

- [ ] **Step 2: Run the focused test and confirm the old `images` mapping fails**

Run: `npm test -- tests/server/videoProvider.test.js`

Expected: FAIL because the current provider emits `images` and treats a single image as an implicit first frame.

- [ ] **Step 3: Implement the structured provider input**

Change `buildVideoRequestBody` and `submit` to accept:

```js
{
  prompt,
  image: '',
  lastFrame: '',
  referenceImages: [],
  durationSeconds: 8,
}
```

Normalize every field, reject invalid combinations, and never emit the generic `images` field.

- [ ] **Step 4: Run the provider tests**

Run: `npm test -- tests/server/videoProvider.test.js`

Expected: PASS.

### Task 2: Validate and route distinct image roles

**Files:**
- Modify: `server/aiRoutes.js`
- Modify: `tests/server/aiAccessBilling.test.js`
- Modify: `server/aiTasks.js`

- [ ] **Step 1: Write route tests for each input role**

Add authenticated request cases for `image`, `lastFrame`, `referenceImages`, their supported combination, `lastFrame` without `image`, and more than three reference images. Verify the in-memory task stores the roles separately and the persisted chat message contains no data URLs.

- [ ] **Step 2: Add legacy compatibility tests**

Keep `{ images: [] }`; map one legacy image to `image`, and two or three legacy images to `referenceImages`. Explicit new fields take precedence and cannot be mixed with legacy `images`.

- [ ] **Step 3: Implement route normalization**

Create one data-URL validator reused by all image roles. Include normalized roles in the idempotency fingerprint, task object and diagnostic counts, while continuing to omit raw data URLs from `videoJobs`.

- [ ] **Step 4: Pass structured values to the provider**

Update the video task runner call to:

```js
videoProvider.submit({
  prompt: task.prompt,
  image: task.image,
  lastFrame: task.lastFrame,
  referenceImages: task.referenceImages,
  durationSeconds: 8,
});
```

- [ ] **Step 5: Run route and task tests**

Run: `npm test -- tests/server/aiAccessBilling.test.js tests/server/aiTasks.test.js`

Expected: PASS.

### Task 3: Add a clear video input composer

**Files:**
- Modify: `src/components/AiChat/videoGeneration.ts`
- Modify: `src/components/AiChat/videoGeneration.test.ts`
- Create: `src/components/AiChat/VideoInputPanel.tsx`
- Create: `src/components/AiChat/VideoInputPanel.test.tsx`
- Modify: `src/components/AiChat/AiChatComposer.tsx`
- Modify: `src/components/AiChat/AiChat.tsx`
- Modify: `src/components/AiChat/useAiChatActions.ts`
- Modify: `src/components/AiChat/useAiChatActions.test.ts`

- [ ] **Step 1: Define the browser input type**

Use:

```ts
export interface VideoGenerationInputs {
  image: string;
  lastFrame: string;
  referenceImages: string[];
}
```

Provide an empty factory, total-image helper and target-aware file validation.

- [ ] **Step 2: Test the composer panel first**

Verify visible `首帧`, `尾帧`, `角色参考` controls, a disabled tail-frame button before a first frame exists, `0/3` count, labelled thumbnails, 44px controls, and removal callbacks.

- [ ] **Step 3: Implement progressive input controls**

Render a compact unframed band inside the existing composer. Use Lucide icons, semantic buttons, visible focus states and responsive three-column controls without nested cards or explanatory marketing copy.

- [ ] **Step 4: Wire target-aware image selection**

Use one hidden image input and a mutable picker target. First/last frame selection keeps the first file; reference selection accepts the remaining capacity up to three. Removing the first frame also clears the dependent tail frame.

- [ ] **Step 5: Submit structured input and reset state**

Update `useAiChatActions` and its tests so the API receives `VideoGenerationInputs` and composer state is cleared only after local validation succeeds.

- [ ] **Step 6: Run frontend tests**

Run: `npm test -- src/components/AiChat/videoGeneration.test.ts src/components/AiChat/VideoInputPanel.test.tsx src/components/AiChat/useAiChatActions.test.ts src/services/apiModules.test.ts`

Expected: PASS.

### Task 4: Update the browser API and timeout behavior

**Files:**
- Modify: `src/services/aiTasksApi.ts`
- Modify: `src/services/apiModules.test.ts`
- Modify: `server/config.js`
- Modify: `tests/server/videoConfig.test.js`
- Modify: `.env.example`
- Modify: `server/aiTasks.js`

- [ ] **Step 1: Test the structured browser request body**

Assert `/api/ai-task/video` receives `image`, `lastFrame`, `referenceImages`, and no `images` for new calls.

- [ ] **Step 2: Extend the default polling window**

Change the default and documented `VIDEO_TIMEOUT_MS` from `600000` to `1800000`, while preserving an explicit production override.

- [ ] **Step 3: Classify known provider failures**

Map upstream balance failures, upstream result download failures and true polling timeouts to distinct safe Chinese messages. Points settlement remains unchanged: only successful videos charge points.

- [ ] **Step 4: Run configuration and API tests**

Run: `npm test -- tests/server/videoConfig.test.js src/services/apiModules.test.ts`

Expected: PASS.

### Task 5: Full verification and paid admin smoke test

**Files:**
- Modify if required by verification: only files listed above

- [ ] **Step 1: Run repository verification**

Run: `npm test`, `npm run lint`, `npm run build`.

Expected: all commands exit 0.

- [ ] **Step 2: Verify responsive composer rendering**

Start the local server and use browser automation at 320x568, 375x812 and desktop width. Confirm no horizontal overflow, no overlap, usable controls and correct enabled/disabled states.

- [ ] **Step 3: Run a real three-reference request as the administrator**

Use the supplied front/side/back images through the site API. Confirm the upstream submission body has `referenceImages`, the task reaches a terminal state, and the administrator is not charged. Do not expose credentials or full data URLs in logs.

### Task 6: Deploy with an immutable release

**Files:**
- Build artifact: `chat-app-release.tgz`
- Server paths: `/www/wwwroot/chat-app-releases/<release-id>` and `/www/wwwroot/chat-app`

- [ ] **Step 1: Build and inspect the allowlisted archive**

Follow the root `README.md` release allowlist and confirm `.env`, runtime data, generated media and `node_modules` are absent.

- [ ] **Step 2: Create and validate the remote release**

Upload to `/tmp`, extract into a new release directory, link shared `.env`, `storage` and `data.json`, run `npm ci --omit=dev`, `node --check server.js`, and verify `dist/index.html`.

- [ ] **Step 3: Switch atomically and restart only the chat service**

Move `/www/wwwroot/chat-app.next` over `/www/wwwroot/chat-app`, restart only `hello-kitty-chat.service`, and require both `systemctl is-active` and local `/api/health` HTTP 200.

- [ ] **Step 4: Run post-deploy smoke checks**

Verify the public page, unauthenticated media 401, authenticated video input UI, service logs, active release symlink and rollback path.

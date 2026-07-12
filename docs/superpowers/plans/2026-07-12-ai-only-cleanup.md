# AI-Only Project Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the application into an AI-only assistant while preserving all deployed AI chat, session, image, video, voice, file, Markdown, and media URL behavior; remove social/friend features and extract the Hhstu module from the deployable project.

**Architecture:** Keep `App` and the server AI task/session APIs as the public AI shell. Move the reusable AI half of the mixed `Social/FriendChat*` implementation into `src/components/AiChat/`, replace account/social state with a small AI owner compatibility module, remove Socket.IO and social HTTP routes, and move all Hhstu source/integration files to a sibling project folder. Preserve legacy data on disk but stop exposing or mutating it through removed routes.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, Express, Vitest, Node.js.

**Repository note:** This workspace has no `.git` directory. Replace commit steps with a source-only backup checkpoint and fresh verification evidence. Never read or archive `.env`, certificates, runtime data, generated user media, or `workspace-artifacts` contents.

---

### Task 1: Finish the AI Media Delivery Safety Boundary

**Files:**
- Modify: `server/config.js`
- Modify: `server/staticDelivery.js`
- Modify: `server.js`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Create: `scripts/verify-build-output.mjs`
- Test: `tests/server/staticDelivery.test.js`
- Test: `tests/server/config.test.js`
- Test: `tests/buildOutput.test.js`

- [ ] Add failing tests proving generated audio defaults to `storage/audios`, `/audios` falls back read-only to `public/audios`, media routes run before `dist`, missing media paths return 404, SPA fallback accepts only extensionless HTML navigation, and `dist/audios|uploads|videos` fail validation.
- [ ] Run the targeted tests and record the expected RED failures.
- [ ] Set `AUDIO_DIR` to `storage/audios`, add `LEGACY_AUDIO_DIR`, mount runtime media routes before `express.static(dist)`, disable Vite's blanket public copy, and copy only `avatar.jpg`, `background.jpg`, `favicon.svg`, and `manifest.webmanifest`.
- [ ] Fix legacy Vite hash matching to an exact eight-character `[A-Za-z0-9_-]` suffix and add explicit asset/media 404 handlers.
- [ ] Run targeted tests and `npm run build`; verify no runtime media directory exists under `dist`.

### Task 2: Create an AI Owner Compatibility Boundary

**Files:**
- Create: `src/utils/aiOwner.ts`
- Create: `src/utils/aiOwner.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

- [ ] Add failing tests for these exact behaviors: an existing `ai-owner-v1` wins; otherwise a valid legacy `social-store-v4.state.currentUser.id` migrates to `{ userId }`; malformed legacy JSON is ignored; new browsers use the existing stable `getGuestAiId()` and return `{ guestId }`.
- [ ] Run `npm test -- --run src/utils/aiOwner.test.ts` and confirm RED because `getAiOwner` does not exist.
- [ ] Implement `getAiOwner()` without importing the social store:

```ts
export type AiOwner = { userId: string } | { guestId: string };

export function getAiOwner(): AiOwner {
  // Read ai-owner-v1, migrate only legacy currentUser.id, then fall back to getGuestAiId().
}
```

- [ ] Update `App` to use one memoized AI owner, remove login/logout/profile screens, render only the AI chat view, and retain session create/select/delete/clear/cache behavior.
- [ ] Update `App.test.tsx` to prove only the AI surface is reachable and the existing background sync visibility/generation protections still work.
- [ ] Run the owner and App tests and record GREEN evidence.

### Task 3: Extract the AI Chat UI from the Social Module

**Files:**
- Create from AI-only portions: `src/components/AiChat/AiChat.tsx`
- Create from AI-only portions: `src/components/AiChat/AiChatHeader.tsx`
- Create from AI-only portions: `src/components/AiChat/AiChatComposer.tsx`
- Create from AI-only portions: `src/components/AiChat/AiChatComposerAttachments.tsx`
- Create from AI-only portions: `src/components/AiChat/AiChatOverlays.tsx`
- Move/refactor: `src/components/Social/AIPhoneCallPanel.tsx` -> `src/components/AiChat/AIPhoneCallPanel.tsx`
- Move/refactor: `src/components/Social/AudioMessage.tsx` -> `src/components/AiChat/AudioMessage.tsx`
- Move/refactor: `src/components/Social/useFriendChatAiActions.ts` -> `src/components/AiChat/useAiChatActions.ts`
- Move/refactor: `src/components/Social/useFriendChatAiSync.ts` -> `src/components/AiChat/useAiChatSync.ts`
- Move/refactor: `src/components/Social/videoGeneration.ts` -> `src/components/AiChat/videoGeneration.ts`
- Modify: `src/components/Chat/MessageBubble.tsx`
- Modify: `src/components/Chat/VideoMessage.tsx`
- Test: `src/components/AiChat/AiChatComposerAttachments.test.tsx`
- Test: `src/components/AiChat/useAiChatActions.test.ts`
- Test: `src/components/AiChat/useAiChatSync.test.ts`
- Test: `src/components/Chat/MessageBubble.test.tsx`

- [ ] Before production edits, add tests that quick suggestions and AI phone transcripts reset streaming state and rethrow when task creation fails; add a `message.status === 'streaming'` test that proves the Markdown lazy module is not requested.
- [ ] Run the new tests and confirm RED for the missing centralized rollback and status-only streaming boundary.
- [ ] Refactor AI hooks to accept `AiOwner` directly; remove `isAiChat`, `currentUser`, `friend`, friend message, sticker, WebRTC, and Hhstu parameters and branches.
- [ ] Build `AiChat` from the AI-only send/upload/image/video/voice/session/task logic. Keep the deployed AI upload path `/api/upload-file`, task paths, response shapes, provider models, voice models, and public media URLs unchanged.
- [ ] Reduce `AiChatMessagePane` to direct `MessageList` usage; reduce overlays to AI voice picker and `AIPhoneCallPanel`; remove friend file inputs and friend composer actions.
- [ ] In `MessageBubble`, replace social-store avatar access with a generic user avatar and define `const messageIsStreaming = Boolean(isStreaming || message.status === 'streaming')` for plain-text rendering, cursor, and voice streaming decisions.
- [ ] Run all AI chat, MessageBubble, Markdown, image, video, persistence, App, API, and source reachability tests.

### Task 4: Remove Social Client and Server Runtime Surfaces

**Files:**
- Delete after Task 3 imports are green: `src/components/Social/`
- Delete: `src/store/socialStore.ts`
- Delete: `src/types/social.ts`
- Delete: `src/services/realtime.ts`
- Modify: `server.js`
- Modify: `package.json`
- Modify mechanically: `package-lock.json`
- Test: `tests/server/aiOnlySurface.test.js`
- Test: `tests/sourceReachability.test.js`

- [ ] Add a failing server surface test that enumerates removed social endpoints (`/api/register`, `/api/login`, `/api/profile`, friend CRUD/chat, friend message, video-call signaling) and expects 404 while `/api/health`, `/api/ai-sessions`, `/api/ai-task/*`, `/api/chat`, `/api/image-generation`, and `/api/upload-file` remain registered.
- [ ] Remove Socket.IO import, server construction, rooms, emits, signaling handlers, social route handlers, account/profile/friend helpers, and announcement state that is not consumed by the AI client.
- [ ] Preserve legacy fields in the JSON database as opaque data so an AI-only deployment does not destroy old records; do not expose them through HTTP or Socket.IO.
- [ ] Remove `socket.io` and `socket.io-client` with the package manager so `package.json` and the lock file stay consistent.
- [ ] Delete the now-unreferenced Social tree/store/types/realtime service and run `tests/sourceReachability.test.js` to prove no replacement dead modules remain.
- [ ] Run server AI session/task/provider/static tests and the new removed-surface test.

### Task 5: Extract Hhstu and Other Unused Bundled Trees

**Source paths:**
- Move: `hhstu/` -> `C:\Users\kaikai\Desktop\Project\智慧黄科模块\hhstu\`
- Move: `hhstu_bridge.py` -> `C:\Users\kaikai\Desktop\Project\智慧黄科模块\hhstu_bridge.py`
- Move: `server/hhstuBridge.js` -> `C:\Users\kaikai\Desktop\Project\智慧黄科模块\integration-reference\server\hhstuBridge.js`
- Move before deleting Social tree: `src/components/Social/HhstuModal.tsx` -> `C:\Users\kaikai\Desktop\Project\智慧黄科模块\integration-reference\src\components\HhstuModal.tsx`
- Move: `src/services/hhstuApi.ts` -> `C:\Users\kaikai\Desktop\Project\智慧黄科模块\integration-reference\src\services\hhstuApi.ts`
- Move unrelated unused tree: `dydownload-main/` -> `C:\Users\kaikai\Desktop\Project\dydownload-main\`
- Create: `C:\Users\kaikai\Desktop\Project\智慧黄科模块\README.md`
- Modify: `server/config.js`
- Modify: `server.js`
- Modify: `src/services/api.ts`
- Modify: `src/services/apiModules.test.ts`
- Modify: `tests/sourceTextQuality.test.js`

- [ ] Verify each destination does not exist and resolve source/destination absolute paths before any recursive move.
- [ ] Create a source-only rollback archive under `workspace-artifacts/backups/` excluding `.env*`, `.deploy-certs`, `storage`, root data, generated media, `dist`, `node_modules`, and existing artifacts; do not inspect or print archive contents.
- [ ] Move the Hhstu implementation and integration reference files into the new sibling folder. Its README must explain that it is no longer built/deployed with the AI app and list the original relative paths.
- [ ] Remove Hhstu config keys, imports, server initialization, `/api/hhstu/overview`, `/api/hhstu/action`, API barrel exports, and API module tests.
- [ ] Move the unreferenced `dydownload-main` tree out of the AI project rather than deleting it; remove only generated `__pycache__` from the AI project.
- [ ] Scan first-party runtime/build files for `Hhstu`, `hhstu`, `智慧黄科`, `socket.io`, `FriendChat`, `socialStore`, and `/api/friend`; expected result is zero except migration/audit documentation that explicitly records removal.

### Task 6: Documentation, Build Metrics, and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_STRUCTURE.md`
- Modify: `docs/PROJECT_AUDIT.md`
- Replace: `deploy/server/DEPLOY_ALIYUN.md` with a short pointer to the root README
- Modify if needed: `.env.example`

- [ ] Rewrite feature and directory descriptions for the AI-only product; remove Python/Hhstu, login/friend/Socket.IO, and unused tree packaging instructions.
- [ ] In every PowerShell deployment block, check `$LASTEXITCODE` immediately after `npm ci`, tests, lint, build, and archive commands.
- [ ] Reject `public/audios`, `public/uploads`, `dist/audios`, `dist/uploads`, and `dist/videos` both before archiving and by inspecting archive entry names.
- [ ] Restrict rollback IDs to `pre-<deploy-id>`, reject `.`, `..`, and symlinks, and use `realpath` to prove rollback sources remain under the release root.
- [ ] Update audit counts, long-file/function tables, removed risk status, and fresh raw/gzip build numbers after the final build.
- [ ] Run fresh verification in this order:

```powershell
npm test -- --run
npm run lint
npm run build
```

- [ ] Run UTF-8/mojibake, credential-pattern, removed-feature reference, forbidden build-media, cache/gzip, and isolated-data smoke checks without reading secrets or user data.
- [ ] Start the local server with isolated temporary `STORAGE_DIR`, `DATA_FILE`, `AUDIO_DIR`, `UPLOAD_DIR`, and `VIDEO_DIR`; verify AI health/session/chat/task/static/media behavior and removed routes.
- [ ] Use browser automation at desktop and a real 390x844 mobile viewport; verify the AI chat is visible, no horizontal overflow or overlap exists, and there are no login, friend, profile, Hhstu, sticker, or friend video-call controls.

## Self-Review

- Spec coverage: AI behavior retention is covered by Tasks 1-4 and final smoke/browser checks; social removal is covered by Tasks 3-4; Hhstu extraction is covered by Task 5; deployment/docs are covered by Task 6.
- No destructive data migration: legacy JSON social records remain opaque; source trees are moved or backed up, not silently discarded.
- Type consistency: all frontend AI calls use the same `AiOwner` XOR shape already exported by the API client.
- External compatibility: AI HTTP paths, request/response shapes, provider models, media URLs, and legacy owner IDs remain unchanged.

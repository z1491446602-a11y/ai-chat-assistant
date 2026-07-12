# Chat Performance And Maintainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce first-screen blocking and transferred code, repair corrupted user-facing text, remove unreachable frontend code, and clarify service/static-delivery boundaries without changing any public HTTP route or response shape.

**Architecture:** Keep the existing React/Vite, Express, Socket.IO, and AI-task polling architecture. Apply an incremental refactor: move heavy Markdown/Mermaid rendering behind lazy boundaries, isolate static-delivery policy, split the active frontend API client by domain, and delete only files proven unreachable from `src/main.tsx`. Security and database migrations remain a separate compatibility project because adding authentication tokens or changing persistence would alter client/server contracts.

**Tech Stack:** React 18, TypeScript, Vite 5, Zustand, Express 4, Socket.IO, Undici, Vitest, Testing Library, Nginx, systemd.

---

## Target File Structure

```text
src/
  components/Chat/
    MarkdownContent.tsx       # Lazy Markdown HTML, copy actions, Mermaid enhancement
    MarkdownContent.test.tsx
    MessageBubble.tsx         # Message layout only
  services/
    api.ts                    # Compatibility barrel; preserves all active import paths
    aiTasksApi.ts             # AI sessions, task submit/poll/cancel, transcription
    hhstuApi.ts               # Hhstu contracts and requests
    http.ts                   # Shared fetch retry/error helpers
  utils/
    mermaidLoader.ts          # Cached dynamic Mermaid import and one-time setup
    mermaidLoader.test.ts
server/
  staticDelivery.js           # Cache and compression policy
tests/
  server/staticDelivery.test.js
  sourceReachability.test.js
  sourceTextQuality.test.js
docs/
  PROJECT_AUDIT.md
README.md
```

The existing API endpoints remain unchanged, including `/api/ai-task/chat`, `/api/ai-task/:taskId`, `/api/chat`, `/api/ai-sessions/*`, `/api/image-generation`, social routes, upload routes, and Socket.IO events.

### Task 1: Lock And Repair Source Encoding

**Files:**
- Create: `tests/sourceTextQuality.test.js`
- Create: `.editorconfig`
- Modify: `server.js`
- Modify: `server/aiSessions.js`
- Modify: `src/components/Chat/MessageBubble.tsx`
- Modify: `src/components/Social/FriendChat.tsx`
- Modify: `src/services/api.ts` (or the destination modules created in Task 4)

- [ ] **Step 1: Add the failing UTF-8/mojibake regression test**

```js
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.md', '.py', '.yml', '.yaml']);
const SKIPPED = new Set(['node_modules', '.codex_deps', 'dist', 'workspace-artifacts', 'storage', 'dydownload-main', 'hhstu', '__pycache__']);
const MOJIBAKE = /[\uE000-\uF8FF\uFFFD]|锟斤拷|鏂囦欢|鍥剧墖|鐢熸垚鍥|璇锋眰澶辫触|杩炴帴鎴愬姛|娌℃湁鏉冮檺|姝ｅ湪璇磋瘽|娴佺▼鍥|宸插悜/;

function collectTextFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED.has(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectTextFiles(filePath, result);
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) result.push(filePath);
  }
  return result;
}

describe('source text quality', () => {
  it('contains no replacement, private-use, or known mojibake text', () => {
    const failures = collectTextFiles(ROOT).flatMap((filePath) =>
      fs.readFileSync(filePath, 'utf8').split(/\r?\n/).flatMap((line, index) =>
        MOJIBAKE.test(line) ? [`${path.relative(ROOT, filePath)}:${index + 1}`] : [],
      ),
    );
    expect(failures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/sourceTextQuality.test.js`

Expected: FAIL listing the currently corrupted lines in the five first-party source files.

- [ ] **Step 3: Replace only reliably recoverable text and add UTF-8 editor policy**

Use the reversible GBK-to-UTF-8 mapping and the older sibling source only as evidence. Examples include `鏂囦欢 -> 文件`, `鍥剧墖 -> 图片`, `璇锋眰澶辫触 -> 请求失败`, `姝ｅ湪璇磋瘽涓?.. -> 正在说话中...`, and the malformed Mermaid error HTML -> `流程图渲染失败</div>`. Preserve identifiers, API payloads, and control flow.

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true

[*.{js,jsx,ts,tsx,json,css,html,md}]
indent_style = space
indent_size = 2
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/sourceTextQuality.test.js`

Expected: PASS.

### Task 2: Remove The Artificial Startup Wait And Lazy-Load Heavy Renderers

**Files:**
- Create: `src/App.test.tsx`
- Create: `src/components/Chat/MarkdownContent.tsx`
- Create: `src/components/Chat/MarkdownContent.test.tsx`
- Create: `src/utils/mermaidLoader.ts`
- Create: `src/utils/mermaidLoader.test.ts`
- Create: `src/store/chatPersistence.ts`
- Create: `src/store/chatPersistence.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/components/Chat/MessageBubble.tsx`
- Modify: `src/store/chatStore.ts`
- Modify: `index.html`

- [ ] **Step 1: Add a failing App startup test**

Mock the service calls and lazy child screens, render `<App />`, and assert the primary AI screen is available without waiting for `Image.onload` or the one-second timeout. Current code must fail because `isLoading` gates the whole app on `/background.jpg`.

- [ ] **Step 2: Run the App test and verify RED**

Run: `npm test -- src/App.test.tsx`

Expected: FAIL because the loading-only screen is rendered first.

- [ ] **Step 3: Remove the unused background gate**

Delete `isLoading` and the effect that creates `new Image()` from `App.tsx`; remove the loading-only return. Remove the duplicate `/background.jpg` preload from `index.html`. Do not alter the active screen, session sync, auth modal, or lazy `FriendChat`/`MePage` imports.

- [ ] **Step 4: Add failing tests for the new lazy rendering boundary**

`MarkdownContent.test.tsx` must assert Markdown output, script/event-handler sanitization, and copy-button behavior. `mermaidLoader.test.ts` must mock `mermaid`, call `loadMermaid()` twice, and assert dynamic initialization happens once. Add a MessageBubble assertion that streaming `**text**` remains escaped plain text while the completed message renders Markdown.

- [ ] **Step 5: Run both tests and verify RED**

Run: `npm test -- src/components/Chat/MarkdownContent.test.tsx src/utils/mermaidLoader.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 6: Implement the lazy modules and simplify MessageBubble**

`MarkdownContent.tsx` owns sanitized `renderMarkdown`, delegated copy handling, and Mermaid-block enhancement. `mermaidLoader.ts` caches `import('mermaid')` and initializes it once. `MessageBubble.tsx` uses escaped plain text while `isStreaming` is true; only completed content uses `lazy(() => import('./MarkdownContent'))` with a plain-text Suspense fallback. Move `katex/dist/katex.min.css` from `main.tsx` into `MarkdownContent.tsx` so KaTeX CSS/fonts follow the lazy chunk. Use DOMPurify on the generated Markdown HTML before `dangerouslySetInnerHTML`.

- [ ] **Step 7: Stop streaming updates from synchronously rewriting full localStorage history**

Add `chatPersistence.ts` with a pure `toPersistedChatState` function and a deduplicating `StateStorage` wrapper. While a session contains a streaming message, persist only stable/non-streaming messages and a stable `updatedAt`; the server remains the source of truth and restores pending tasks on reload. Test that two different partial streaming contents serialize to the same persisted value and that the completed value is persisted.

- [ ] **Step 8: Avoid duplicate background session sync while active or hidden**

Keep the existing four-second compatibility poll, but skip the timer callback while `isStreaming` is true or `document.visibilityState !== 'visible'`; trigger one refresh when the document becomes visible. This removes overlapping full-session requests during task polling without changing any API.

- [ ] **Step 9: Make Google Fonts non-render-blocking**

Keep the same font stylesheet URL but load it with `media="print"` and `onload="this.media='all'"`, plus an equivalent `<noscript>` fallback. This preserves eventual typography while preventing an unreachable Google Fonts host from blocking first paint in mainland China.

- [ ] **Step 10: Verify tests and record bundle delta**

Run: `npm test -- src/App.test.tsx src/components/Chat/MarkdownContent.test.tsx src/utils/mermaidLoader.test.ts src/store/chatPersistence.test.ts`

Run: `npm run build`

Expected: tests PASS; `FriendChat-*.js` no longer statically includes Mermaid, and Markdown/KaTeX are not dependencies of a new empty-chat first screen.

### Task 3: Correct Static Caching, Compression, And SSE Proxying

**Files:**
- Create: `server/staticDelivery.js`
- Create: `tests/server/staticDelivery.test.js`
- Modify: `server.js`
- Modify: `server/aiProviders.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `deploy/server/nginx.conf`

- [ ] **Step 1: Add the failing cache/compression policy test**

```js
import { describe, expect, it } from 'vitest';
import { getCacheControl, shouldCompressResponse } from '../../server/staticDelivery.js';

describe('static delivery policy', () => {
  it('caches hashed assets immutably and HTML as no-store', () => {
    expect(getCacheControl('/assets/index-AbC123.js')).toBe('public, max-age=31536000, immutable');
    expect(getCacheControl('/index.html')).toBe('no-store, no-cache, must-revalidate');
  });

  it('does not compress event streams', () => {
    expect(shouldCompressResponse('text/event-stream')).toBe(false);
    expect(shouldCompressResponse('application/json')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/server/staticDelivery.test.js`

Expected: FAIL because `server/staticDelivery.js` does not exist.

- [ ] **Step 3: Add Express compression and static policy**

Install `compression` with the existing package manager. Mount it before JSON/static middleware, using the exported content-type filter. Apply one-year immutable caching only to existing Vite-hashed `/assets/*`; keep HTML no-store and the old-hash compatibility fallback no-cache.

- [ ] **Step 4: Preserve streaming through proxies**

Set `X-Accel-Buffering: no` in `streamResponse`. Add Nginx gzip settings for JSON/JS/CSS/SVG/text, `gzip_vary on`, and `proxy_buffering off` under `/api/`. Increase `client_max_body_size` to `35m`, matching the app's 20 MiB decoded attachment after base64 expansion.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/server/staticDelivery.test.js`

Expected: PASS.

### Task 4: Remove Proven Dead Frontend Modules And Split The Active API Client

**Files:**
- Create: `tests/sourceReachability.test.js`
- Create: `src/services/http.ts`
- Create: `src/services/hhstuApi.ts`
- Create: `src/services/aiTasksApi.ts`
- Modify: `src/services/api.ts`
- Delete: unreachable Settings, Sidebar, legacy social-list wrappers, `src/services/index.ts`, and `src/utils/apiCache.ts` files reported by the module graph

- [ ] **Step 1: Add a failing module-reachability test**

Use the TypeScript compiler API to follow static imports, re-exports, and literal dynamic imports from `src/main.tsx`. Ignore `*.test.*` and declaration files. Assert no runtime source module is unreachable.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/sourceReachability.test.js`

Expected: FAIL with the current unreachable modules, including Settings, Sidebar, `AIPhoneCall.tsx`, `AddFriendModal.tsx`, `AiHistorySidebar.tsx`, `BottomTab.tsx`, `FriendList.tsx`, social `MessageList.tsx`, `services/index.ts`, and `utils/apiCache.ts`.

- [ ] **Step 3: Delete only modules absent from the runtime graph**

Do not delete `ChatInput.tsx` because it is part of the reachable Chat barrel, and do not delete `vite-env.d.ts` because it is a compiler declaration rather than a runtime module.

- [ ] **Step 4: Split active APIs and remove unused browser-direct clients**

Move Hhstu contracts/requests to `hhstuApi.ts`; move AI owner/task contracts plus session/task/transcription requests to `aiTasksApi.ts`; move the single network retry helper to `http.ts`. Convert `api.ts` into a compatibility barrel that re-exports the same active names used by the app. Remove the runtime-unreachable browser-direct `sendMessage`, `testConnection`, and `generateImage` implementations; keep the server's `/api/chat` and `/api/image-generation` routes unchanged for external compatibility.

- [ ] **Step 5: Verify reachability, types, and behavior**

Run: `npm test -- tests/sourceReachability.test.js`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands PASS; `src/services/api.ts` is a small stable barrel and no public server route changes.

### Task 5: Protect Local Secrets And Deliver Operational Documentation

**Files:**
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `deploy/server/hello-kitty-chat.service`
- Create: `README.md`
- Create: `docs/PROJECT_AUDIT.md`

- [ ] **Step 1: Expand ignore rules without deleting runtime data**

Ignore `.deploy-certs/`, `.codex_deps/`, `.superpowers/`, `storage/`, root `data.json`, `__pycache__/`, `*.pyc`, and all `workspace-artifacts/`. Ignore generated `public/audios/` and `public/uploads/` for future additions, but do not remove existing files because saved chat history may reference them.

- [ ] **Step 2: Complete the environment template**

Add placeholder-only `BOCHA_WEB_SEARCH_API_URL`, `BOCHA_WEB_SEARCH_API_KEY`, and `BOCHA_WEB_SEARCH_COUNT` entries. Never copy values from `.env` into docs, examples, tests, logs, or commits.

- [ ] **Step 3: Make systemd configuration environment-driven**

Remove duplicated upstream URL/model values from the service unit, retain `EnvironmentFile=-/www/wwwroot/chat-app/.env`, and document creating a non-login `chatapp` user that owns the application/storage paths. Do not embed passwords or tokens.

- [ ] **Step 4: Write the root README and audit report**

README covers local install/run/test/build, `.env` setup, Aliyun upload, Nginx, systemd, log inspection, rollback from the local source snapshot, and deployment verification. `docs/PROJECT_AUDIT.md` contains the first-party tree, generated/third-party directory counts, request/data map, measured baseline bundle sizes, >300-line files, >80-line functions, encoding findings, compatibility risks, and a prioritized follow-up list for authentication, password migration, database storage, task concurrency/TTL/idempotency, and pagination.

### Task 6: Full Verification

**Files:**
- Verify all modified files and regenerated `dist/`

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test -- --run`

Expected: all test files and tests PASS.

- [ ] **Step 2: Run static analysis**

Run: `npm run lint`

Expected: exit 0 with no ESLint output.

- [ ] **Step 3: Run production compilation**

Run: `npm run build`

Expected: TypeScript and Vite exit 0. Record before/after raw and gzip sizes of the entry, FriendChat, Markdown, Mermaid-related, CSS, vendor, and UI chunks.

- [ ] **Step 4: Run the server smoke check from the canonical Windows path**

Start `node server.js` on an unused local port, request `/api/health`, `/`, and a built hashed asset with gzip accepted, then stop the process. Verify health 200, HTML no-store, hashed asset immutable, and compressed text response where applicable.

- [ ] **Step 5: Re-run strict encoding and secret-name scans**

Expected: no known mojibake/replacement/private-use characters in first-party text; no real secret value appears outside `.env`; `.env` itself remains ignored and untouched.

## Deferred Compatibility Projects

These are critical but intentionally not mixed into this behavior-preserving pass:

1. Add signed sessions/JWT and object-level authorization to every user/session/task/socket route.
2. Migrate plaintext passwords to Argon2id or scrypt with transparent legacy-password upgrade.
3. Replace synchronous whole-file JSON persistence with SQLite/PostgreSQL and paginated message/session queries.
4. Add per-user/provider task queues, bounded concurrency, terminal-task TTL, idempotency keys, and explicit total timeouts.
5. Move base64 media out of session JSON and correct multimodal payload construction for provider-specific protocols.

No Git commits are included because the target directory has no `.git` repository. The verified local source snapshot under `workspace-artifacts/backups/` is the rollback checkpoint for this pass.

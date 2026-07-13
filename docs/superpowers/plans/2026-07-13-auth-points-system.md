# Authentication And Points System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure phone/password accounts, server-authoritative chat history, points and redemption codes, media-task billing, Chinese public errors, and deploy the result without changing ordinary guest chat.

**Architecture:** Keep the existing single-process Node/Express deployment and JSON data store, but add explicit auth and points services with hashed passwords, hashed session tokens, integer point units, reservations, and an audit ledger. Authenticated identity comes only from an HttpOnly cookie; request-body `userId` is never trusted. The browser keeps only a bounded lightweight cache while the server remains authoritative for account history.

**Tech Stack:** Node.js 20 `crypto.scrypt`, Express, React 18, Zustand, Vitest, existing atomic JSON storage, systemd/Nginx deployment.

---

### Task 1: Authentication Domain

**Files:**
- Create: `server/authService.js`
- Create: `tests/server/authService.test.js`
- Modify: `server/storage.js`

- [x] **Step 1: Write failing tests for registration, login, cookies and password hashing**

```js
const user = await auth.register({ phone: '13800138000', password: 'password1', realName: '张三' });
expect(user).toMatchObject({ phone: '13800138000', realName: '张三', role: 'user' });
expect(JSON.stringify(data)).not.toContain('password1');
await expect(auth.login({ phone: user.phone, password: 'password1' })).resolves.toHaveProperty('token');
```

- [x] **Step 2: Run `npm test -- tests/server/authService.test.js` and verify missing-module failure**
- [x] **Step 3: Implement scrypt password hashes, unique phone validation, real-name validation, random session tokens, SHA-256 token storage and expiry pruning**
- [x] **Step 4: Extend empty/normalized storage with `users`, `authSessions`, `redeemCodes`, `pointReservations`, and `pointTransactions`**
- [x] **Step 5: Re-run the targeted test and verify it passes**

### Task 2: Points, Reservations And Redemption Codes

**Files:**
- Create: `server/pointsService.js`
- Create: `tests/server/pointsService.test.js`

- [x] **Step 1: Write failing tests for integer point units and reservation settlement**

```js
points.credit(userId, 20, 'redeem');
points.reserve({ taskId: 'image-1', userId, costUnits: 2, taskType: 'image' });
expect(points.getBalance(userId)).toEqual({ balanceUnits: 20, availableUnits: 18 });
points.settle('image-1', true);
expect(points.getBalance(userId).balanceUnits).toBe(18);
```

- [x] **Step 2: Verify tests fail because the service does not exist**
- [x] **Step 3: Implement costs `gpt=2`, `grok=1`, `video=15`, insufficient-balance rejection, success debit, failure release and capped audit records**
- [x] **Step 4: Implement cryptographically random 8-character mixed-case alphanumeric codes, store only code hashes, enforce one-time atomic redemption, and mask admin listings**
- [x] **Step 5: Verify targeted tests pass**

### Task 3: Auth And Points HTTP APIs

**Files:**
- Create: `server/authRoutes.js`
- Create: `tests/server/authRoutes.test.js`
- Modify: `server.js`
- Modify: `server/config.js`
- Modify: `.env.example`

- [x] **Step 1: Write failing route tests for register/login/logout/me/redeem/admin code generation and role enforcement**
- [x] **Step 2: Implement HttpOnly `Secure`/`SameSite=Lax` cookie handling and in-memory IP rate limits**
- [x] **Step 3: Seed the administrator from `ADMIN_PHONE` and `ADMIN_BOOTSTRAP_PASSWORD`; never put the password in tracked files**
- [x] **Step 4: Register `/api/auth/*`, `/api/points/redeem`, and `/api/admin/redeem-codes` routes before AI routes**
- [x] **Step 5: Verify route tests pass**

### Task 4: Server-Side Ownership And Media Billing

**Files:**
- Modify: `server/aiRoutes.js`
- Modify: `server/aiTasks.js`
- Modify: `server/videoJobs.js`
- Modify: `tests/server/aiTasks.test.js`
- Create: `tests/server/aiAccessBilling.test.js`

- [x] **Step 1: Write failing tests proving guests can chat but receive 401 for image/video, and body `userId` cannot impersonate another account**
- [x] **Step 2: Resolve authenticated users from the cookie on every session/task route; guests may use only a guest identifier**
- [x] **Step 3: Reserve points before image/video task creation and return 402 when available units are insufficient**
- [x] **Step 4: Inject task settlement so completed tasks debit once while failed, cancelled, queue-rejected and orphaned tasks release reservations**
- [x] **Step 5: Reconcile reservations on startup, preserving only recoverable video jobs**
- [x] **Step 6: Verify billing and existing media-task tests pass**

### Task 5: Chinese Public AI Errors

**Files:**
- Create: `server/publicAiErrors.js`
- Create: `tests/server/publicAiErrors.test.js`
- Modify: `server/aiTasks.js`
- Modify: `server/aiRoutes.js`

- [x] **Step 1: Write failing mappings for unsafe content, policy rejection, rate limit, timeout, account pool, network failure and unknown English errors**

```js
expect(toPublicAiErrorMessage('The generated images appear to be unsafe', 'image'))
  .toBe('图片内容可能不符合安全规范，请调整描述后重试。');
```

- [x] **Step 2: Implement allowlisted Chinese mappings with a Chinese generic fallback while logging the original server-side**
- [x] **Step 3: Apply the mapper to asynchronous tasks and legacy image responses**
- [x] **Step 4: Verify no raw upstream English error reaches task polling**

### Task 6: Browser Auth And Account UI

**Files:**
- Create: `src/services/authApi.ts`
- Create: `src/components/Auth/AccountDialog.tsx`
- Create: `src/components/Auth/AccountDialog.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AiChat/AiChat.tsx`
- Modify: `src/components/AiChat/AiChatHeader.tsx`
- Modify: `src/components/AiChat/AiChatComposerAttachments.tsx`

- [x] **Step 1: Write failing UI/service tests for login, registration, points, redemption, admin generation, logout and login-required media actions**
- [x] **Step 2: Implement typed same-origin auth/points API calls**
- [x] **Step 3: Add a compact account control without disturbing the centered chat title**
- [x] **Step 4: Add login/register and authenticated account views; admin-only code controls accept positive decimal points and show the generated code once**
- [x] **Step 5: Keep ordinary guest chat enabled; intercept GPT/Grok/video selection and generation with the login dialog**
- [x] **Step 6: On login/logout switch AI owner, clear the visible store, and sync the correct server history**

### Task 7: Bounded Local Cache And Server History

**Files:**
- Modify: `src/store/chatPersistence.ts`
- Modify: `src/store/chatPersistence.test.ts`
- Modify: `src/App.tsx`

- [x] **Step 1: Write failing tests that reject streaming messages, embedded `data:` media and unbounded history from persisted state**
- [x] **Step 2: Persist at most 20 sessions and 50 stable messages per session, stripping embedded image/audio data while keeping server URLs**
- [x] **Step 3: Keep server sync authoritative and retain “clear local cache” only as a recovery control, not a routine requirement**
- [x] **Step 4: Verify cache tests and cross-device owner switching pass**

### Task 8: Verification And Aliyun Deployment

**Files:**
- Modify: `deploy/server/DEPLOY_ALIYUN.md`
- Modify: `deploy/server/hello-kitty-chat.service`

- [x] **Step 1: Run `npm test`, `npm run lint`, and `npm run build`; require zero failures**
- [x] **Step 2: Review `git diff --check`, secret scans and generated output**
- [ ] **Step 3: Back up the live release and persistent data, upload a timestamped release, preserve `.env`/storage symlinks, add admin bootstrap secrets with mode 600, and atomically switch the symlink**
- [ ] **Step 4: Restart `hello-kitty-chat.service`, verify `/api/health`, guest chat access, auth registration/login, protected media rejection, admin login/code generation, one-time redemption and Chinese errors without calling paid generation APIs**
- [ ] **Step 5: Inspect service logs, CPU/RSS and Nginx 4xx/5xx after deployment; roll back the symlink if any smoke check fails**

---

**Security decision:** Real name is stored for administrator-assisted identity verification only. Self-service password reset is intentionally not implemented without an SMS verification provider because phone plus real name is not a secure proof of account ownership.

**Execution:** The user explicitly requested implementation and deployment, so this plan will be executed inline in the current session without a separate handoff pause.

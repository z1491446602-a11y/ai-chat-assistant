import fs from 'node:fs/promises';
import { WebSocket } from 'undici';

const [debugPort, pageUrl, screenshotPath, widthArg = '390', heightArg = '844'] = process.argv.slice(2);
const viewportWidth = Number(widthArg);
const viewportHeight = Number(heightArg);
const adminPhone = String(process.env.SMOKE_ADMIN_PHONE || '').trim();
const adminPassword = String(process.env.SMOKE_ADMIN_PASSWORD || '');

if (!debugPort || !pageUrl || !screenshotPath || !viewportWidth || !viewportHeight) {
  throw new Error('Usage: node scripts/browser-smoke.mjs <debug-port> <page-url> <screenshot-path> [width] [height]');
}

const targetResponse = await fetch(
  `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pageUrl)}`,
  { method: 'PUT' },
);
if (!targetResponse.ok) {
  throw new Error(`Failed to create Chrome target: ${targetResponse.status}`);
}

const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) {
    return;
  }
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) {
    reject(new Error(message.error.message));
  } else {
    resolve(message.result);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  }
  return result.result.value;
}

async function captureScreenshot(path) {
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await fs.writeFile(path, Buffer.from(screenshot.data, 'base64'));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: viewportWidth,
  height: viewportHeight,
  deviceScaleFactor: 1,
  mobile: true,
  screenWidth: viewportWidth,
  screenHeight: viewportHeight,
});
await send('Page.navigate', { url: pageUrl });

const deadline = Date.now() + 20_000;
let ready = false;
while (Date.now() < deadline) {
  ready = await evaluate(`document.readyState === 'complete'
    && Boolean(document.querySelector('textarea'))
    && Boolean(document.querySelector('[aria-label="登录或注册"]'))
    && document.body.innerText.includes('人工智障')
    && document.body.innerText.includes('有什么我能帮你的吗？')`);
  if (ready) {
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!ready) {
  throw new Error('AI chat UI did not become ready');
}

const initial = await evaluate(`(() => {
  const root = document.documentElement;
  const bodyText = document.body.innerText;
  const images = Array.from(document.images);
  const dailyHeading = Array.from(document.querySelectorAll('h2'))
    .find(heading => heading.textContent?.trim() === '有什么我能帮你的吗？');
  const dailyButtons = dailyHeading?.nextElementSibling?.querySelectorAll('button') || [];
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    hasHorizontalOverflow: root.scrollWidth > root.clientWidth,
    hasTextarea: Boolean(document.querySelector('textarea')),
    hasMenuButton: Boolean(document.querySelector('[aria-label="打开侧边栏"]')),
    hasGuestAccountEntry: Boolean(document.querySelector('[aria-label="登录或注册"]')),
    dailyTopicCount: dailyButtons.length,
    imagesLoaded: images.every(image => image.complete && image.naturalWidth > 0),
    forbiddenLabels: ['智慧黄科', '添加好友', 'AI 通话'].filter(label => bodyText.includes(label)),
  };
})()`);

if (
  initial.innerWidth !== viewportWidth
  || initial.innerHeight !== viewportHeight
  || initial.hasHorizontalOverflow
  || !initial.hasTextarea
  || !initial.hasMenuButton
  || !initial.hasGuestAccountEntry
  || initial.dailyTopicCount < 4
  || !initial.imagesLoaded
  || initial.forbiddenLabels.length
) {
  throw new Error(`Mobile UI assertion failed: ${JSON.stringify(initial)}`);
}

await captureScreenshot(screenshotPath);

const actionScreenshotPath = screenshotPath.replace(/\.png$/i, '-actions.png');
const accountScreenshotPath = screenshotPath.replace(/\.png$/i, '-account.png');
const sidebarScreenshotPath = screenshotPath.replace(/\.png$/i, '-sidebar.png');
const providerScreenshotPath = screenshotPath.replace(/\.png$/i, '-provider.png');
const narrowScreenshotPath = screenshotPath.replace(/\.png$/i, '-320.png');

const accountDialog = await evaluate(`(() => {
  document.querySelector('[aria-label="登录或注册"]')?.click();
  return new Promise(resolve => setTimeout(() => {
    const dialog = document.querySelector('[role="dialog"]');
    resolve({
      visible: Boolean(dialog && dialog.getClientRects().length),
      name: dialog?.querySelector('h2')?.textContent?.trim() || '',
      hasLoginTab: Boolean(dialog?.querySelector('[role="tab"][aria-selected="true"]')),
      hasPhoneInput: Boolean(dialog?.querySelector('input[type="tel"]')),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    });
  }, 150));
})()`);

if (!accountDialog.visible || accountDialog.name !== '账户' || !accountDialog.hasLoginTab || !accountDialog.hasPhoneInput || accountDialog.overflow) {
  throw new Error(`Guest account dialog assertion failed: ${JSON.stringify(accountDialog)}`);
}
await captureScreenshot(accountScreenshotPath);
await evaluate(`document.querySelector('[aria-label="关闭账户窗口"]')?.click()`);

const actionMenu = await evaluate(`(() => {
  document.querySelector('[aria-label="更多操作"]')?.click();
  return new Promise(resolve => setTimeout(() => {
    const uploadButton = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '上传图片');
    const menu = uploadButton?.parentElement;
    const style = menu ? getComputedStyle(menu) : null;
    resolve({
      visible: Boolean(menu && menu.getClientRects().length),
      backgroundColor: style?.backgroundColor || '',
      zIndex: style?.zIndex || '',
    });
  }, 150));
})()`);

if (!actionMenu.visible || actionMenu.backgroundColor !== 'rgb(255, 255, 255)' || actionMenu.zIndex !== '40') {
  throw new Error(`Attachment menu assertion failed: ${JSON.stringify(actionMenu)}`);
}
await captureScreenshot(actionScreenshotPath);

const sidebar = await evaluate(`(() => {
  document.querySelector('[aria-label="打开侧边栏"]')?.click();
  return new Promise(resolve => setTimeout(() => resolve({
    closeButton: Boolean(document.querySelector('[aria-label="关闭侧边栏"]')),
    historyVisible: document.body.innerText.includes('历史对话'),
    attachmentMenuVisible: Array.from(document.querySelectorAll('button'))
      .some(button => button.textContent?.trim() === '上传图片'),
    accountEntryVisible: Boolean(document.querySelector('[aria-label="登录或注册"]')),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }), 400));
})()`);

if (!sidebar.closeButton || !sidebar.historyVisible || sidebar.attachmentMenuVisible || sidebar.accountEntryVisible || sidebar.overflow) {
  throw new Error(`Sidebar assertion failed: ${JSON.stringify(sidebar)}`);
}
await captureScreenshot(sidebarScreenshotPath);

const providerMenu = await evaluate(`(() => {
  document.querySelector('[aria-label="关闭侧边栏"]')?.click();
  return new Promise(resolve => setTimeout(() => {
    document.querySelector('[aria-label="选择图片生成模型"]')?.click();
    setTimeout(() => {
      const grokButton = Array.from(document.querySelectorAll('button'))
        .find(button => button.textContent?.trim() === '生成图片-Grok');
      resolve({
        providerMenuVisible: Boolean(grokButton?.parentElement?.getClientRects().length),
        accountDialogVisible: Boolean(document.querySelector('[role="dialog"]')?.getClientRects().length),
      });
    }, 150);
  }, 400));
})()`);

if (providerMenu.providerMenuVisible || !providerMenu.accountDialogVisible) {
  throw new Error(`Guest media-gate assertion failed: ${JSON.stringify(providerMenu)}`);
}
await captureScreenshot(providerScreenshotPath);

await evaluate(`document.querySelector('[aria-label="关闭账户窗口"]')?.click()`);
await send('Emulation.setDeviceMetricsOverride', {
  width: 320,
  height: viewportHeight,
  deviceScaleFactor: 1,
  mobile: true,
  screenWidth: 320,
  screenHeight: viewportHeight,
});
await new Promise(resolve => setTimeout(resolve, 250));

const narrow = await evaluate(`(() => {
  const root = document.documentElement;
  const labels = ['更多操作', '生成图片-GPT', '选择图片生成模型', '生成视频', '语音输入', '发送'];
  const controls = labels.map(label => {
    const element = document.querySelector('[aria-label="' + label + '"]');
    const rect = element?.getBoundingClientRect();
    return {
      label,
      visible: Boolean(element && element.getClientRects().length),
      left: rect?.left ?? null,
      right: rect?.right ?? null,
      withinViewport: Boolean(rect && rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5),
    };
  });
  const sidebarToggle = document.querySelector('[aria-label="打开侧边栏"]')?.getBoundingClientRect();
  const accountEntry = document.querySelector('[aria-label="登录或注册"]')?.getBoundingClientRect();
  const headerControlsOverlap = Boolean(sidebarToggle && accountEntry
    && sidebarToggle.left < accountEntry.right
    && sidebarToggle.right > accountEntry.left
    && sidebarToggle.top < accountEntry.bottom
    && sidebarToggle.bottom > accountEntry.top);
  return {
    innerWidth: window.innerWidth,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    hasHorizontalOverflow: root.scrollWidth > root.clientWidth,
    headerControlsOverlap,
    controls,
  };
})()`);

if (
  narrow.innerWidth !== 320
  || narrow.hasHorizontalOverflow
  || narrow.headerControlsOverlap
  || narrow.controls.some(control => !control.visible || !control.withinViewport)
) {
  throw new Error(`320px media-control assertion failed: ${JSON.stringify(narrow)}`);
}
await captureScreenshot(narrowScreenshotPath);

let adminDialog = null;
let adminScreenshotPath = null;
if (adminPhone && adminPassword) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: viewportWidth,
    screenHeight: viewportHeight,
  });
  const loginResult = await evaluate(`fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: ${JSON.stringify(JSON.stringify({ phone: adminPhone, password: adminPassword }))},
  }).then(async response => ({ ok: response.ok, status: response.status, body: await response.json() }))`);
  if (!loginResult.ok || loginResult.body?.user?.role !== 'admin') {
    throw new Error(`Admin login assertion failed: ${JSON.stringify({
      ok: loginResult.ok,
      status: loginResult.status,
      role: loginResult.body?.user?.role || '',
    })}`);
  }

  await send('Page.reload', { ignoreCache: true });
  let adminReady = false;
  const adminDeadline = Date.now() + 10_000;
  while (Date.now() < adminDeadline) {
    adminReady = await evaluate(`document.readyState === 'complete'
      && Array.from(document.querySelectorAll('button[aria-label]'))
        .some(button => button.getAttribute('aria-label')?.startsWith('账户，当前可用'))`);
    if (adminReady) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!adminReady) {
    throw new Error('Authenticated admin UI did not become ready');
  }

  adminDialog = await evaluate(`(() => {
    const accountButton = Array.from(document.querySelectorAll('button[aria-label]'))
      .find(button => button.getAttribute('aria-label')?.startsWith('账户，当前可用'));
    accountButton?.click();
    return new Promise(resolve => setTimeout(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog?.textContent || '';
      const controls = Array.from(dialog?.querySelectorAll('button, input') || [])
        .filter(element => element.getClientRects().length)
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
      resolve({
        visible: Boolean(dialog && dialog.getClientRects().length),
        hasBalance: text.includes('可用积分'),
        hasRedeem: text.includes('兑换积分'),
        hasAdminCode: text.includes('生成兑换码'),
        hasPasswordReset: text.includes('重置用户密码'),
        controlsMeetTouchTarget: controls.every(control => control.width >= 43.5 && control.height >= 43.5),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      });
    }, 200));
  })()`);
  if (
    !adminDialog.visible
    || !adminDialog.hasBalance
    || !adminDialog.hasRedeem
    || !adminDialog.hasAdminCode
    || !adminDialog.hasPasswordReset
    || !adminDialog.controlsMeetTouchTarget
    || adminDialog.overflow
  ) {
    throw new Error(`Admin account dialog assertion failed: ${JSON.stringify(adminDialog)}`);
  }
  adminScreenshotPath = screenshotPath.replace(/\.png$/i, '-admin.png');
  await captureScreenshot(adminScreenshotPath);
  await evaluate(`fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })`);
}

console.log(JSON.stringify({
  initial,
  accountDialog,
  actionMenu,
  sidebar,
  providerMenu,
  narrow,
  adminDialog,
  adminScreenshotPath,
  screenshotPath,
  accountScreenshotPath,
  actionScreenshotPath,
  sidebarScreenshotPath,
  providerScreenshotPath,
  narrowScreenshotPath,
}));
socket.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);

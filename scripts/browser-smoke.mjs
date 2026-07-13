import fs from 'node:fs/promises';
import { WebSocket } from 'undici';

const [debugPort, pageUrl, screenshotPath, widthArg = '390', heightArg = '844'] = process.argv.slice(2);
const viewportWidth = Number(widthArg);
const viewportHeight = Number(heightArg);

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
    dailyTopicCount: dailyButtons.length,
    imagesLoaded: images.every(image => image.complete && image.naturalWidth > 0),
    removedLabels: ['登录 / 注册', '退出登录', '智慧黄科', '添加好友', 'AI 通话'].filter(label => bodyText.includes(label)),
  };
})()`);

if (
  initial.innerWidth !== viewportWidth
  || initial.innerHeight !== viewportHeight
  || initial.hasHorizontalOverflow
  || !initial.hasTextarea
  || !initial.hasMenuButton
  || initial.dailyTopicCount < 4
  || !initial.imagesLoaded
  || initial.removedLabels.length
) {
  throw new Error(`Mobile UI assertion failed: ${JSON.stringify(initial)}`);
}

await captureScreenshot(screenshotPath);

const actionScreenshotPath = screenshotPath.replace(/\.png$/i, '-actions.png');
const sidebarScreenshotPath = screenshotPath.replace(/\.png$/i, '-sidebar.png');
const providerScreenshotPath = screenshotPath.replace(/\.png$/i, '-provider.png');

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
    accountEntryVisible: document.body.innerText.includes('登录 / 注册')
      || document.body.innerText.includes('我的'),
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
      const menu = grokButton?.parentElement;
      const style = menu ? getComputedStyle(menu) : null;
      const selected = menu?.querySelector('[aria-pressed="true"]');
      resolve({
        visible: Boolean(menu && menu.getClientRects().length),
        backgroundColor: style?.backgroundColor || '',
        zIndex: style?.zIndex || '',
        selectedLabel: selected?.textContent?.trim() || '',
      });
    }, 150);
  }, 400));
})()`);

if (!providerMenu.visible || providerMenu.backgroundColor !== 'rgb(255, 255, 255)' || providerMenu.zIndex !== '40' || providerMenu.selectedLabel !== '生成图片-GPT') {
  throw new Error(`Image provider menu assertion failed: ${JSON.stringify(providerMenu)}`);
}
await captureScreenshot(providerScreenshotPath);

console.log(JSON.stringify({
  initial,
  actionMenu,
  sidebar,
  providerMenu,
  screenshotPath,
  actionScreenshotPath,
  sidebarScreenshotPath,
  providerScreenshotPath,
}));
socket.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);

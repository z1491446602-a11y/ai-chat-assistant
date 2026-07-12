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
    && document.body.innerText.includes('人工智障')`);
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
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    hasHorizontalOverflow: root.scrollWidth > root.clientWidth,
    hasTextarea: Boolean(document.querySelector('textarea')),
    hasMenuButton: Boolean(document.querySelector('[aria-label="打开侧边栏"]')),
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
  || !initial.imagesLoaded
  || initial.removedLabels.length
) {
  throw new Error(`Mobile UI assertion failed: ${JSON.stringify(initial)}`);
}

const screenshot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
});
await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));

const sidebar = await evaluate(`(() => {
  document.querySelector('[aria-label="打开侧边栏"]')?.click();
  return new Promise(resolve => setTimeout(() => resolve({
    closeButton: Boolean(document.querySelector('[aria-label="关闭侧边栏"]')),
    historyVisible: document.body.innerText.includes('历史对话'),
    accountEntryVisible: document.body.innerText.includes('登录 / 注册')
      || document.body.innerText.includes('我的'),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }), 400));
})()`);

if (!sidebar.closeButton || !sidebar.historyVisible || sidebar.accountEntryVisible || sidebar.overflow) {
  throw new Error(`Sidebar assertion failed: ${JSON.stringify(sidebar)}`);
}

console.log(JSON.stringify({ initial, sidebar, screenshotPath }));
socket.close();
await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`);

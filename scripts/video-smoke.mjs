import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const result = {
    baseUrl: 'http://127.0.0.1:3000',
    guestId: `video-smoke-${Date.now()}`,
    prompt: '',
    images: [],
  };

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`参数缺少值: ${key}`);
    }
    if (key === '--base-url') result.baseUrl = value.replace(/\/+$/, '');
    else if (key === '--guest-id') result.guestId = value;
    else if (key === '--prompt') result.prompt = value;
    else if (key === '--image') result.images.push(value);
    else throw new Error(`未知参数: ${key}`);
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
  throw new Error(`参考图只支持 PNG、JPEG 或 WebP: ${filePath}`);
}

async function toDataUrl(filePath) {
  const absolutePath = path.resolve(filePath);
  const buffer = await fs.readFile(absolutePath);
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error(`参考图超过 10 MB: ${absolutePath}`);
  }
  return `data:${getImageMimeType(absolutePath)};base64,${buffer.toString('base64')}`;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`接口返回非 JSON: HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const options = parseArgs(process.argv.slice(2));
const images = await Promise.all(options.images.map(toDataUrl));
const sessionResult = await requestJson(`${options.baseUrl}/api/ai-sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestId: options.guestId, model: 'seedance_1_5_pro_720p' }),
});
const createResult = await requestJson(`${options.baseUrl}/api/ai-task/video`, {
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
const timeoutAt = startedAt + 12 * 60 * 1000;
let lastStage = '';
let completedTask;
console.log(`task=${taskId}`);

while (Date.now() < timeoutAt) {
  const query = new URLSearchParams({ guestId: options.guestId });
  const result = await requestJson(
    `${options.baseUrl}/api/ai-task/${encodeURIComponent(taskId)}?${query.toString()}`,
  );
  const task = result.task;
  if (task.videoStage && task.videoStage !== lastStage) {
    lastStage = task.videoStage;
    console.log(`stage=${lastStage} elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`);
  }
  if (task.status === 'failed') throw new Error(task.error || '视频任务失败');
  if (task.status === 'completed') {
    completedTask = task;
    break;
  }
  await sleep(2500);
}

if (!completedTask) throw new Error('本地冒烟测试等待超时');
if (!completedTask.videoUrl || !completedTask.videoFileSize) {
  throw new Error('完成任务缺少本地视频字段');
}

const localVideoUrl = new URL(completedTask.videoUrl, options.baseUrl);
const head = await fetch(localVideoUrl, { method: 'HEAD' });
if (!head.ok) throw new Error(`本地视频 HEAD 失败: HTTP ${head.status}`);
if (!String(head.headers.get('content-type') || '').startsWith('video/mp4')) {
  throw new Error('本地视频 Content-Type 不是 video/mp4');
}
if (Number(head.headers.get('content-length') || 0) !== completedTask.videoFileSize) {
  throw new Error('本地视频字节数与任务元数据不一致');
}

const range = await fetch(localVideoUrl, { headers: { Range: 'bytes=0-1023' } });
if (range.status !== 206) throw new Error(`本地视频不支持 Range: HTTP ${range.status}`);
if ((await range.arrayBuffer()).byteLength <= 0) throw new Error('Range 响应为空');

console.log([
  'completed',
  `duration=${completedTask.videoDuration}`,
  `resolution=${completedTask.videoWidth}x${completedTask.videoHeight}`,
  `bytes=${completedTask.videoFileSize}`,
  `url=${completedTask.videoUrl}`,
].join(' '));

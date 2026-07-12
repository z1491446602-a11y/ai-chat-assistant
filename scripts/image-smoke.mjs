import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const result = {
    baseUrl: 'http://127.0.0.1:3000',
    guestId: `image-smoke-${Date.now()}`,
    provider: 'gpt',
    prompt: '',
    image: '',
    ratio: '',
  };

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === '--base-url') result.baseUrl = value.replace(/\/+$/, '');
    else if (key === '--guest-id') result.guestId = value;
    else if (key === '--provider') result.provider = value;
    else if (key === '--prompt') result.prompt = value;
    else if (key === '--image') result.image = value;
    else if (key === '--ratio') result.ratio = value;
    else throw new Error(`Unknown argument: ${key}`);
  }

  if (!['gpt', 'grok'].includes(result.provider)) throw new Error('--provider must be gpt or grok');
  if (!result.prompt.trim()) throw new Error('--prompt is required');
  return result;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function getImageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  }

  for (let index = 2; index + 9 < buffer.length;) {
    if (buffer[index] !== 0xFF) {
      index += 1;
      continue;
    }
    const marker = buffer[index + 1];
    const segmentLength = buffer.readUInt16BE(index + 2);
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      return [buffer.readUInt16BE(index + 7), buffer.readUInt16BE(index + 5)];
    }
    index += Math.max(2, segmentLength + 2);
  }

  throw new Error('Unsupported generated image format');
}

async function readImageDataUrl(filePath) {
  if (!filePath) return [];
  const absolutePath = path.resolve(filePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = extension === '.png' ? 'image/png' : (extension === '.webp' ? 'image/webp' : 'image/jpeg');
  const buffer = await fs.readFile(absolutePath);
  return [`data:${mimeType};base64,${buffer.toString('base64')}`];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const options = parseArgs(process.argv.slice(2));
const images = await readImageDataUrl(options.image);
const model = options.provider === 'grok' ? 'grok-imagine-image-quality' : 'gpt-image-2';
const sessionResult = await requestJson(`${options.baseUrl}/api/ai-sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestId: options.guestId, model }),
});
const createResult = await requestJson(`${options.baseUrl}/api/ai-task/image`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guestId: options.guestId,
    sessionId: sessionResult.session.id,
    prompt: options.prompt,
    images,
    imageProvider: options.provider,
  }),
});

const startedAt = Date.now();
const timeoutAt = startedAt + 7 * 60 * 1000;
let completedTask;
while (Date.now() < timeoutAt) {
  const query = new URLSearchParams({ guestId: options.guestId });
  const result = await requestJson(
    `${options.baseUrl}/api/ai-task/${encodeURIComponent(createResult.task.id)}?${query}`,
  );
  if (result.task.status === 'failed') throw new Error(result.task.error || 'Image task failed');
  if (result.task.status === 'completed') {
    completedTask = result.task;
    break;
  }
  await sleep(1200);
}

if (!completedTask?.images?.[0]) throw new Error('Image task did not complete');
const imageUrl = new URL(completedTask.images[0], options.baseUrl);
const response = await fetch(imageUrl);
if (!response.ok) throw new Error(`Generated image download failed: HTTP ${response.status}`);
const buffer = Buffer.from(await response.arrayBuffer());
const [width, height] = getImageDimensions(buffer);

if (options.ratio) {
  const [ratioWidth, ratioHeight] = options.ratio.split(':').map(Number);
  const expected = ratioWidth / ratioHeight;
  const actual = width / height;
  if (!Number.isFinite(expected) || Math.abs(Math.log(actual / expected)) > 0.035) {
    throw new Error(`Unexpected image ratio: ${width}x${height}, expected ${options.ratio}`);
  }
}

console.log([
  `provider=${options.provider}`,
  `mode=${images.length ? 'edit' : 'generate'}`,
  `elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`,
  `dimensions=${width}x${height}`,
  `bytes=${buffer.length}`,
  `url=${completedTask.images[0]}`,
].join(' '));

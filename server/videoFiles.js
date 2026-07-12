import fs from 'fs';
import path from 'path';
import { spawn as nodeSpawn } from 'child_process';
import { randomUUID } from 'crypto';
import { ensureDir } from './storage.js';

function validateJobId(jobId) {
  const value = String(jobId || '').trim();
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid video job id');
  return value;
}

export function validateVideoUrl(videoUrl, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(String(videoUrl || ''));
  } catch {
    throw new Error('Invalid video URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Video URL must use HTTPS');
  const allowlist = new Set((allowedHosts || []).map(host => String(host).trim().toLowerCase()).filter(Boolean));
  if (!allowlist.has(parsed.hostname.toLowerCase())) throw new Error('Video URL host is not allowed');
  return parsed;
}

function hasMp4Ftyp(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
}

function parseFrameRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  return Number((numerator / denominator).toFixed(3));
}

function probeVideo(filePath, ffprobePath, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(ffprobePath, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate',
      '-of', 'json', filePath,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${stderr.trim() || code}`));
      try {
        const payload = JSON.parse(stdout);
        const video = payload.streams?.find(stream => stream.codec_type === 'video');
        const duration = Number(payload.format?.duration);
        const width = Number(video?.width);
        const height = Number(video?.height);
        const fps = parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate);
        if (!(duration > 0) || !(width > 0) || !(height > 0) || !(fps > 0)) {
          throw new Error('ffprobe returned incomplete video metadata');
        }
        resolve({ duration, width, height, fps });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function removeFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function streamResponseToFile(response, filePath, maxBytes) {
  const contentLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('Video exceeds maximum size');
  if (!response.body) throw new Error('Video download response has no body');

  const handle = await fs.promises.open(filePath, 'wx');
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) throw new Error('Video exceeds maximum size');
      await handle.write(buffer);
    }
  } finally {
    await handle.close();
  }
  return size;
}

export function createVideoFileStore({
  videoDir,
  maxBytes = 209_715_200,
  allowedHosts = ['opcbucket.oss-cn-beijing.aliyuncs.com'],
  ffprobePath = 'ffprobe',
  fetchImpl = globalThis.fetch,
  spawnImpl = nodeSpawn,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
} = {}) {
  function ensureVideoDir() {
    ensureDir(videoDir);
  }

  function localMetadata(jobId, filePath, size, probe) {
    return {
      videoUrl: `/videos/${jobId}.mp4`,
      fileName: `${jobId}.mp4`,
      filePath,
      size,
      ...probe,
    };
  }

  async function inspectExistingVideo(jobIdOrOptions) {
    const jobId = validateJobId(typeof jobIdOrOptions === 'object' ? jobIdOrOptions.jobId : jobIdOrOptions);
    const filePath = path.join(videoDir, `${jobId}.mp4`);
    try {
      const stat = await fs.promises.stat(filePath);
      const handle = await fs.promises.open(filePath, 'r');
      const header = Buffer.alloc(12);
      try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
      if (!hasMp4Ftyp(header)) throw new Error('Downloaded file is not an MP4');
      const probe = await probeVideo(filePath, ffprobePath, spawnImpl);
      return localMetadata(jobId, filePath, stat.size, probe);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      await removeFile(filePath);
      return null;
    }
  }

  async function download({ jobId: rawJobId, videoUrl, signal } = {}) {
    const jobId = validateJobId(rawJobId);
    const parsedUrl = validateVideoUrl(videoUrl, allowedHosts);
    ensureDir(videoDir);
    const finalPath = path.join(videoDir, `${jobId}.mp4`);
    let lastError;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const partPath = path.join(videoDir, `${jobId}.${randomUUID()}.part`);
      try {
        const response = await fetchImpl(parsedUrl, { method: 'GET', signal, redirect: 'error' });
        if (!response.ok) throw new Error(`Video download failed (${response.status})`);
        const size = await streamResponseToFile(response, partPath, maxBytes);
        const header = Buffer.alloc(12);
        const handle = await fs.promises.open(partPath, 'r');
        try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
        if (!hasMp4Ftyp(header)) throw new Error('Downloaded file is not an MP4');
        const probe = await probeVideo(partPath, ffprobePath, spawnImpl);
        await removeFile(finalPath);
        await fs.promises.rename(partPath, finalPath);
        return localMetadata(jobId, finalPath, size, probe);
      } catch (error) {
        lastError = error;
        await removeFile(partPath);
        if (error?.name === 'AbortError' || attempt === 2) break;
        await sleep(Math.min(30_000, 1_000 * (2 ** attempt)), signal);
      }
    }
    throw lastError;
  }

  async function downloadValidateAndSave(options = {}) {
    options.onStage?.('downloading');
    const result = await download(options);
    options.onStage?.('validating');
    return result;
  }

  return {
    ensureVideoDir,
    download,
    downloadVideo: download,
    downloadValidateAndSave,
    inspectExistingVideo,
  };
}

import fs from 'fs';
import path from 'path';
import { ensureDir } from './storage.js';

export function getAudioMimeTypeFromPath(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (extension === '.wav') {
    return 'audio/wav';
  }
  if (extension === '.mp3') {
    return 'audio/mpeg';
  }
  throw new Error('参考音频仅支持 wav 或 mp3');
}

export function getAudioExtensionFromMimeType(mimeType) {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  if (normalizedMimeType.includes('mpeg') || normalizedMimeType.includes('mp3')) {
    return 'mp3';
  }
  if (normalizedMimeType.includes('wav')) {
    return 'wav';
  }
  if (normalizedMimeType.includes('ogg')) {
    return 'ogg';
  }
  if (normalizedMimeType.includes('aac')) {
    return 'aac';
  }
  if (normalizedMimeType.includes('m4a') || normalizedMimeType.includes('mp4')) {
    return 'm4a';
  }
  return 'mp3';
}

function countSpeechUnits(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return {
      cjkChars: 0,
      latinWords: 0,
      digitGroups: 0,
      punctuationCount: 0,
    };
  }

  return {
    cjkChars: (normalized.match(/[\u3400-\u9fff]/g) || []).length,
    latinWords: (normalized.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) || []).length,
    digitGroups: (normalized.match(/\d+(?:[.:/-]\d+)*/g) || []).length,
    punctuationCount: (normalized.match(/[，。！？；：,.!?;:]/g) || []).length,
  };
}

function estimateSpeechDurationSeconds(text) {
  const units = countSpeechUnits(text);
  const estimated = (
    1.4
    + (units.cjkChars * 0.28)
    + (units.latinWords * 0.34)
    + (units.digitGroups * 0.42)
    + (units.punctuationCount * 0.18)
  );

  return Math.min(45, Math.max(2.4, estimated));
}

function readWavStructure(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    return null;
  }

  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let byteRate = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkDataOffset + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(chunkDataOffset + 8);
      blockAlign = buffer.readUInt16LE(chunkDataOffset + 12);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = Math.min(chunkSize, buffer.length - chunkDataOffset);
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || !byteRate || !blockAlign || dataSize <= 0) {
    return null;
  }

  return {
    dataOffset,
    dataSize,
    byteRate,
    blockAlign,
    duration: dataSize / byteRate,
  };
}

function trimWavBufferToDuration(buffer, maxDurationSeconds) {
  const wav = readWavStructure(buffer);
  if (!wav || !Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0 || wav.duration <= maxDurationSeconds) {
    return {
      buffer,
      duration: wav?.duration,
      trimmed: false,
    };
  }

  let targetDataBytes = Math.floor(maxDurationSeconds * wav.byteRate);
  targetDataBytes -= targetDataBytes % wav.blockAlign;
  targetDataBytes = Math.max(wav.blockAlign, Math.min(targetDataBytes, wav.dataSize));

  const trimmedBuffer = Buffer.alloc(wav.dataOffset + targetDataBytes);
  buffer.copy(trimmedBuffer, 0, 0, wav.dataOffset + targetDataBytes);
  trimmedBuffer.writeUInt32LE(trimmedBuffer.length - 8, 4);

  const dataChunkSizeOffset = wav.dataOffset - 4;
  trimmedBuffer.writeUInt32LE(targetDataBytes, dataChunkSizeOffset);

  return {
    buffer: trimmedBuffer,
    duration: targetDataBytes / wav.byteRate,
    trimmed: true,
  };
}

export function normalizeVoiceAudioBuffer(audioBuffer, transcript) {
  const wav = readWavStructure(audioBuffer);
  if (!wav) {
    return {
      buffer: audioBuffer,
      duration: undefined,
      trimmed: false,
    };
  }

  const estimatedDuration = estimateSpeechDurationSeconds(transcript);
  const hardMaxDuration = Math.min(45, Math.max(estimatedDuration + 2.8, estimatedDuration * 1.85));
  const looksAbnormal = wav.duration > hardMaxDuration && (wav.duration - estimatedDuration) > 5;

  if (!looksAbnormal) {
    return {
      buffer: audioBuffer,
      duration: wav.duration,
      trimmed: false,
    };
  }

  const trimmed = trimWavBufferToDuration(audioBuffer, hardMaxDuration);
  return {
    buffer: trimmed.buffer,
    duration: trimmed.duration,
    trimmed: trimmed.trimmed,
  };
}

export function createAudioFileStore({ audioDir }) {
  function ensureAudioDir() {
    ensureDir(audioDir);
  }

  function saveGeneratedAudio({ base64Audio, audioBuffer, mimeType = 'audio/mpeg', filePrefix = 'kitty_voice', duration }) {
    const finalBuffer = audioBuffer || (base64Audio ? Buffer.from(base64Audio, 'base64') : null);
    if (!finalBuffer) {
      throw new Error('语音内容为空');
    }

    ensureAudioDir();
    const extension = getAudioExtensionFromMimeType(mimeType);
    const fileName = `${filePrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const filePath = path.join(audioDir, fileName);
    fs.writeFileSync(filePath, finalBuffer);

    return {
      audioUrl: `/audios/${fileName}`,
      audioMimeType: mimeType,
      duration: Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(1)) : undefined,
    };
  }

  return {
    ensureAudioDir,
    saveGeneratedAudio,
  };
}

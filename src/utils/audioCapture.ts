export interface WavRecordingResult {
  blob: Blob;
  mimeType: 'audio/wav';
  durationMs: number;
}

export interface WavRecorderHandle {
  stop: () => Promise<WavRecordingResult | null>;
  cancel: () => Promise<void>;
}

interface CreateWavRecorderOptions {
  targetSampleRate?: number;
  trimThreshold?: number;
  trimPaddingMs?: number;
  constraints?: MediaTrackConstraints;
  onLevel?: (level: number) => void;
}

const DEFAULT_TARGET_SAMPLE_RATE = 16000;
const DEFAULT_TRIM_THRESHOLD = 0.012;
const DEFAULT_TRIM_PADDING_MS = 90;

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  successCallback: (stream: MediaStream) => void,
  errorCallback: (error: unknown) => void,
) => void;

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('读取音频失败'));
    reader.readAsDataURL(blob);
  });
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return (
    window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    || null
  );
}

function getUserMediaCompat(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (typeof navigator === 'undefined') {
    return Promise.reject(new Error('当前环境不支持麦克风录音'));
  }

  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const legacyGetUserMedia = (
    (navigator as Navigator & {
      getUserMedia?: LegacyGetUserMedia;
      webkitGetUserMedia?: LegacyGetUserMedia;
      mozGetUserMedia?: LegacyGetUserMedia;
      msGetUserMedia?: LegacyGetUserMedia;
    }).getUserMedia
    || (navigator as Navigator & { webkitGetUserMedia?: LegacyGetUserMedia }).webkitGetUserMedia
    || (navigator as Navigator & { mozGetUserMedia?: LegacyGetUserMedia }).mozGetUserMedia
    || (navigator as Navigator & { msGetUserMedia?: LegacyGetUserMedia }).msGetUserMedia
  );

  if (!legacyGetUserMedia) {
    return Promise.reject(new Error('当前浏览器不支持麦克风录音'));
  }

  return new Promise((resolve, reject) => {
    legacyGetUserMedia.call(navigator, constraints, resolve, reject);
  });
}

function mergeFloat32Chunks(chunks: Float32Array[], totalLength: number) {
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function downsampleBuffer(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(newLength);
  let resultOffset = 0;
  let bufferOffset = 0;

  while (resultOffset < result.length) {
    const nextBufferOffset = Math.min(input.length, Math.round((resultOffset + 1) * ratio));
    let sum = 0;
    let count = 0;

    for (let index = bufferOffset; index < nextBufferOffset; index += 1) {
      sum += input[index];
      count += 1;
    }

    result[resultOffset] = count > 0 ? sum / count : 0;
    resultOffset += 1;
    bufferOffset = nextBufferOffset;
  }

  return result;
}

function trimSilence(samples: Float32Array, threshold: number, sampleRate: number, paddingMs: number) {
  if (!samples.length) {
    return samples;
  }

  let start = -1;
  let end = -1;

  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) >= threshold) {
      start = index;
      break;
    }
  }

  if (start === -1) {
    return samples;
  }

  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (Math.abs(samples[index]) >= threshold) {
      end = index;
      break;
    }
  }

  const paddingSamples = Math.round((paddingMs / 1000) * sampleRate);
  const normalizedStart = Math.max(0, start - paddingSamples);
  const normalizedEnd = Math.min(samples.length, end + paddingSamples + 1);
  return samples.slice(normalizedStart, normalizedEnd);
}

function encodeWavMono16(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

export async function createWavRecorder(
  options: CreateWavRecorderOptions = {},
): Promise<WavRecorderHandle> {
  const targetSampleRate = options.targetSampleRate || DEFAULT_TARGET_SAMPLE_RATE;
  const trimThreshold = options.trimThreshold || DEFAULT_TRIM_THRESHOLD;
  const trimPaddingMs = options.trimPaddingMs || DEFAULT_TRIM_PADDING_MS;
  const AudioContextCtor = getAudioContextCtor();

  if (!AudioContextCtor) {
    throw new Error('当前浏览器不支持音频采集');
  }

  const stream = await getUserMediaCompat({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...options.constraints,
    },
  });

  const audioContext = new AudioContextCtor();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const sinkGain = audioContext.createGain();
  sinkGain.gain.value = 0;

  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  let sourceSampleRate = audioContext.sampleRate;
  const startedAt = Date.now();
  let released = false;

  processor.onaudioprocess = (event) => {
    if (released) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(input.length);
    chunk.set(input);
    chunks.push(chunk);
    totalSamples += chunk.length;
    sourceSampleRate = event.inputBuffer.sampleRate || sourceSampleRate;

    let sum = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      sum += chunk[index] * chunk[index];
    }
    const rms = Math.sqrt(sum / Math.max(1, chunk.length));
    const normalizedLevel = Math.max(0, Math.min(1, rms * 10));
    options.onLevel?.(normalizedLevel);
  };

  sourceNode.connect(processor);
  processor.connect(sinkGain);
  sinkGain.connect(audioContext.destination);

  async function release() {
    if (released) {
      return;
    }

    released = true;
    processor.disconnect();
    processor.onaudioprocess = null;
    sourceNode.disconnect();
    sinkGain.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => {});
    options.onLevel?.(0);
  }

  return {
    async stop() {
      const durationMs = Date.now() - startedAt;
      const captureChunks = [...chunks];
      const captureLength = totalSamples;
      const captureRate = sourceSampleRate;

      await release();

      if (!captureLength) {
        return null;
      }

      const merged = mergeFloat32Chunks(captureChunks, captureLength);
      const downsampled = downsampleBuffer(merged, captureRate, targetSampleRate);
      const trimmed = trimSilence(downsampled, trimThreshold, targetSampleRate, trimPaddingMs);

      if (!trimmed.length) {
        return null;
      }

      const wavBuffer = encodeWavMono16(trimmed, targetSampleRate);
      return {
        blob: new Blob([wavBuffer], { type: 'audio/wav' }),
        mimeType: 'audio/wav',
        durationMs,
      };
    },
    async cancel() {
      await release();
    },
  };
}

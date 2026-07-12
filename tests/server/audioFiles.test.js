import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAudioFileStore } from '../../server/audioFiles.js';

const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('audio file storage', () => {
  it('writes generated audio to the configured directory and returns its media metadata', () => {
    const audioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-audio-'));
    tempDirs.push(audioDir);
    const store = createAudioFileStore({ audioDir });

    const saved = store.saveGeneratedAudio({
      audioBuffer: Buffer.from('synthetic generated audio'),
      mimeType: 'audio/wav',
      filePrefix: 'generated_voice',
      duration: 1.26,
    });

    expect(saved.audioUrl).toMatch(/^\/audios\/generated_voice_\d+_[a-z0-9]{8}\.wav$/);
    expect(saved.audioMimeType).toBe('audio/wav');
    expect(saved.duration).toBe(1.3);
    expect(fs.readFileSync(path.join(audioDir, path.basename(saved.audioUrl)), 'utf8'))
      .toBe('synthetic generated audio');
  });
});

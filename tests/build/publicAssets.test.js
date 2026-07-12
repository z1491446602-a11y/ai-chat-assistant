import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import viteConfig, * as viteConfigModule from '../../vite.config.ts';

const EXPECTED_PUBLIC_ASSETS = [
  'avatar.jpg',
  'background.jpg',
  'favicon.svg',
  'manifest.webmanifest',
];
const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('public build assets', () => {
  it('disables Vite public directory copying and declares the exact safe allowlist', () => {
    expect(viteConfig.publicDir).toBe(false);
    expect(viteConfigModule.PUBLIC_ASSET_FILE_NAMES).toEqual(EXPECTED_PUBLIC_ASSETS);
    expect(viteConfig.plugins.some(plugin => plugin.name === 'copy-selected-public-assets')).toBe(true);
  });

  it('copies only allowlisted root files into the build output', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-assets-'));
    tempDirs.push(rootDir);
    const publicDir = path.join(rootDir, 'public');
    const outDir = path.join(rootDir, 'dist');
    fs.mkdirSync(path.join(publicDir, 'audios'), { recursive: true });
    fs.mkdirSync(path.join(publicDir, 'uploads'), { recursive: true });

    for (const fileName of EXPECTED_PUBLIC_ASSETS) {
      fs.writeFileSync(path.join(publicDir, fileName), `safe ${fileName}`);
    }
    fs.writeFileSync(path.join(publicDir, 'robots.txt'), 'not allowlisted');
    fs.writeFileSync(path.join(publicDir, 'audios', 'private.webm'), 'synthetic audio');
    fs.writeFileSync(path.join(publicDir, 'uploads', 'private.bin'), 'synthetic upload');

    viteConfigModule.copySelectedPublicAssets({ publicDir, outDir });

    expect(fs.readdirSync(outDir).sort()).toEqual([...EXPECTED_PUBLIC_ASSETS].sort());
    for (const fileName of EXPECTED_PUBLIC_ASSETS) {
      expect(fs.readFileSync(path.join(outDir, fileName), 'utf8')).toBe(`safe ${fileName}`);
    }
    expect(fs.existsSync(path.join(outDir, 'audios'))).toBe(false);
    expect(fs.existsSync(path.join(outDir, 'uploads'))).toBe(false);
    expect(fs.existsSync(path.join(outDir, 'robots.txt'))).toBe(false);
  });
});

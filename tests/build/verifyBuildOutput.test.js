import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function loadVerifier() {
  try {
    return await import('../../scripts/verify-build-output.js');
  } catch {
    return {};
  }
}

describe('build output verification', () => {
  it('runs the verifier as the final npm build step', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(packageJson.scripts.build)
      .toMatch(/(?:^|&&\s*)node scripts\/verify-build-output\.js\s*$/);
  });

  it('rejects a dangling runtime media directory link without following its target', async ({ skip }) => {
    const verifier = await loadVerifier();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-dist-link-'));
    tempDirs.push(rootDir);
    const distDir = path.join(rootDir, 'dist');
    const targetDir = path.join(rootDir, 'target');
    const linkPath = path.join(distDir, 'audios');
    fs.mkdirSync(distDir);
    fs.mkdirSync(targetDir);

    try {
      fs.symlinkSync(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EACCES', 'EINVAL', 'ENOSYS', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
        skip();
        return;
      }
      throw error;
    }

    fs.rmSync(targetDir, { recursive: true });
    expect(fs.existsSync(linkPath)).toBe(false);
    expect(() => verifier.verifyBuildOutput(distDir)).toThrow('audios');
  });

  it('rejects every runtime media directory even when it is empty', async () => {
    const verifier = await loadVerifier();
    expect(verifier.verifyBuildOutput).toBeTypeOf('function');
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-dist-'));
    tempDirs.push(distDir);

    expect(() => verifier.verifyBuildOutput(distDir)).not.toThrow();
    for (const directoryName of ['audios', 'uploads', 'videos']) {
      const forbiddenPath = path.join(distDir, directoryName);
      fs.mkdirSync(forbiddenPath);
      expect(() => verifier.verifyBuildOutput(distDir)).toThrow(directoryName);
      fs.rmSync(forbiddenPath, { recursive: true });
    }
  });

  it('exits nonzero for forbidden output and zero for clean output', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-build-cli-'));
    tempDirs.push(rootDir);
    const cleanDist = path.join(rootDir, 'clean');
    const forbiddenDist = path.join(rootDir, 'forbidden');
    fs.mkdirSync(cleanDist);
    fs.mkdirSync(path.join(forbiddenDist, 'audios'), { recursive: true });
    const scriptPath = path.resolve('scripts', 'verify-build-output.js');

    expect(spawnSync(process.execPath, [scriptPath, cleanDist]).status).toBe(0);
    expect(spawnSync(process.execPath, [scriptPath, forbiddenDist]).status).not.toBe(0);
  });
});

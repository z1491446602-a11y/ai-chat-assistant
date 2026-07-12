import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const runtimeDirectories = ['src', 'server', 'deploy'];
const runtimeRootFiles = [
  'server.js',
  'index.html',
  'fileAttachmentTools.js',
  'eslint.config.js',
  'package.json',
  'vite.config.ts',
  'vitest.config.ts',
];
const textExtensions = new Set([
  '.bat',
  '.conf',
  '.css',
  '.gradle',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.pro',
  '.properties',
  '.py',
  '.service',
  '.sh',
  '.ts',
  '.tsx',
  '.xml',
]);
const extensionlessTextFiles = new Set(['gradlew']);
const ignoredDirectories = new Set([
  '.git',
  '.gradle',
  '__tests__',
  'build',
  'dist',
  'docs',
  'node_modules',
  'storage',
  'workspace-artifacts',
]);
const knownMojibakeFragments = [
  '娌℃湁鏉冮檺',
  '鏄电О',
  '涓嶈兘娣诲姞',
  '宸茬粡鏄',
  '鐢熸垚鍥剧墖',
  '鍥剧敓鍥',
  '鏂囦欢',
  '姝ｅ湪璇磋瘽',
  '娴佺▼鍥炬覆鏌',
  'AI鏃ュ父鑱',
  '鎷掔粷浜',
  '璇煶娑',
  '鑷畾涔',
  '涓婁紶澶',
  '宸插悜',
  '鍥剧墖',
  '璇峰厛閰',
  '鐠囬攱',
  '璇锋眰澶',
  '璇疯緭鍏',
  '杩炴帴',
  '鏅烘収榛',
  '鍔犺浇 AI',
  '鍒涘缓 AI',
  '鎻愪氦 AI',
  '鎻愪氦鍥',
  '鍋滄',
];

function isRuntimeTextFile(fileName) {
  if (/(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/u.test(fileName)) {
    return false;
  }

  return textExtensions.has(extname(fileName).toLowerCase())
    || extensionlessTextFiles.has(fileName);
}

function collectRuntimeTextFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : collectRuntimeTextFiles(filePath);
    }

    return entry.isFile() && isRuntimeTextFile(entry.name) ? [filePath] : [];
  });
}

function getRuntimeTextFiles() {
  const directoryFiles = runtimeDirectories.flatMap((directory) => (
    collectRuntimeTextFiles(join(projectRoot, directory))
  ));
  const rootFiles = runtimeRootFiles
    .map(fileName => join(projectRoot, fileName))
    .filter(filePath => existsSync(filePath));

  return [...directoryFiles, ...rootFiles].sort();
}

describe('runtime source text quality', () => {
  it('does not restore the extracted campus integration', () => {
    const issues = getRuntimeTextFiles().flatMap((filePath) => {
      const fileName = relative(projectRoot, filePath);
      return readFileSync(filePath, 'utf8')
        .split(/\r?\n/u)
        .flatMap((line, index) => (
          /hhstu|智慧黄科/iu.test(line) ? [`${fileName}:${index + 1}`] : []
        ));
    });

    expect(issues, `Extracted campus integration references:\n${issues.join('\n')}`).toEqual([]);
  });

  it('contains no replacement characters, private-use characters, or known mojibake', () => {
    const issues = [];

    for (const filePath of getRuntimeTextFiles()) {
      const fileName = relative(projectRoot, filePath);
      const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);

      lines.forEach((line, index) => {
        const reasons = [];

        if (line.includes('\uFFFD')) {
          reasons.push('contains U+FFFD');
        }

        const privateUseCharacter = line.match(/\p{General_Category=Private_Use}/u)?.[0];
        if (privateUseCharacter) {
          reasons.push(`contains private-use U+${privateUseCharacter.codePointAt(0).toString(16).toUpperCase()}`);
        }

        const mojibakeFragment = knownMojibakeFragments.find(fragment => line.includes(fragment));
        if (mojibakeFragment) {
          reasons.push(`contains known mojibake fragment ${JSON.stringify(mojibakeFragment)}`);
        }

        if (reasons.length) {
          issues.push(`${fileName}:${index + 1} ${reasons.join(', ')}`);
        }
      });
    }

    expect(issues, issues.join('\n')).toEqual([]);
  });
});

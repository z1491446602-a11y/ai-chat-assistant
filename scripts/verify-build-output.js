import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_BUILD_DIRECTORIES = ['audios', 'uploads', 'videos'];

export function verifyBuildOutput(distDir) {
  let buildEntryNames;
  try {
    buildEntryNames = new Set(
      fs.readdirSync(distDir, { withFileTypes: true }).map(entry => entry.name.toLowerCase()),
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const forbiddenDirectories = FORBIDDEN_BUILD_DIRECTORIES.filter(directoryName => (
    buildEntryNames.has(directoryName)
  ));

  if (forbiddenDirectories.length > 0) {
    throw new Error(`Forbidden runtime media directories in build output: ${forbiddenDirectories.join(', ')}`);
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (invokedFilePath === currentFilePath) {
  const distDir = path.resolve(process.argv[2] || 'dist');
  try {
    verifyBuildOutput(distDir);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

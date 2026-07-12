import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import mammoth from 'mammoth';
import xlsx from 'xlsx';

const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv']);
const SPREADSHEET_FILE_EXTENSIONS = new Set(['.xls', '.xlsx']);
const MAX_FILE_EXTRACT_LENGTH = 8000;
const execFileAsync = promisify(execFile);

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimText(text, maxLength) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function resolveUploadedFilePath(uploadDir, fileUrl) {
  const fileName = path.basename(String(fileUrl || ''));
  if (!fileName) {
    return '';
  }

  return path.join(uploadDir, fileName);
}

async function extractPdfText(filePath) {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(fs.readFileSync(filePath));
    return parsed.text || '';
  } catch {
    return '';
  }
}

async function extractSpreadsheetText(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    return workbook.SheetNames.slice(0, 3)
      .map(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
        });

        const content = rows
          .slice(0, 40)
          .map(row => (Array.isArray(row) ? row.filter(Boolean).join(' | ') : ''))
          .filter(Boolean)
          .join('\n');

        return content ? `Sheet: ${sheetName}\n${content}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return '';
  }
}

async function extractDocxText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  } catch {
    return '';
  }
}

async function convertDocWithLibreOffice(filePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatkitty-doc-'));

  try {
    const candidates = process.platform === 'win32'
      ? ['soffice.com', 'soffice.exe', 'soffice']
      : ['soffice', 'libreoffice'];

    for (const command of candidates) {
      try {
        await execFileAsync(command, [
          '--headless',
          '--convert-to',
          'txt:Text',
          '--outdir',
          tempDir,
          filePath,
        ], { timeout: 30_000, windowsHide: true });

        const convertedFile = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.txt`);
        if (fs.existsSync(convertedFile)) {
          return fs.readFileSync(convertedFile, 'utf8');
        }
      } catch {
        // Try the next executable name.
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  return '';
}

function extractReadableTextFromBinary(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer
      .toString('latin1')
      // eslint-disable-next-line no-control-regex -- Preserve tab, LF, and CR while removing binary data.
      .replace(/[^\x09\x0A\x0D\x20-\x7E\u4e00-\u9fa5]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

async function extractDocText(filePath) {
  const convertedText = await convertDocWithLibreOffice(filePath);
  if (convertedText) {
    return convertedText;
  }

  return extractReadableTextFromBinary(filePath);
}

async function extractUploadedFileText(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  if (SPREADSHEET_FILE_EXTENSIONS.has(extension)) {
    return extractSpreadsheetText(filePath);
  }

  if (extension === '.docx') {
    return extractDocxText(filePath);
  }

  if (extension === '.doc') {
    return extractDocText(filePath);
  }

  if (extension === '.pdf') {
    return extractPdfText(filePath);
  }

  return '';
}

export async function buildFileContextBlocks(files, uploadDir) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const blocks = [];

  for (const file of files) {
    if (!file?.fileUrl || !file?.fileName) {
      continue;
    }

    const filePath = resolveUploadedFilePath(uploadDir, file.fileUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      blocks.push(`[Attached file: ${file.fileName}]`);
      continue;
    }

    const extractedText = trimText(await extractUploadedFileText(filePath), MAX_FILE_EXTRACT_LENGTH);
    if (extractedText) {
      blocks.push(`Attached file: ${file.fileName}\n${extractedText}`);
    } else {
      blocks.push(`[Attached file: ${file.fileName}. Text extraction is unavailable for this format.]`);
    }
  }

  return blocks;
}

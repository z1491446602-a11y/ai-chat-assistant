import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceRoot = join(projectRoot, 'src');
const entryFile = join(sourceRoot, 'main.tsx');
const runtimeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const runtimeExtensionSet = new Set(runtimeExtensions);

function normalizePathCase(normalizedPath, platform = process.platform) {
  return platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function normalizePath(filePath, platform = process.platform) {
  const normalizedPath = resolve(filePath).normalize('NFC').replaceAll('\\', '/');
  return normalizePathCase(normalizedPath, platform);
}

function isRuntimeModule(fileName) {
  if (/\.d\.[cm]?ts$/iu.test(fileName)) {
    return false;
  }

  if (/(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/iu.test(fileName)) {
    return false;
  }

  return runtimeExtensionSet.has(extname(fileName).toLowerCase());
}

function collectRuntimeModules(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : collectRuntimeModules(filePath);
    }

    return entry.isFile() && isRuntimeModule(entry.name) ? [filePath] : [];
  });
}

function getScriptKind(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function getModuleSpecifiersFromSource(sourceText, filePath = 'synthetic.ts') {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  );
  const specifiers = [];

  function importHasRuntimeEdge(node) {
    const importClause = node.importClause;
    if (!importClause) {
      return true;
    }

    if (importClause.isTypeOnly || importClause.name) {
      return !importClause.isTypeOnly;
    }

    const namedBindings = importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      return true;
    }

    return namedBindings.elements.length === 0
      || namedBindings.elements.some(specifier => !specifier.isTypeOnly);
  }

  function exportHasRuntimeEdge(node) {
    if (node.isTypeOnly) {
      return false;
    }

    const exportClause = node.exportClause;
    if (!exportClause || !ts.isNamedExports(exportClause)) {
      return true;
    }

    return exportClause.elements.length === 0
      || exportClause.elements.some(specifier => !specifier.isTypeOnly);
  }

  function visit(node) {
    if (
      ts.isImportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
      && importHasRuntimeEdge(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node)
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
      && exportHasRuntimeEdge(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function getModuleSpecifiers(filePath) {
  return getModuleSpecifiersFromSource(readFileSync(filePath, 'utf8'), filePath);
}

function resolveSourceModule(specifier, importer, fileByNormalizedPath) {
  let basePath;

  if (specifier.startsWith('@/')) {
    basePath = join(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    basePath = resolve(dirname(importer), specifier);
  } else {
    return null;
  }

  const explicitExtension = extname(basePath).toLowerCase();
  const candidates = [basePath];

  if (runtimeExtensionSet.has(explicitExtension)) {
    const withoutExtension = basePath.slice(0, -explicitExtension.length);
    candidates.push(...runtimeExtensions.map(extension => `${withoutExtension}${extension}`));
  } else {
    candidates.push(...runtimeExtensions.map(extension => `${basePath}${extension}`));
    candidates.push(...runtimeExtensions.map(extension => join(basePath, `index${extension}`)));
  }

  for (const candidate of candidates) {
    const resolvedFile = fileByNormalizedPath.get(normalizePath(candidate));
    if (resolvedFile) {
      return resolvedFile;
    }
  }

  return null;
}

describe('source module reachability', () => {
  it('ignores whole and named type-only import and export declarations', () => {
    const specifiers = getModuleSpecifiersFromSource(`
      import type { ImportType } from './whole-type-import';
      import { type NamedImportType } from './named-type-import';
      export type { ExportType } from './whole-type-export';
      export { type NamedExportType } from './named-type-export';
    `);

    expect(specifiers).toEqual([]);
  });

  it('keeps mixed value and type imports and exports as runtime edges', () => {
    const specifiers = getModuleSpecifiersFromSource(`
      import { type ImportType, runtimeImport } from './mixed-import';
      export { type ExportType, runtimeExport } from './mixed-export';
    `);

    expect(specifiers).toEqual(['./mixed-import', './mixed-export']);
  });

  it('case-folds path keys on Windows but preserves case on case-sensitive platforms', () => {
    expect(normalizePathCase('C:/Project/SRC/Feature.ts', 'win32')).toBe('c:/project/src/feature.ts');
    expect(normalizePathCase('/Project/SRC/Feature.ts', 'linux')).toBe('/Project/SRC/Feature.ts');
  });

  it('has no runtime modules unreachable from src/main.tsx', () => {
    const runtimeModules = collectRuntimeModules(sourceRoot);
    const fileByNormalizedPath = new Map(
      runtimeModules.map(filePath => [normalizePath(filePath), filePath]),
    );
    const reachable = new Set();
    const pending = [fileByNormalizedPath.get(normalizePath(entryFile))];

    while (pending.length) {
      const filePath = pending.pop();
      if (!filePath) {
        throw new Error(`Entry module not found: ${entryFile}`);
      }

      const normalizedFilePath = normalizePath(filePath);
      if (reachable.has(normalizedFilePath)) {
        continue;
      }

      reachable.add(normalizedFilePath);

      for (const specifier of getModuleSpecifiers(filePath)) {
        const importedFile = resolveSourceModule(specifier, filePath, fileByNormalizedPath);
        if (importedFile && !reachable.has(normalizePath(importedFile))) {
          pending.push(importedFile);
        }
      }
    }

    const unreachable = runtimeModules
      .filter(filePath => !reachable.has(normalizePath(filePath)))
      .map(filePath => relative(projectRoot, filePath).replaceAll('\\', '/'))
      .sort((left, right) => left.localeCompare(right));

    expect(
      unreachable,
      `Unreachable runtime modules:\n${unreachable.join('\n')}`,
    ).toEqual([]);
  });
});

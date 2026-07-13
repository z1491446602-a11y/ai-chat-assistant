import fs from 'fs';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LEGACY_DATA_KEYS = [
  'users',
  'accounts',
  'friendChats',
  'announcement',
  'videoCalls',
];
const OBJECT_COLLECTION_KEYS = [
  'aiSessions',
  'videoJobs',
  'mediaRequests',
  'authUsers',
  'authSessions',
  'redeemCodes',
  'pointReservations',
];

function invalidPersistedData(message) {
  return Object.assign(
    new Error(`Invalid persisted application data: ${message}`),
    { code: 'INVALID_PERSISTED_DATA' },
  );
}

export function createEmptyData() {
  return {
    aiSessions: {},
    videoJobs: {},
    mediaRequests: {},
    authUsers: {},
    authSessions: {},
    redeemCodes: {},
    pointReservations: {},
    pointTransactions: [],
  };
}

export function normalizeData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw invalidPersistedData('top-level value must be an object');
  }
  const normalized = data;

  for (const key of OBJECT_COLLECTION_KEYS) {
    if (!Object.hasOwn(normalized, key)) {
      normalized[key] = {};
    } else if (
      !normalized[key]
      || typeof normalized[key] !== 'object'
      || Array.isArray(normalized[key])
    ) {
      throw invalidPersistedData(`${key} must be an object`);
    }
  }

  if (!Object.hasOwn(normalized, 'pointTransactions')) {
    normalized.pointTransactions = [];
  } else if (!Array.isArray(normalized.pointTransactions)) {
    throw invalidPersistedData('pointTransactions must be an array');
  }

  for (const key of LEGACY_DATA_KEYS) {
    delete normalized[key];
  }

  return normalized;
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function resolveExistingTarget(filePath) {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      return fs.realpathSync(filePath);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return filePath;
}

function applyPrivateMode(filePath, mode) {
  const targetPath = resolveExistingTarget(filePath);
  try {
    fs.chmodSync(targetPath, mode);
  } catch (error) {
    const unsupportedOnWindows = process.platform === 'win32'
      && ['EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(error?.code);
    if (!unsupportedOnWindows) throw error;
  }
}

function ensurePrivateDataDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  }
  applyPrivateMode(dirPath, PRIVATE_DIRECTORY_MODE);
}

function readJsonFile(filePath) {
  const file = fs.readFileSync(resolveExistingTarget(filePath), 'utf8');
  return JSON.parse(file);
}

function containsLegacyData(data) {
  return Boolean(
    data
    && typeof data === 'object'
    && LEGACY_DATA_KEYS.some(key => Object.hasOwn(data, key)),
  );
}

export function createDataStore({
  dataDir,
  dataFile,
  dataBackupFile,
  legacyDataFile,
}) {
  function replacePrivateJsonFile(filePath, serialized) {
    const targetPath = resolveExistingTarget(filePath);
    const tempFile = `${targetPath}.tmp`;
    fs.writeFileSync(tempFile, serialized, {
      encoding: 'utf8',
      mode: PRIVATE_FILE_MODE,
    });
    applyPrivateMode(tempFile, PRIVATE_FILE_MODE);
    fs.renameSync(tempFile, targetPath);
  }

  function snapshotFile(filePath) {
    const targetPath = resolveExistingTarget(filePath);
    if (!fs.existsSync(targetPath)) {
      return { targetPath, exists: false, contents: '' };
    }
    return {
      targetPath,
      exists: true,
      contents: fs.readFileSync(targetPath, 'utf8'),
    };
  }

  function restoreFile(snapshot) {
    if (snapshot.exists) {
      replacePrivateJsonFile(snapshot.targetPath, snapshot.contents);
      return;
    }
    try {
      fs.unlinkSync(snapshot.targetPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  function serializeNormalizedData(data) {
    const normalizedData = normalizeData(
      data && typeof data === 'object' && !Array.isArray(data)
        ? { ...data }
        : data,
    );
    return {
      normalizedData,
      serialized: JSON.stringify(normalizedData, null, 2),
    };
  }

  function persistSanitizedPrimary(normalizedData) {
    const serialized = JSON.stringify(normalizedData, null, 2);
    replacePrivateJsonFile(dataBackupFile, serialized);
    scrubAuxiliaryLegacyFiles({ backupAlreadySanitized: true });
    replacePrivateJsonFile(dataFile, serialized);
  }

  function hardenExistingFile(filePath) {
    if (fs.existsSync(filePath)) {
      applyPrivateMode(filePath, PRIVATE_FILE_MODE);
    }
  }

  function hardenExistingArtifacts() {
    const targetDataFile = resolveExistingTarget(dataFile);
    const candidates = new Set([
      dataFile,
      dataBackupFile,
      `${dataFile}.tmp`,
      `${targetDataFile}.tmp`,
      legacyDataFile,
      `${legacyDataFile}.tmp`,
    ]);
    for (const filePath of candidates) {
      hardenExistingFile(filePath);
    }
  }

  function scrubLegacyFile(filePath, label) {
    if (!fs.existsSync(filePath)) return;

    let rawData;
    try {
      rawData = readJsonFile(filePath);
    } catch (error) {
      console.error(`Failed to parse ${label}:`, error);
      return;
    }

    if (containsLegacyData(rawData)) {
      const { serialized } = serializeNormalizedData(rawData);
      replacePrivateJsonFile(filePath, serialized);
    }
  }

  function scrubAuxiliaryLegacyFiles({ backupAlreadySanitized = false } = {}) {
    if (!backupAlreadySanitized) {
      scrubLegacyFile(dataBackupFile, 'backup data file');
    }
    if (legacyDataFile !== dataFile) {
      scrubLegacyFile(legacyDataFile, 'legacy data file');
    }
  }

  function saveData(nextData) {
    ensurePrivateDataDir(dataDir);
    hardenExistingArtifacts();
    const { serialized } = serializeNormalizedData(nextData);
    const previousBackup = snapshotFile(dataBackupFile);
    let backupReplaced = false;
    try {
      replacePrivateJsonFile(dataBackupFile, serialized);
      backupReplaced = true;
      scrubAuxiliaryLegacyFiles({ backupAlreadySanitized: true });
      replacePrivateJsonFile(dataFile, serialized);
    } catch (error) {
      if (!backupReplaced) throw error;
      try {
        restoreFile(previousBackup);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Failed to save application data and restore its backup',
        );
      }
      throw error;
    }
  }

  function loadData() {
    ensurePrivateDataDir(dataDir);
    hardenExistingArtifacts();

    if (!fs.existsSync(dataFile)) {
      if (fs.existsSync(dataBackupFile)) {
        const rawBackupData = readJsonFile(dataBackupFile);
        const { normalizedData: backupData } = serializeNormalizedData(rawBackupData);
        persistSanitizedPrimary(backupData);
        return backupData;
      }

      if (dataFile !== legacyDataFile && fs.existsSync(legacyDataFile)) {
        const rawLegacyData = readJsonFile(legacyDataFile);

        const { normalizedData, serialized } = serializeNormalizedData(rawLegacyData);
        try {
          replacePrivateJsonFile(dataBackupFile, serialized);
          replacePrivateJsonFile(legacyDataFile, serialized);
          replacePrivateJsonFile(dataFile, serialized);
        } catch (error) {
          console.error('Failed to persist migrated legacy data:', error);
          throw error;
        }
        return normalizedData;
      }

      return createEmptyData();
    }

    let rawData;
    let normalizedData;
    try {
      rawData = readJsonFile(dataFile);
      ({ normalizedData } = serializeNormalizedData(rawData));
    } catch (error) {
      if (fs.existsSync(dataBackupFile)) {
        let backupData;
        try {
          const rawBackupData = readJsonFile(dataBackupFile);
          ({ normalizedData: backupData } = serializeNormalizedData(rawBackupData));
        } catch (backupError) {
          throw new AggregateError(
            [error, backupError],
            'Failed to load application data from both the primary and backup files',
          );
        }

        persistSanitizedPrimary(backupData);
        return backupData;
      }

      throw error;
    }

    const hadLegacyData = containsLegacyData(rawData);
    if (hadLegacyData) {
      persistSanitizedPrimary(normalizedData);
    } else {
      scrubAuxiliaryLegacyFiles();
    }
    return normalizedData;
  }

  return {
    loadData,
    saveData,
  };
}

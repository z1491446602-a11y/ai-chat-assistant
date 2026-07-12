import fs from 'fs';

export function createEmptyData() {
  return {
    aiSessions: {},
    videoJobs: {},
  };
}

function normalizeData(data) {
  const normalized = data && typeof data === 'object' ? data : createEmptyData();
  if (!normalized.videoJobs || typeof normalized.videoJobs !== 'object' || Array.isArray(normalized.videoJobs)) {
    normalized.videoJobs = {};
  }
  return normalized;
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath) {
  const file = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(file);
}

export function createDataStore({
  dataDir,
  dataFile,
  dataBackupFile,
  legacyDataFile,
}) {
  function saveData(nextData) {
    ensureDir(dataDir);
    const serialized = JSON.stringify(nextData, null, 2);
    const tempFile = `${dataFile}.tmp`;

    fs.writeFileSync(tempFile, serialized);

    if (fs.existsSync(dataFile)) {
      fs.copyFileSync(dataFile, dataBackupFile);
    }

    fs.renameSync(tempFile, dataFile);
  }

  function loadData() {
    ensureDir(dataDir);

    if (!fs.existsSync(dataFile)) {
      if (dataFile !== legacyDataFile && fs.existsSync(legacyDataFile)) {
        try {
          const legacyData = normalizeData(readJsonFile(legacyDataFile));
          saveData(legacyData);
          return legacyData;
        } catch (error) {
          console.error('Failed to migrate legacy data file:', error);
        }
      }

      return createEmptyData();
    }

    try {
      return normalizeData(readJsonFile(dataFile));
    } catch (error) {
      console.error('Failed to parse data file, trying backup:', error);

      if (fs.existsSync(dataBackupFile)) {
        try {
          const backupData = normalizeData(readJsonFile(dataBackupFile));
          fs.copyFileSync(dataBackupFile, dataFile);
          return backupData;
        } catch (backupError) {
          console.error('Failed to parse backup data file:', backupError);
        }
      }

      return createEmptyData();
    }
  }

  return {
    loadData,
    saveData,
  };
}

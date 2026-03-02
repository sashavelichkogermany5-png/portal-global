const fs = require('fs');
const path = require('path');

const requestsPath = path.join(__dirname, '..', '..', 'data', 'intake', 'requests.json');

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath, fallback) => {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
};

const writeJsonAtomic = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  try {
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    if (error && (error.code === 'EPERM' || error.code === 'EEXIST')) {
      await fs.promises.rm(filePath, { force: true });
      await fs.promises.rename(tmpPath, filePath);
      return;
    }
    throw error;
  }
};

const listRequests = () => readJson(requestsPath, []);
const saveRequests = (requests) => writeJsonAtomic(requestsPath, requests || []);

module.exports = { listRequests, saveRequests, requestsPath };

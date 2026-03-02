const fs = require('fs');
const path = require('path');

const metricsPath = path.join(__dirname, '..', '..', 'data', 'metrics', 'metrics_daily.json');

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
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
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

const listMetrics = () => readJson(metricsPath, []);
const saveMetrics = (metrics) => writeJsonAtomic(metricsPath, metrics || []);

module.exports = { listMetrics, saveMetrics, metricsPath };

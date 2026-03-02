const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..', '..', 'data', 'local-runner', 'tenants');
const aggregateOrdersPath = path.join(__dirname, '..', '..', 'data', 'orders', 'orders.json');
const aggregateMetricsPath = path.join(__dirname, '..', '..', 'data', 'metrics', 'metrics_daily.json');

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

const tenantDir = (tenantId) => path.join(baseDir, String(tenantId));
const ordersPath = (tenantId) => path.join(tenantDir(tenantId), 'orders.json');
const runnersPath = (tenantId) => path.join(tenantDir(tenantId), 'runners.json');
const metricsPath = (tenantId) => path.join(tenantDir(tenantId), 'metrics_daily.json');

const listOrders = (tenantId) => readJson(ordersPath(tenantId), []);
const listRunners = (tenantId) => readJson(runnersPath(tenantId), []);
const listMetrics = (tenantId) => readJson(metricsPath(tenantId), []);

const updateAggregateOrders = async (tenantId, orders) => {
  const aggregate = await readJson(aggregateOrdersPath, []);
  const filtered = aggregate.filter((order) => String(order.tenantId) !== String(tenantId));
  await writeJsonAtomic(aggregateOrdersPath, [...filtered, ...orders]);
};

const updateAggregateMetrics = async (tenantId, metrics) => {
  const aggregate = await readJson(aggregateMetricsPath, []);
  const filtered = aggregate.filter((item) => String(item.tenantId) !== String(tenantId));
  await writeJsonAtomic(aggregateMetricsPath, [...filtered, ...metrics]);
};

const saveOrders = async (tenantId, orders) => {
  await writeJsonAtomic(ordersPath(tenantId), orders || []);
  await updateAggregateOrders(tenantId, orders || []);
  return orders;
};

const saveRunners = async (tenantId, runners) => {
  await writeJsonAtomic(runnersPath(tenantId), runners || []);
  return runners;
};

const saveMetrics = async (tenantId, metrics) => {
  await writeJsonAtomic(metricsPath(tenantId), metrics || []);
  await updateAggregateMetrics(tenantId, metrics || []);
  return metrics;
};

module.exports = {
  listOrders,
  saveOrders,
  listRunners,
  saveRunners,
  listMetrics,
  saveMetrics,
  aggregateOrdersPath,
  aggregateMetricsPath
};

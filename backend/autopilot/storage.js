const fs = require('fs');
const path = require('path');

const defaultNow = () => new Date().toISOString();

const createAutopilotStorage = (options = {}) => {
  const dataDir = options.dataDir || path.join(__dirname, '..', '..', 'data', 'autopilot');
  const defaultEnabled = options.defaultEnabled === true;
  const defaultSettings = {
    preferredLanguage: 'ru',
    region: 'DE',
    primaryOfferTemplate: null,
    userApprovalRequired: true
  };

  const ensureDataDir = async () => {
    await fs.promises.mkdir(dataDir, { recursive: true });
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

  const writeJson = async (filePath, payload) => {
    await ensureDataDir();
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const content = JSON.stringify(payload, null, 2);
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    try {
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        await fs.promises.rm(filePath, { force: true });
        await fs.promises.rename(tmpPath, filePath);
        return;
      }
      throw error;
    }
  };

  const tenantFile = (tenantId) => path.join(dataDir, `tenant-${tenantId}.json`);
  const entityFile = (tenantId, entity) => path.join(dataDir, `${entity}-${tenantId}.json`);
  const templatesFile = () => path.join(dataDir, 'templates.json');

  const getTenantSettings = async (tenantId) => {
    const fallback = {
      tenantId,
      enabled: defaultEnabled,
      ...defaultSettings,
      updatedAt: defaultNow()
    };
    const filePath = tenantFile(tenantId);
    const current = await readJson(filePath, null);
    if (!current) {
      await writeJson(filePath, fallback);
      return fallback;
    }
    return {
      ...fallback,
      ...current,
      tenantId,
      updatedAt: current.updatedAt || fallback.updatedAt
    };
  };

  const updateTenantSettings = async (tenantId, updates = {}) => {
    const current = await getTenantSettings(tenantId);
    const next = {
      ...current,
      ...updates,
      tenantId,
      updatedAt: defaultNow()
    };
    await writeJson(tenantFile(tenantId), next);
    return next;
  };

  const listEntity = async (tenantId, entity) => readJson(entityFile(tenantId, entity), []);
  const saveEntity = async (tenantId, entity, data) => writeJson(entityFile(tenantId, entity), data || []);

  const loadTemplates = async () => readJson(templatesFile(), []);

  return {
    dataDir,
    getTenantSettings,
    updateTenantSettings,
    listOffers: (tenantId) => listEntity(tenantId, 'offers'),
    saveOffers: (tenantId, data) => saveEntity(tenantId, 'offers', data),
    listLandings: (tenantId) => listEntity(tenantId, 'landings'),
    saveLandings: (tenantId, data) => saveEntity(tenantId, 'landings', data),
    listLeads: (tenantId) => listEntity(tenantId, 'leads'),
    saveLeads: (tenantId, data) => saveEntity(tenantId, 'leads', data),
    listExperiments: (tenantId) => listEntity(tenantId, 'experiments'),
    saveExperiments: (tenantId, data) => saveEntity(tenantId, 'experiments', data),
    listMetrics: (tenantId) => listEntity(tenantId, 'metrics'),
    saveMetrics: (tenantId, data) => saveEntity(tenantId, 'metrics', data),
    loadTemplates
  };
};

module.exports = { createAutopilotStorage };

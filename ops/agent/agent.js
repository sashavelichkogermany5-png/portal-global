const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_DIR = process.env.PORTAL_AGENT_HOME
  || path.join(process.env.APPDATA || os.homedir(), "portal-global");
const CONFIG_PATH = path.join(APP_DIR, "agent-config.json");
const LOG_PATH = path.join(APP_DIR, "agent.log");
const DEFAULT_INTERVAL_MS = 60 * 1000;

const appendLog = (message) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch (error) {
    // ignore log failures
  }
};

const readConfig = () => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    appendLog(`Failed to read config: ${error.message}`);
    return null;
  }
};

const ensureFetch = () => {
  if (typeof fetch === "function") return fetch;
  appendLog("Fetch API not available. Use Node 18+.");
  return null;
};

const buildHeartbeatPayload = (config) => ({
  agentId: String(config.agentId || "").trim(),
  hostname: os.hostname(),
  meta: {
    version: String(config.version || "1.0.0"),
    platform: `${os.platform()}-${os.release()}`,
    node: process.version
  }
});

const startAgent = async () => {
  const config = readConfig();
  if (!config) {
    appendLog("Missing agent-config.json. Run install-agent.ps1.");
    process.exit(1);
  }

  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  const tenantId = String(config.tenantId || "").trim();
  const serviceKey = String(config.serviceKey || "").trim();
  const intervalMs = Number(config.intervalMs || DEFAULT_INTERVAL_MS);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs > 5000
    ? intervalMs
    : DEFAULT_INTERVAL_MS;

  if (!baseUrl || !tenantId || !serviceKey) {
    appendLog("Invalid config. baseUrl, tenantId, and serviceKey are required.");
    process.exit(1);
  }

  const heartbeatUrl = `${baseUrl}/api/agent/heartbeat`;
  const fetchImpl = ensureFetch();
  if (!fetchImpl) process.exit(1);

  let loggedOk = false;
  const sendHeartbeat = async () => {
    const payload = buildHeartbeatPayload(config);
    if (!payload.agentId) {
      appendLog("Missing agentId in config.");
      return;
    }
    try {
      const response = await fetchImpl(heartbeatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token": serviceKey,
          "X-Tenant-Id": tenantId
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const text = await response.text();
        appendLog(`Heartbeat failed (${response.status}): ${text}`);
        return;
      }
      if (!loggedOk) {
        appendLog("Heartbeat ok.");
        loggedOk = true;
      }
    } catch (error) {
      appendLog(`Heartbeat error: ${error.message}`);
    }
  };

  await sendHeartbeat();
  setInterval(sendHeartbeat, safeInterval);
};

startAgent().catch((error) => {
  appendLog(`Agent crashed: ${error.message}`);
  process.exit(1);
});

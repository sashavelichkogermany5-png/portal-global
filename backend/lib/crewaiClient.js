const CREWAI_URL = process.env.CREWAI_URL || "http://localhost:5055";
const CREWAI_API_KEY = process.env.CREWAI_API_KEY || "dev";
const AI_CALL_TIMEOUT_MS = Number(process.env.AI_CALL_TIMEOUT_MS || 30000);

const fetchWithTimeout = async (url, options, timeout = AI_CALL_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            const err = new Error(`AI call timed out after ${timeout}ms`);
            err.status = 408;
            throw err;
        }
        throw error;
    }
};

async function runCrewEngine({ tenantId, correlationId, type, payload = {}, meta = {} }) {
  const url = `${CREWAI_URL}/run`;

  const hasFetch = typeof fetch === "function";
  const body = JSON.stringify({ tenantId, correlationId, type, payload, meta });

  if (hasFetch) {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": CREWAI_API_KEY,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`Crew Runner failed: ${res.status} ${res.statusText} ${text}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  const { request } = url.startsWith("https") ? require("https") : require("http");
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": CREWAI_API_KEY,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Crew Runner failed: ${res.statusCode} ${data}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = { runCrewEngine };

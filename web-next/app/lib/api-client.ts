const rawBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  || `http://localhost:${process.env.NEXT_PUBLIC_BACKEND_PORT || "3000"}`;

const API_BASE_URL = rawBaseUrl.replace(/\/$/, "");

const SESSION_TOKEN_KEY = "portal.session.token";
const TENANT_ID_KEY = "portal.active.tenant";

const isBrowser = typeof window !== "undefined";

type ApiRecord = Record<string, unknown>;

let authMeInflight: Promise<ApiRecord | null> | null = null;
let authMeLastOk: ApiRecord | null = null;
let authMeLastOkAt = 0;
const AUTH_ME_CLIENT_MIN_INTERVAL_MS = 1200;
const AUTH_ME_CLIENT_MAX_RETRIES = 2;
const AUTH_ME_CLIENT_MAX_BACKOFF_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readStorage = (key: string) => (isBrowser ? window.localStorage.getItem(key) : null);
const writeStorage = (key: string, value: string | null) => {
  if (!isBrowser) return;
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, value);
};

const asRecord = (value: unknown): ApiRecord | null => {
  if (!value || typeof value !== "object") return null;
  return value as ApiRecord;
};

const extractDataRecord = (payload: unknown) => asRecord(asRecord(payload)?.data);

const extractToken = (payload: unknown): string | null => {
  const record = asRecord(payload);
  const data = extractDataRecord(payload);
  const token = (
    record?.token
    || record?.accessToken
    || record?.access_token
    || data?.token
    || data?.accessToken
    || data?.access_token
    || null
  );

  return typeof token === "string" ? token : null;
};

const extractTenantId = (payload: unknown): string | number | null => {
  const record = asRecord(payload);
  const data = extractDataRecord(payload);
  const tenantId = (
    record?.activeTenantId
    || data?.activeTenantId
    || record?.tenantId
    || data?.tenantId
    || null
  );

  if (typeof tenantId === "string" || typeof tenantId === "number") {
    return tenantId;
  }
  return null;
};

const extractErrorMessage = (payload: unknown, fallback: string) => {
  const record = asRecord(payload);

  if (typeof record?.message === "string" && record.message) return record.message;
  if (typeof record?.error === "string" && record.error) return record.error;
  return fallback;
};

const buildUrl = (path: string) => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
};

const parseJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const getSessionToken = () => readStorage(SESSION_TOKEN_KEY);
export const setSessionToken = (token: string | null) => writeStorage(SESSION_TOKEN_KEY, token);

export const getStoredTenantId = () => readStorage(TENANT_ID_KEY);
export const setStoredTenantId = (tenantId: string | number | null) => {
  if (!tenantId) {
    writeStorage(TENANT_ID_KEY, null);
    return;
  }
  writeStorage(TENANT_ID_KEY, String(tenantId));
};

export const clearAuth = () => {
  setSessionToken(null);
  setStoredTenantId(null);
};

export const apiRequest = async (path: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  const token = getSessionToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const tenantId = getStoredTenantId();
  if (tenantId && !headers.has("X-Tenant-Id")) {
    headers.set("X-Tenant-Id", tenantId);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(buildUrl(path), {
    ...options,
    headers,
    credentials: "include"
  });
};

export const apiJson = async (path: string, options: RequestInit = {}) => {
  const response = await apiRequest(path, options);
  const data = await parseJson(response);
  if (!response.ok) {
    const message = extractErrorMessage(data, response.statusText);
    const error = new Error(message);
    (error as Error & { status?: number; data?: unknown }).status = response.status;
    (error as Error & { status?: number; data?: unknown }).data = data;
    throw error;
  }
  return data;
};

export const login = async (email: string, password: string) => {
  const payload = await apiJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const token = extractToken(payload);
  if (token) {
    setSessionToken(token);
  }
  const tenantId = extractTenantId(payload);
  if (tenantId) {
    setStoredTenantId(tenantId);
  }
  return payload;
};

export const register = async (email: string, password: string) => {
  const payload = await apiJson("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const token = extractToken(payload);
  if (token) {
    setSessionToken(token);
  }
  const tenantId = extractTenantId(payload);
  if (tenantId) {
    setStoredTenantId(tenantId);
  }
  return payload;
};

export const authMe = async (): Promise<ApiRecord | null> => {
  const now = Date.now();
  if (authMeLastOk && (now - authMeLastOkAt) < AUTH_ME_CLIENT_MIN_INTERVAL_MS) {
    return authMeLastOk;
  }

  if (authMeInflight) {
    return authMeInflight;
  }

  authMeInflight = (async () => {
    let attempt = 0;
    while (true) {
      attempt += 1;
      const response = await apiRequest("/api/auth/me", { method: "GET" });
      const data = asRecord(await parseJson(response));

      if (response.status === 429) {
        const wait = Math.min(AUTH_ME_CLIENT_MAX_BACKOFF_MS, 300 * Math.pow(2, attempt - 1));
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        if (attempt >= AUTH_ME_CLIENT_MAX_RETRIES) {
          const message = extractErrorMessage(data, response.statusText);
          const error = new Error(message);
          (error as Error & { status?: number; data?: unknown }).status = response.status;
          (error as Error & { status?: number; data?: unknown }).data = data;
          throw error;
        }
        await sleep(200);
        continue;
      }

      const tenantId = extractTenantId(extractDataRecord(data) || data);
      if (tenantId) {
        setStoredTenantId(tenantId);
      }
      authMeLastOk = data;
      authMeLastOkAt = Date.now();
      return data;
    }
  })();

  try {
    return await authMeInflight;
  } finally {
    authMeInflight = null;
  }
};

export const createProject = async (input: {
  name: string;
  category?: string;
  notes?: string;
}) => apiJson("/api/projects", {
  method: "POST",
  body: JSON.stringify({
    name: input.name,
    category: input.category || "general",
    notes: input.notes || "",
    status: "Planning",
    progress: 0
  })
});

export const generateAiProject = async (idea: string) => apiJson("/api/ai-project", {
  method: "POST",
  body: JSON.stringify({ idea })
});

export const submitFeedback = async (input: {
  email?: string;
  message: string;
  page?: string;
}) => apiJson("/api/feedback", {
  method: "POST",
  body: JSON.stringify(input)
});

export { API_BASE_URL };

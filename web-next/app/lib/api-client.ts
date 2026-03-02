const rawBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  || `http://localhost:${process.env.NEXT_PUBLIC_BACKEND_PORT || "3000"}`;

const API_BASE_URL = rawBaseUrl.replace(/\/$/, "");

const SESSION_TOKEN_KEY = "portal.session.token";
const TENANT_ID_KEY = "portal.active.tenant";

const isBrowser = typeof window !== "undefined";

const readStorage = (key: string) => (isBrowser ? window.localStorage.getItem(key) : null);
const writeStorage = (key: string, value: string | null) => {
  if (!isBrowser) return;
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, value);
};

const extractToken = (payload: any) => (
  payload?.token
  || payload?.accessToken
  || payload?.access_token
  || payload?.data?.token
  || payload?.data?.accessToken
  || payload?.data?.access_token
  || null
);

const extractTenantId = (payload: any) => (
  payload?.activeTenantId
  || payload?.data?.activeTenantId
  || payload?.tenantId
  || payload?.data?.tenantId
  || null
);

const buildUrl = (path: string) => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
};

const parseJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
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
    const message = (data as any)?.message || (data as any)?.error || response.statusText;
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

export const authMe = async () => {
  const payload = await apiJson("/api/auth/me", { method: "GET" });
  const tenantId = extractTenantId(payload?.data || payload);
  if (tenantId) {
    setStoredTenantId(tenantId);
  }
  return payload;
};

export { API_BASE_URL };

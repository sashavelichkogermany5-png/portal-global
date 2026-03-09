import { apiJson } from "../app/lib/api-client";

type ApiResponse<T> = {
  data: T;
};

type LegacyApiError = Error & {
  status?: number;
  data?: unknown;
  response?: {
    status?: number;
    data?: unknown;
  };
};

const extractData = <T>(payload: unknown): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
};

const toLegacyError = (error: unknown): LegacyApiError => {
  if (error instanceof Error) {
    const legacyError = error as LegacyApiError;
    legacyError.response = {
      status: legacyError.status,
      data: legacyError.data
    };
    return legacyError;
  }
  const fallback = new Error("Request failed") as LegacyApiError;
  fallback.response = {};
  return fallback;
};

const request = async <T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> => {
  try {
    const payload = await apiJson(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { data: extractData<T>(payload) };
  } catch (error) {
    throw toLegacyError(error);
  }
};

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path)
};
